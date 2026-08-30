import { Redis, type RedisOptions } from 'ioredis';
import { env } from '../config/env.js';
import { logger } from './logger.js';

/**
 * BullMQ requires `maxRetriesPerRequest: null` on the connections it owns: a
 * blocking BRPOPLPUSH can legitimately sit idle for minutes, and ioredis' default
 * retry cap would kill it mid-wait.
 */
const bullmqCompatibleOptions: RedisOptions = {
  maxRetriesPerRequest: null,
  enableReadyCheck: true,
};

const connections: Redis[] = [];

export function createRedisConnection(label: string): Redis {
  const connection = new Redis(env.REDIS_URL, bullmqCompatibleOptions);

  connection.on('error', (err: Error) => {
    // ioredis retries on its own; log at warn so a flapping Redis is visible
    // without drowning the console in stack traces.
    logger.warn({ err: err.message, label }, 'redis connection error');
  });
  connection.on('connect', () => logger.debug({ label }, 'redis connected'));

  connections.push(connection);
  return connection;
}

/** Shared connection for non-BullMQ work (warmup counters, follow-up locks). */
export const redis = createRedisConnection('app');

export async function closeRedisConnections(): Promise<void> {
  await Promise.allSettled(connections.map((c) => c.quit()));
}
