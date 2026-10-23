import { describe, expect, it } from 'vitest';
import type { Redis } from 'ioredis';
import {
  consumeHourly,
  deferralTarget,
  HOUR_MS,
  hourWindow,
  nextWindowStart,
  refundHourly,
  reserveSendSlot,
} from '../../src/services/throttle.js';
import { planBulkSchedule } from '../../src/services/scheduling.js';

/**
 * Just enough Redis for the throttle scripts. `eval` dispatches on the shape of
 * the script and re-implements it over a Map, so the tests exercise the same
 * check-then-increment ordering the Lua relies on.
 */
class ScriptRedis {
  store = new Map<string, number>();

  async eval(script: string, numKeys: number, ...rest: string[]): Promise<number> {
    const keys = rest.slice(0, numKeys);
    const args = rest.slice(numKeys);

    if (script.includes('last + gap')) {
      const last = this.store.get(keys[0]!) ?? 0;
      const slot = Math.max(Number(args[0]), last + Number(args[1]));
      this.store.set(keys[0]!, slot);
      return slot;
    }

    for (let i = 0; i < keys.length; i += 1) {
      if ((this.store.get(keys[i]!) ?? 0) >= Number(args[i])) return i + 1;
    }
    for (const key of keys) this.store.set(key, (this.store.get(key) ?? 0) + 1);
    return 0;
  }

  async decr(key: string): Promise<number> {
    const next = (this.store.get(key) ?? 0) - 1;
    this.store.set(key, next);
    return next;
  }

  async set(key: string, value: string): Promise<'OK'> {
    this.store.set(key, Number(value));
    return 'OK';
  }
}

const NOW = new Date('2026-10-23T14:20:00.000Z');
const asRedis = (fake: ScriptRedis): Redis => fake as unknown as Redis;

describe('hour windows', () => {
  it('buckets by UTC hour', () => {
    expect(hourWindow(NOW)).toBe('2026-10-23T14');
  });

  it('defers to the next hour, keeping the original order within it', () => {
    expect(nextWindowStart(NOW.getTime())).toBe(Date.parse('2026-10-23T15:00:00.000Z'));

    const early = deferralTarget(new Date('2026-10-23T14:05:00Z'), NOW.getTime());
    const late = deferralTarget(new Date('2026-10-23T14:50:00Z'), NOW.getTime());
    expect(early).toBeLessThan(late);
    expect(late - nextWindowStart(NOW.getTime())).toBeLessThanOrEqual(60_000);
  });
});

describe('consumeHourly', () => {
  const limits = [
    { scope: 'global', id: 'all', limit: 3 },
    { scope: 'sender', id: 'mb-1', limit: 2 },
  ];

  it('allows sends until the tightest limit, then names the limit that was hit', async () => {
    const redis = new ScriptRedis();
    expect((await consumeHourly(limits, NOW, asRedis(redis), NOW)).allowed).toBe(true);
    expect((await consumeHourly(limits, NOW, asRedis(redis), NOW)).allowed).toBe(true);

    const third = await consumeHourly(limits, NOW, asRedis(redis), NOW);
    expect(third.allowed).toBe(false);
    if (!third.allowed) {
      expect(third.hit.scope).toBe('sender');
      expect(third.retryAt).toBeGreaterThanOrEqual(nextWindowStart(NOW.getTime()));
    }
  });

  it('does not charge the global counter when the sender limit rejects', async () => {
    const redis = new ScriptRedis();
    await consumeHourly(limits, NOW, asRedis(redis), NOW);
    await consumeHourly(limits, NOW, asRedis(redis), NOW);
    await consumeHourly(limits, NOW, asRedis(redis), NOW);

    expect(redis.store.get('ratelimit:hour:global:all:2026-10-23T14')).toBe(2);
  });

  it('refunds every counter after a send that never reached the provider', async () => {
    const redis = new ScriptRedis();
    await consumeHourly(limits, NOW, asRedis(redis), NOW);
    await refundHourly(limits, asRedis(redis), NOW);

    expect(redis.store.get('ratelimit:hour:global:all:2026-10-23T14')).toBe(0);
    expect(redis.store.get('ratelimit:hour:sender:mb-1:2026-10-23T14')).toBe(0);
  });

  it('starts a fresh budget in the next window', async () => {
    const redis = new ScriptRedis();
    await consumeHourly(limits, NOW, asRedis(redis), NOW);
    await consumeHourly(limits, NOW, asRedis(redis), NOW);

    const nextHour = new Date(NOW.getTime() + HOUR_MS);
    expect((await consumeHourly(limits, nextHour, asRedis(redis), nextHour)).allowed).toBe(true);
  });
});

describe('reserveSendSlot', () => {
  it('hands concurrent callers distinct slots spaced by the gap', async () => {
    const redis = new ScriptRedis();
    const now = NOW.getTime();
    const slots = [
      await reserveSendSlot('mb-1', 2_000, asRedis(redis), now),
      await reserveSendSlot('mb-1', 2_000, asRedis(redis), now),
      await reserveSendSlot('mb-1', 2_000, asRedis(redis), now),
    ];
    expect(slots).toEqual([now, now + 2_000, now + 4_000]);
  });

  it('keeps senders independent', async () => {
    const redis = new ScriptRedis();
    const now = NOW.getTime();
    await reserveSendSlot('mb-1', 2_000, asRedis(redis), now);
    expect(await reserveSendSlot('mb-2', 2_000, asRedis(redis), now)).toBe(now);
  });

  it('is a no-op when spacing is disabled', async () => {
    const redis = new ScriptRedis();
    expect(await reserveSendSlot('mb-1', 0, asRedis(redis), 123)).toBe(123);
    expect(redis.store.size).toBe(0);
  });
});

describe('planBulkSchedule', () => {
  const start = new Date('2026-10-23T10:00:00.000Z');

  it('spaces recipients by the requested delay', () => {
    const times = planBulkSchedule(3, start, 5_000).map((d) => d.toISOString());
    expect(times).toEqual([
      '2026-10-23T10:00:00.000Z',
      '2026-10-23T10:00:05.000Z',
      '2026-10-23T10:00:10.000Z',
    ]);
  });

  it('rolls into the next hour when the hourly limit is reached', () => {
    const times = planBulkSchedule(5, start, 1_000, 2).map((d) => d.toISOString());
    expect(times).toEqual([
      '2026-10-23T10:00:00.000Z',
      '2026-10-23T10:00:01.000Z',
      '2026-10-23T11:00:00.000Z',
      '2026-10-23T11:00:01.000Z',
      '2026-10-23T12:00:00.000Z',
    ]);
  });

  it('leaves a schedule that already fits under the limit untouched', () => {
    const plain = planBulkSchedule(4, start, 60 * 60 * 1000);
    const limited = planBulkSchedule(4, start, 60 * 60 * 1000, 10);
    expect(limited).toEqual(plain);
  });
});
