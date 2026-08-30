import { describe, expect, it, vi } from 'vitest';
import {
  classifyForReconciliation,
  reconcilePendingEmails,
  type ReconcilableEmail,
  type ReconciliationDeps,
} from '../../src/services/reconciliation.js';

/**
 * Unit tests for boot-time reconciliation.
 *
 * The orchestrator takes its dependencies as arguments precisely so this can be
 * covered without MySQL or Redis — what matters is the policy (what gets
 * re-queued, what gets flagged) and the failure isolation, not Prisma.
 */

const NOW = new Date('2026-03-14T12:00:00.000Z');
const THRESHOLD_MINUTES = 1440; // 24h

const email = (id: string, scheduledAt: string, status: ReconcilableEmail['status'] = 'QUEUED'): ReconcilableEmail => ({
  id,
  userId: 'user-1',
  scheduledAt: new Date(scheduledAt),
  status,
});

describe('classifyForReconciliation', () => {
  it('re-queues work that is still in the future', () => {
    const future = email('a', '2026-03-14T18:00:00.000Z');
    expect(classifyForReconciliation(future, NOW, THRESHOLD_MINUTES)).toBe('requeue');
  });

  it('re-queues work that is due right now', () => {
    const due = email('a', '2026-03-14T12:00:00.000Z');
    expect(classifyForReconciliation(due, NOW, THRESHOLD_MINUTES)).toBe('requeue');
  });

  it('re-queues recently-missed work so a short restart still catches up', () => {
    // Ten minutes late: the app was restarting, send it.
    const slightlyLate = email('a', '2026-03-14T11:50:00.000Z');
    expect(classifyForReconciliation(slightlyLate, NOW, THRESHOLD_MINUTES)).toBe('requeue');
  });

  it('flags work past the catch-up threshold as stale', () => {
    // 25 hours late — past the 24h window.
    const veryLate = email('a', '2026-03-13T11:00:00.000Z');
    expect(classifyForReconciliation(veryLate, NOW, THRESHOLD_MINUTES)).toBe('stale');
  });

  it('treats exactly-at-the-threshold as still recoverable', () => {
    // Boundary: lateBy === threshold is NOT stale (the check is strictly >).
    const exactly = email('a', '2026-03-13T12:00:00.000Z');
    expect(classifyForReconciliation(exactly, NOW, THRESHOLD_MINUTES)).toBe('requeue');

    const oneMsPast = email('a', '2026-03-13T11:59:59.999Z');
    expect(classifyForReconciliation(oneMsPast, NOW, THRESHOLD_MINUTES)).toBe('stale');
  });

  it('honours a tighter threshold', () => {
    const fiveMinutesLate = email('a', '2026-03-14T11:55:00.000Z');
    expect(classifyForReconciliation(fiveMinutesLate, NOW, 2)).toBe('stale');
    expect(classifyForReconciliation(fiveMinutesLate, NOW, 10)).toBe('requeue');
  });
});

function makeDeps(candidates: ReconcilableEmail[], overrides: Partial<ReconciliationDeps> = {}) {
  const enqueue = vi.fn<ReconciliationDeps['enqueue']>().mockResolvedValue(undefined);
  const flagStale = vi.fn<ReconciliationDeps['flagStale']>().mockResolvedValue(undefined);

  const deps: ReconciliationDeps = {
    findCandidates: vi.fn().mockResolvedValue(candidates),
    enqueue,
    flagStale,
    now: () => NOW,
    staleThresholdMinutes: THRESHOLD_MINUTES,
    ...overrides,
  };

  return { deps, enqueue, flagStale };
}

describe('reconcilePendingEmails', () => {
  it('does nothing, successfully, when there is no backlog', async () => {
    const { deps, enqueue, flagStale } = makeDeps([]);

    const summary = await reconcilePendingEmails(deps);

    expect(summary).toMatchObject({ candidates: 0, requeued: 0, flaggedStale: 0, errors: 0 });
    expect(enqueue).not.toHaveBeenCalled();
    expect(flagStale).not.toHaveBeenCalled();
  });

  it('splits the backlog into re-queued and stale', async () => {
    const { deps, enqueue, flagStale } = makeDeps([
      email('future', '2026-03-14T18:00:00.000Z'),
      email('due-now', '2026-03-14T12:00:00.000Z'),
      email('slightly-late', '2026-03-14T11:30:00.000Z'),
      email('ancient', '2026-03-01T09:00:00.000Z'),
      email('also-ancient', '2026-02-20T09:00:00.000Z', 'PENDING'),
    ]);

    const summary = await reconcilePendingEmails(deps);

    expect(summary.candidates).toBe(5);
    expect(summary.requeued).toBe(3);
    expect(summary.flaggedStale).toBe(2);
    expect(summary.errors).toBe(0);

    expect(enqueue.mock.calls.map(([e]) => e.id)).toEqual(['future', 'due-now', 'slightly-late']);
    expect(flagStale.mock.calls.map(([e]) => e.id)).toEqual(['ancient', 'also-ancient']);
  });

  it('passes the same clock to enqueue, so delay maths cannot drift mid-sweep', async () => {
    const { deps, enqueue } = makeDeps([email('a', '2026-03-14T18:00:00.000Z')]);

    await reconcilePendingEmails(deps);

    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ id: 'a' }), NOW);
  });

  it('reconciles PENDING rows as well as QUEUED ones', async () => {
    // A row stuck at PENDING means the process died between the DB write and
    // the enqueue — exactly the case reconciliation exists for.
    const { deps, enqueue } = makeDeps([email('orphan', '2026-03-14T18:00:00.000Z', 'PENDING')]);

    await reconcilePendingEmails(deps);

    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it('keeps going when one row throws, and counts it', async () => {
    const rows = [
      email('ok-1', '2026-03-14T18:00:00.000Z'),
      email('explodes', '2026-03-14T19:00:00.000Z'),
      email('ok-2', '2026-03-14T20:00:00.000Z'),
    ];
    const enqueue = vi
      .fn<ReconciliationDeps['enqueue']>()
      .mockImplementation(async (e) => {
        if (e.id === 'explodes') throw new Error('redis unavailable');
      });
    const { deps } = makeDeps(rows, { enqueue });

    const summary = await reconcilePendingEmails(deps);

    // The bad row must not abort the sweep — the rest of the backlog still
    // needs restoring, and the failed one is retried on the next boot.
    expect(summary).toMatchObject({ candidates: 3, requeued: 2, flaggedStale: 0, errors: 1 });
    expect(enqueue).toHaveBeenCalledTimes(3);
  });

  it('counts a failing stale-flag as an error rather than a flag', async () => {
    const flagStale = vi
      .fn<ReconciliationDeps['flagStale']>()
      .mockRejectedValue(new Error('db down'));
    const { deps } = makeDeps([email('ancient', '2026-03-01T09:00:00.000Z')], { flagStale });

    const summary = await reconcilePendingEmails(deps);

    expect(summary).toMatchObject({ flaggedStale: 0, errors: 1 });
  });

  it('reports a duration', async () => {
    const { deps } = makeDeps([email('a', '2026-03-14T18:00:00.000Z')]);
    const summary = await reconcilePendingEmails(deps);
    expect(summary.durationMs).toBeGreaterThanOrEqual(0);
  });
});
