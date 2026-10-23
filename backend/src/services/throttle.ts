import type { Redis } from 'ioredis';
import { redis } from '../lib/redis.js';

/**
 * Send pacing, enforced in the worker and coordinated through Redis so it holds
 * no matter how many worker processes are draining the queue.
 *
 * Two independent controls live here:
 *
 *   1. Hourly ceilings — a global cap, a per-sender cap, and an optional
 *      per-batch cap that came in with a bulk request. Counted per UTC hour
 *      window. A job over any of them is moved to the next window: delayed,
 *      never dropped.
 *
 *   2. Minimum spacing — no two sends from one sender closer together than
 *      MIN_SEND_DELAY_MS. Implemented as a "next free slot" per sender that
 *      each job reserves atomically, so concurrent workers queue up behind one
 *      another instead of all firing at once.
 */

export const HOUR_MS = 60 * 60 * 1000;

/** `2026-10-23T14` — the UTC hour a send is counted against. */
export function hourWindow(now: Date = new Date()): string {
  return now.toISOString().slice(0, 13);
}

/** Start of the UTC hour after `now`, in epoch ms. */
export function nextWindowStart(now: number = Date.now()): number {
  return Math.floor(now / HOUR_MS) * HOUR_MS + HOUR_MS;
}

/**
 * When a job is pushed to the next window, where in that window it lands.
 *
 * Every deferred job would otherwise wake at exactly :00 and race for the new
 * budget in whatever order Redis happens to return them. Offsetting by the
 * email's position within its original hour (scaled down to at most a minute)
 * means jobs that were scheduled earlier wake earlier — the original order
 * survives the deferral.
 */
export function deferralTarget(scheduledAt: Date, now: number = Date.now()): number {
  const offsetMs = Math.floor((scheduledAt.getTime() % HOUR_MS) / 60);
  return nextWindowStart(now) + offsetMs;
}

export interface HourlyLimit {
  /** Stable name for logs and the event trail: "global", "sender", "batch". */
  scope: string;
  /** Identifies the counter within its scope — a mailbox id, a batch id. */
  id: string;
  limit: number;
}

export const hourlyKey = (limit: Pick<HourlyLimit, 'scope' | 'id'>, now: Date = new Date()): string =>
  `ratelimit:hour:${limit.scope}:${limit.id}:${hourWindow(now)}`;

/**
 * Check every counter and only then increment them all, in one round trip.
 *
 * Doing it as separate INCRs would let a job take the global unit, fail the
 * sender check, and leave the global counter one too high. The script returns
 * 0 on success, or the 1-based index of the first limit that was hit.
 */
const CONSUME_HOURLY_SCRIPT = `
for i = 1, #KEYS do
  local current = tonumber(redis.call('GET', KEYS[i]) or '0')
  if current >= tonumber(ARGV[i]) then
    return i
  end
end
for i = 1, #KEYS do
  local value = redis.call('INCR', KEYS[i])
  if value == 1 then
    redis.call('EXPIRE', KEYS[i], tonumber(ARGV[#KEYS + 1]))
  end
end
return 0
`;

/** Two hours, so a counter outlives its window even with some clock skew. */
const HOURLY_TTL_SECONDS = 2 * 60 * 60;

export type HourlyDecision =
  | { allowed: true }
  | { allowed: false; hit: HourlyLimit; retryAt: number };

export async function consumeHourly(
  limits: HourlyLimit[],
  scheduledAt: Date,
  client: Redis = redis,
  now: Date = new Date(),
): Promise<HourlyDecision> {
  if (limits.length === 0) return { allowed: true };

  const keys = limits.map((l) => hourlyKey(l, now));
  const result = (await client.eval(
    CONSUME_HOURLY_SCRIPT,
    keys.length,
    ...keys,
    ...limits.map((l) => String(l.limit)),
    String(HOURLY_TTL_SECONDS),
  )) as number;

  if (result === 0) return { allowed: true };
  return {
    allowed: false,
    hit: limits[result - 1]!,
    retryAt: deferralTarget(scheduledAt, now.getTime()),
  };
}

/**
 * Hand the units back after a send that never reached the provider, so a flaky
 * SMTP hop does not eat into the hour's budget.
 */
export async function refundHourly(
  limits: HourlyLimit[],
  client: Redis = redis,
  now: Date = new Date(),
): Promise<void> {
  await Promise.all(
    limits.map(async (l) => {
      const key = hourlyKey(l, now);
      const value = await client.decr(key);
      if (value < 0) await client.set(key, '0');
    }),
  );
}

/** Sends counted against each limit in the current window — for the dashboard. */
export async function hourlyUsage(
  limits: Pick<HourlyLimit, 'scope' | 'id'>[],
  client: Redis = redis,
  now: Date = new Date(),
): Promise<number[]> {
  if (limits.length === 0) return [];
  const values = await client.mget(...limits.map((l) => hourlyKey(l, now)));
  return values.map((v) => (v ? Number.parseInt(v, 10) : 0));
}

/**
 * Reserve the next send slot for a sender: max(now, previous slot + gap).
 *
 * Atomic, so N workers asking at the same instant get N distinct slots spaced
 * `gap` apart rather than all being told "now".
 */
const RESERVE_SLOT_SCRIPT = `
local last = tonumber(redis.call('GET', KEYS[1]) or '0')
local now = tonumber(ARGV[1])
local gap = tonumber(ARGV[2])
local slot = math.max(now, last + gap)
redis.call('SET', KEYS[1], slot, 'PX', math.max(gap * 4, 60000) + (slot - now))
return slot
`;

export const slotKey = (senderId: string): string => `ratelimit:slot:${senderId}`;

export async function reserveSendSlot(
  senderId: string,
  gapMs: number,
  client: Redis = redis,
  now: number = Date.now(),
): Promise<number> {
  if (gapMs <= 0) return now;
  const slot = (await client.eval(
    RESERVE_SLOT_SCRIPT,
    1,
    slotKey(senderId),
    String(now),
    String(gapMs),
  )) as number;
  return Number(slot);
}
