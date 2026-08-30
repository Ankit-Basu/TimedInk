import { env } from '../config/env.js';
import { childLogger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import { redis } from '../lib/redis.js';
import { createScheduledEmail } from './scheduling.js';

const log = childLogger('followup');

/**
 * Bonus C - follow-up sequencing.
 *
 * A lightweight sweeper (not a cron service) that looks for emails which were
 * SENT with open-tracking enabled, whose follow-up window has elapsed, and for
 * which no OPENED event ever arrived. Each one gets a brand new ScheduledEmail
 * with `followUpOfId` pointing back at the original, which then flows through
 * exactly the same queue/worker path as any other email.
 *
 * Why an interval sweep rather than a delayed BullMQ job per email: the
 * decision depends on state that changes *after* scheduling (did an open land?),
 * and a periodic query over an indexed column is simpler to reason about than
 * a job that must be cancelled when the pixel fires. At real volume this would
 * become a BullMQ repeatable job with a cursor over a partitioned table.
 */

/** Cross-process guard so two workers do not both queue the same follow-up. */
const SWEEP_LOCK_KEY = 'followup:sweep:lock';
const SWEEP_LOCK_TTL_SECONDS = 55;

/** Bound the batch so one sweep cannot stall the worker. */
const SWEEP_BATCH_SIZE = 200;

export interface FollowUpSummary {
  examined: number;
  queued: number;
  skipped: number;
}

const FOLLOW_UP_PREFIX = 'Re: ';

function buildFollowUpBody(originalBody: string): string {
  return [
    'Just floating this back to the top of your inbox in case it got buried.',
    '',
    '---',
    '',
    originalBody,
  ].join('\n');
}

/**
 * One pass. Exposed (and dependency-light) so it can be triggered manually from
 * an endpoint during a demo instead of waiting for the interval to come round.
 */
export async function sweepFollowUps(now: Date = new Date()): Promise<FollowUpSummary> {
  const candidates = await prisma.scheduledEmail.findMany({
    where: {
      status: 'SENT',
      followUpAfterHours: { not: null },
      followUpQueuedAt: null,
      openedAt: null,
      sentAt: { not: null },
    },
    orderBy: { sentAt: 'asc' },
    take: SWEEP_BATCH_SIZE,
  });

  let queued = 0;
  let skipped = 0;

  for (const email of candidates) {
    const sentAt = email.sentAt;
    const hours = email.followUpAfterHours;
    if (!sentAt || !hours) {
      skipped += 1;
      continue;
    }

    const dueAt = sentAt.getTime() + hours * 60 * 60 * 1000;
    if (now.getTime() < dueAt) {
      skipped += 1;
      continue;
    }

    try {
      // Claim the row first. A conditional update (followUpQueuedAt still NULL)
      // means a concurrent sweeper that got past the lock still cannot create a
      // second follow-up.
      const claim = await prisma.scheduledEmail.updateMany({
        where: { id: email.id, followUpQueuedAt: null },
        data: { followUpQueuedAt: now },
      });
      if (claim.count === 0) {
        skipped += 1;
        continue;
      }

      const followUp = await createScheduledEmail({
        userId: email.userId,
        to: email.to,
        cc: email.cc,
        subject: email.subject.startsWith(FOLLOW_UP_PREFIX)
          ? email.subject
          : `${FOLLOW_UP_PREFIX}${email.subject}`,
        bodyText: buildFollowUpBody(email.bodyText),
        // Send straight away - the whole point is that the window has elapsed.
        scheduledAt: now,
        timezone: email.timezone,
        // Deliberately reuse the same mailbox: a follow-up arriving from a
        // different sender address breaks the thread and looks like spam.
        mailboxId: email.mailboxId,
        followUpOfId: email.id,
      });

      queued += 1;
      log.info(
        { originalId: email.id, followUpId: followUp.id, hours },
        'queued follow-up for unopened email',
      );
    } catch (err) {
      // Release the claim so the next sweep can retry this one.
      await prisma.scheduledEmail
        .update({ where: { id: email.id }, data: { followUpQueuedAt: null } })
        .catch(() => undefined);
      skipped += 1;
      log.error({ err, emailId: email.id }, 'failed to queue follow-up');
    }
  }

  return { examined: candidates.length, queued, skipped };
}

/** Best-effort distributed lock; a missed sweep is harmless, a double is not. */
async function withSweepLock<T>(fn: () => Promise<T>): Promise<T | null> {
  const token = `${process.pid}-${Date.now()}`;
  const acquired = await redis.set(SWEEP_LOCK_KEY, token, 'EX', SWEEP_LOCK_TTL_SECONDS, 'NX');
  if (acquired !== 'OK') return null;

  try {
    return await fn();
  } finally {
    // Only release if we still hold it (avoids dropping someone else's lock
    // after a long-running sweep overran the TTL).
    const current = await redis.get(SWEEP_LOCK_KEY);
    if (current === token) await redis.del(SWEEP_LOCK_KEY);
  }
}

let timer: NodeJS.Timeout | null = null;

export function startFollowUpSweeper(): void {
  if (timer) return;

  const tick = async (): Promise<void> => {
    try {
      const summary = await withSweepLock(() => sweepFollowUps());
      if (summary && summary.queued > 0) {
        log.info(summary, 'follow-up sweep queued new emails');
      }
    } catch (err) {
      log.error({ err }, 'follow-up sweep failed');
    }
  };

  timer = setInterval(() => void tick(), env.FOLLOWUP_CHECK_INTERVAL_MS);
  // Do not hold the event loop open on shutdown.
  timer.unref();

  log.info({ intervalMs: env.FOLLOWUP_CHECK_INTERVAL_MS }, 'follow-up sweeper started');
}

export function stopFollowUpSweeper(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
