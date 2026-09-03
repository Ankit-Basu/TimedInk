import type { Redis } from 'ioredis';

/**
 * A tiny in-memory stand-in for the handful of Redis commands the warmup
 * limiter uses.
 *
 * `eval` faithfully re-implements the CONSUME_SCRIPT in warmup.ts by calling
 * this fake's own INCR / DECR / EXPIRE, rather than short-circuiting to a
 * "yes/no" answer. That means the tests genuinely exercise the ordering the
 * real script relies on (increment first, roll back if over) and would catch a
 * refactor that, say, forgot to DECR on rejection.
 */
export class FakeRedis {
  private store = new Map<string, number>();
  private ttls = new Map<string, number>();

  /** Commands issued, in order — lets tests assert on TTL being set once. */
  readonly calls: string[] = [];

  async incr(key: string): Promise<number> {
    this.calls.push(`INCR ${key}`);
    const next = (this.store.get(key) ?? 0) + 1;
    this.store.set(key, next);
    return next;
  }

  async decr(key: string): Promise<number> {
    this.calls.push(`DECR ${key}`);
    const next = (this.store.get(key) ?? 0) - 1;
    this.store.set(key, next);
    return next;
  }

  async expire(key: string, seconds: number): Promise<number> {
    this.calls.push(`EXPIRE ${key} ${seconds}`);
    this.ttls.set(key, seconds);
    return 1;
  }

  async get(key: string): Promise<string | null> {
    const value = this.store.get(key);
    return value === undefined ? null : String(value);
  }

  async mget(...keys: string[]): Promise<(string | null)[]> {
    this.calls.push(`MGET ${keys.length}`);
    return keys.map((k) => {
      const value = this.store.get(k);
      return value === undefined ? null : String(value);
    });
  }

  async set(key: string, value: string): Promise<'OK'> {
    this.store.set(key, Number(value));
    return 'OK';
  }

  /** Mirrors the Lua in warmup.ts: INCR, set TTL on first write, roll back if over. */
  async eval(_script: string, _numKeys: number, key: string, ...args: string[]): Promise<[number, number]> {
    const limit = Number(args[0]);
    const ttlSeconds = Number(args[1]);

    const current = await this.incr(key);
    if (current === 1) await this.expire(key, ttlSeconds);

    if (current > limit) {
      await this.decr(key);
      return [0, current - 1];
    }
    return [1, current];
  }

  // --- test-only helpers ---------------------------------------------------

  peek(key: string): number | undefined {
    return this.store.get(key);
  }

  ttlOf(key: string): number | undefined {
    return this.ttls.get(key);
  }

  /** Structural cast — the fake only implements what the code under test uses. */
  asRedis(): Redis {
    return this as unknown as Redis;
  }
}
