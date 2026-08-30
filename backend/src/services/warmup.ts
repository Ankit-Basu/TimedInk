import type { Redis } from 'ioredis';
import { redis } from '../lib/redis.js';

/**
 * Bonus B — warmup-style per-mailbox throttling.
 *
 * A brand-new mailbox that suddenly sends 500 messages gets burned by every
 * major provider. Real warmup ramps volume over days; we model that with
 * `Mailbox.warmupDay` driving a daily ceiling, enforced by a Redis counter that
 * resets at UTC midnight.
 */

export const WARMUP_STEP = 10;
export const WARMUP_CEILING = 100;

/** day N -> min(10 * N, 100). Day 0 or negative is clamped to one step. */
export function dailyLimitForWarmupDay(warmupDay: number): number {
  if (!Number.isFinite(warmupDay) || warmupDay < 1) return WARMUP_STEP;
  return Math.min(WARMUP_STEP * Math.floor(warmupDay), WARMUP_CEILING);
}

/**
 * Effective limit for a mailbox: the warmup ramp, but never above an explicit
 * per-mailbox `dailyLimit` override an operator has set.
 */
export function effectiveDailyLimit(mailbox: { warmupDay: number; dailyLimit: number }): number {
  return Math.min(dailyLimitForWarmupDay(mailbox.warmupDay), mailbox.dailyLimit);
}

/** Counters bucket by UTC day so the reset point is unambiguous across zones. */
export function quotaKey(mailboxId: string, now: Date = new Date()): string {
  const day = now.toISOString().slice(0, 10); // YYYY-MM-DD
  return `warmup:quota:${mailboxId}:${day}`;
}

/**
 * Atomically take one unit of a mailbox's daily quota.
 *
 * INCR-then-compare-then-DECR would race between two worker processes, so the
 * whole check runs server-side as a single Lua script.
 */
const CONSUME_SCRIPT = `
local current = redis.call('INCR', KEYS[1])
if current == 1 then
  redis.call('EXPIRE', KEYS[1], tonumber(ARGV[2]))
end
if current > tonumber(ARGV[1]) then
  redis.call('DECR', KEYS[1])
  return {0, current - 1}
end
return {1, current}
`;

const QUOTA_TTL_SECONDS = 60 * 60 * 48; // survives clock skew / late jobs

export interface QuotaDecision {
  allowed: boolean;
  used: number;
  limit: number;
}

export async function consumeMailboxQuota(
  mailboxId: string,
  limit: number,
  client: Redis = redis,
  now: Date = new Date(),
): Promise<QuotaDecision> {
  const result = (await client.eval(
    CONSUME_SCRIPT,
    1,
    quotaKey(mailboxId, now),
    String(limit),
    String(QUOTA_TTL_SECONDS),
  )) as [number, number];

  const [allowed, used] = result;
  return { allowed: allowed === 1, used, limit };
}

/**
 * Give a unit back — used when we reserved quota but never actually handed the
 * message to SMTP, so a doomed attempt doesn't eat a day of warmup budget.
 */
export async function refundMailboxQuota(
  mailboxId: string,
  client: Redis = redis,
  now: Date = new Date(),
): Promise<void> {
  const key = quotaKey(mailboxId, now);
  const value = await client.decr(key);
  if (value < 0) await client.set(key, '0'); // defensive: never go negative
}

export async function getQuotaUsage(
  mailboxId: string,
  client: Redis = redis,
  now: Date = new Date(),
): Promise<number> {
  const raw = await client.get(quotaKey(mailboxId, now));
  return raw ? Number.parseInt(raw, 10) : 0;
}
