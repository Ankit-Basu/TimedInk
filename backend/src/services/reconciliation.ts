import type { EmailStatus } from '@prisma/client';
import { env } from '../config/env.js';
import { childLogger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import { enqueueScheduledEmail } from './scheduling.js';
import { recordEvent } from './events.js';

const log = childLogger('reconcile');

/**
 * Boot-time reconciliation.
 * =========================
 *
 * Redis can lose data (eviction, a wiped volume, a `FLUSHALL`, a version
 * upgrade). MySQL is the source of truth, so on every boot - *before* the HTTP
 * server accepts traffic - we replay the database's intent back onto the queue.
 *
 * Two rules make this safe to run unconditionally on every single start:
 *
 *  1. The job id is derived from the row id (`email-<uuid>`), so re-adding a
 *     job that still exists in Redis is a no-op. No duplicate sends.
 *
 *  2. Anything whose send window is further in the past than
 *     STALE_CATCHUP_THRESHOLD_MINUTES is NOT auto-sent. After a two-day outage
 *     you do not want 5,000 stale cold emails leaving at once; those get
 *     FAILED + "missed window, flagged for manual review" so a human decides.
 */

export const MISSED_WINDOW_ERROR = 'missed window, flagged for manual review';

/** The statuses that represent "work the queue still owes us". */
export const RECONCILABLE_STATUSES: readonly EmailStatus[] = ['PENDING', 'QUEUED'];

export interface ReconcilableEmail {
  id: string;
  userId: string;
  scheduledAt: Date;
  status: EmailStatus;
}

export type ReconcileDecision = 'requeue' | 'stale';

/**
 * Pure decision function - the entire policy in one testable place.
 *
 * A row is stale when it is more than `staleThresholdMinutes` past due.
 * Everything else is re-queued, including rows already past due but inside the
 * threshold (those get delay 0 and go out immediately, which is the desired
 * "catch up on the last few minutes" behaviour after a short restart).
 */
export function classifyForReconciliation(
  email: Pick<ReconcilableEmail, 'scheduledAt'>,
  now: Date,
  staleThresholdMinutes: number,
): ReconcileDecision {
  const lateByMs = now.getTime() - email.scheduledAt.getTime();
  const thresholdMs = staleThresholdMinutes * 60_000;
  return lateByMs > thresholdMs ? 'stale' : 'requeue';
}

export interface ReconciliationSummary {
  /** Rows examined. */
  candidates: number;
  /** Rows (re)added to the queue. */
  requeued: number;
  /** Rows failed as past their catch-up window. */
  flaggedStale: number;
  /** Rows that threw while being processed; left untouched for the next boot. */
  errors: number;
  durationMs: number;
}

export interface ReconciliationDeps {
  findCandidates: () => Promise<ReconcilableEmail[]>;
  enqueue: (email: ReconcilableEmail, now: Date) => Promise<unknown>;
  flagStale: (email: ReconcilableEmail, now: Date) => Promise<void>;
  now?: () => Date;
  staleThresholdMinutes?: number;
}

/**
 * Orchestrator. Dependencies are injected so this can be unit-tested without a
 * database or a live Redis.
 */
export async function reconcilePendingEmails(
  deps: ReconciliationDeps,
): Promise<ReconciliationSummary> {
  const startedAt = Date.now();
  const now = deps.now?.() ?? new Date();
  const staleThresholdMinutes =
    deps.staleThresholdMinutes ?? env.STALE_CATCHUP_THRESHOLD_MINUTES;

  const candidates = await deps.findCandidates();

  let requeued = 0;
  let flaggedStale = 0;
  let errors = 0;

  for (const email of candidates) {
    try {
      if (classifyForReconciliation(email, now, staleThresholdMinutes) === 'stale') {
        await deps.flagStale(email, now);
        flaggedStale += 1;
      } else {
        await deps.enqueue(email, now);
        requeued += 1;
      }
    } catch (err) {
      // One bad row must not abort the sweep - the rest of the backlog still
      // needs to be restored. It stays PENDING/QUEUED and is retried next boot.
      errors += 1;
      log.error({ err, emailId: email.id }, 'reconciliation failed for email');
    }
  }

  return {
    candidates: candidates.length,
    requeued,
    flaggedStale,
    errors,
    durationMs: Date.now() - startedAt,
  };
}

/** Default wiring: real MySQL, real BullMQ. */
export function createDefaultReconciliationDeps(): ReconciliationDeps {
  return {
    findCandidates: () =>
      prisma.scheduledEmail.findMany({
        where: { status: { in: [...RECONCILABLE_STATUSES] } },
        orderBy: { scheduledAt: 'asc' },
        select: { id: true, userId: true, scheduledAt: true, status: true },
      }),

    enqueue: (email, now) => enqueueScheduledEmail(email, now),

    flagStale: async (email) => {
      await prisma.scheduledEmail.update({
        where: { id: email.id },
        data: { status: 'FAILED', lastError: MISSED_WINDOW_ERROR, bullJobId: null },
      });
      await recordEvent(email.id, 'FAILED', {
        reason: MISSED_WINDOW_ERROR,
        scheduledAt: email.scheduledAt.toISOString(),
        source: 'boot-reconciliation',
      });
    },
  };
}

/**
 * Called from server boot. Always logs exactly one summary line, even when
 * there was nothing to do - a visible "0 reconciled" on every restart is what
 * makes the restart story demonstrable.
 */
export async function runBootReconciliation(): Promise<ReconciliationSummary> {
  const summary = await reconcilePendingEmails(createDefaultReconciliationDeps());

  log.info(
    {
      candidates: summary.candidates,
      requeued: summary.requeued,
      flaggedStale: summary.flaggedStale,
      errors: summary.errors,
      durationMs: summary.durationMs,
      staleThresholdMinutes: env.STALE_CATCHUP_THRESHOLD_MINUTES,
    },
    `reconciliation complete: ${summary.requeued} job(s) re-queued, ` +
      `${summary.flaggedStale} flagged stale, ${summary.errors} error(s) ` +
      `from ${summary.candidates} candidate(s) in ${summary.durationMs}ms`,
  );

  return summary;
}
