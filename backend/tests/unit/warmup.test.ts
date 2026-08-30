import { describe, expect, it } from 'vitest';
import {
  WARMUP_CEILING,
  WARMUP_STEP,
  consumeMailboxQuota,
  dailyLimitForWarmupDay,
  effectiveDailyLimit,
  getQuotaUsage,
  quotaKey,
  refundMailboxQuota,
} from '../../src/services/warmup.js';
import { FakeRedis } from '../helpers/fakeRedis.js';

/**
 * Unit tests for the rate-limiting logic we own.
 *
 * (The queue-level send-rate cap is BullMQ's `limiter`, which is library code;
 * what belongs to this app is the per-mailbox warmup bucket below, plus the
 * limit arithmetic that drives it.)
 */

const MAILBOX = 'mbx-1';

describe('dailyLimitForWarmupDay', () => {
  it('ramps by 10 per day', () => {
    expect(dailyLimitForWarmupDay(1)).toBe(10);
    expect(dailyLimitForWarmupDay(2)).toBe(20);
    expect(dailyLimitForWarmupDay(7)).toBe(70);
  });

  it('caps at the ceiling', () => {
    expect(dailyLimitForWarmupDay(10)).toBe(WARMUP_CEILING);
    expect(dailyLimitForWarmupDay(11)).toBe(WARMUP_CEILING);
    expect(dailyLimitForWarmupDay(999)).toBe(WARMUP_CEILING);
  });

  it('clamps day 0, negatives and non-finite input to one step', () => {
    expect(dailyLimitForWarmupDay(0)).toBe(WARMUP_STEP);
    expect(dailyLimitForWarmupDay(-5)).toBe(WARMUP_STEP);
    expect(dailyLimitForWarmupDay(Number.NaN)).toBe(WARMUP_STEP);
  });

  it('floors fractional days rather than producing a fractional limit', () => {
    expect(dailyLimitForWarmupDay(2.9)).toBe(20);
  });
});

describe('effectiveDailyLimit', () => {
  it('takes the lower of the warmup ramp and an explicit override', () => {
    // Ramp says 50, operator capped the mailbox at 25.
    expect(effectiveDailyLimit({ warmupDay: 5, dailyLimit: 25 })).toBe(25);
    // Ramp says 20, operator allows 100 -> the ramp is still the binding limit.
    expect(effectiveDailyLimit({ warmupDay: 2, dailyLimit: 100 })).toBe(20);
  });
});

describe('quotaKey', () => {
  it('buckets by UTC day', () => {
    const key = quotaKey(MAILBOX, new Date('2026-03-14T23:59:59.000Z'));
    expect(key).toBe('warmup:quota:mbx-1:2026-03-14');
  });

  it('rolls over at UTC midnight, not local midnight', () => {
    const before = quotaKey(MAILBOX, new Date('2026-03-14T23:59:59.000Z'));
    const after = quotaKey(MAILBOX, new Date('2026-03-15T00:00:00.000Z'));
    expect(before).not.toBe(after);
  });
});

describe('consumeMailboxQuota', () => {
  it('allows sends up to the limit and denies the one after', async () => {
    const redis = new FakeRedis();
    const limit = 3;

    const results = [];
    for (let i = 0; i < 4; i += 1) {
      results.push(await consumeMailboxQuota(MAILBOX, limit, redis.asRedis()));
    }

    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false]);
    expect(results.map((r) => r.used)).toEqual([1, 2, 3, 3]);
    expect(results.every((r) => r.limit === limit)).toBe(true);
  });

  it('rolls the counter back when it denies, so a burst cannot inflate usage', async () => {
    const redis = new FakeRedis();
    const now = new Date('2026-03-14T10:00:00.000Z');

    await consumeMailboxQuota(MAILBOX, 1, redis.asRedis(), now);
    await consumeMailboxQuota(MAILBOX, 1, redis.asRedis(), now);
    await consumeMailboxQuota(MAILBOX, 1, redis.asRedis(), now);

    // Three attempts, one allowed: the counter must still read 1, not 3.
    expect(redis.peek(quotaKey(MAILBOX, now))).toBe(1);
  });

  it('sets a TTL exactly once, on the first write of the day', async () => {
    const redis = new FakeRedis();
    const now = new Date('2026-03-14T10:00:00.000Z');

    await consumeMailboxQuota(MAILBOX, 5, redis.asRedis(), now);
    await consumeMailboxQuota(MAILBOX, 5, redis.asRedis(), now);

    const expireCalls = redis.calls.filter((c) => c.startsWith('EXPIRE'));
    expect(expireCalls).toHaveLength(1);
    expect(redis.ttlOf(quotaKey(MAILBOX, now))).toBeGreaterThan(0);
  });

  it('tracks each mailbox independently', async () => {
    const redis = new FakeRedis();

    await consumeMailboxQuota('mbx-a', 1, redis.asRedis());
    const other = await consumeMailboxQuota('mbx-b', 1, redis.asRedis());

    expect(other.allowed).toBe(true);
  });

  it('starts a fresh allowance on the next UTC day', async () => {
    const redis = new FakeRedis();
    const day1 = new Date('2026-03-14T12:00:00.000Z');
    const day2 = new Date('2026-03-15T00:00:01.000Z');

    expect((await consumeMailboxQuota(MAILBOX, 1, redis.asRedis(), day1)).allowed).toBe(true);
    expect((await consumeMailboxQuota(MAILBOX, 1, redis.asRedis(), day1)).allowed).toBe(false);
    expect((await consumeMailboxQuota(MAILBOX, 1, redis.asRedis(), day2)).allowed).toBe(true);
  });

  it('denies everything when the limit is zero', async () => {
    const redis = new FakeRedis();
    const decision = await consumeMailboxQuota(MAILBOX, 0, redis.asRedis());
    expect(decision.allowed).toBe(false);
    expect(decision.used).toBe(0);
  });
});

describe('refundMailboxQuota', () => {
  it('returns a unit so a failed send does not burn the allowance', async () => {
    const redis = new FakeRedis();
    const now = new Date('2026-03-14T10:00:00.000Z');

    await consumeMailboxQuota(MAILBOX, 2, redis.asRedis(), now);
    await consumeMailboxQuota(MAILBOX, 2, redis.asRedis(), now);
    expect(await getQuotaUsage(MAILBOX, redis.asRedis(), now)).toBe(2);

    await refundMailboxQuota(MAILBOX, redis.asRedis(), now);
    expect(await getQuotaUsage(MAILBOX, redis.asRedis(), now)).toBe(1);

    // ...and the freed slot is genuinely reusable.
    expect((await consumeMailboxQuota(MAILBOX, 2, redis.asRedis(), now)).allowed).toBe(true);
  });

  it('never drives the counter negative', async () => {
    const redis = new FakeRedis();
    const now = new Date('2026-03-14T10:00:00.000Z');

    await refundMailboxQuota(MAILBOX, redis.asRedis(), now);

    expect(await getQuotaUsage(MAILBOX, redis.asRedis(), now)).toBe(0);
  });
});

describe('getQuotaUsage', () => {
  it('reports zero for a mailbox that has not sent today', async () => {
    const redis = new FakeRedis();
    expect(await getQuotaUsage('never-used', redis.asRedis())).toBe(0);
  });
});
