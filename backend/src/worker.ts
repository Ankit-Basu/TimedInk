import { logger, childLogger } from './lib/logger.js';
import { closeRedisConnections } from './lib/redis.js';
import { disconnectPrisma } from './lib/prisma.js';
import { startEmailWorker, stopEmailWorker } from './queue/emailWorker.js';

const log = childLogger('worker');

/**
 * Dedicated worker process (`npm run worker`).
 *
 * Runs separately from the API for the usual reason: a slow or wedged SMTP hop
 * must not be able to make the HTTP tier unresponsive, and the two scale on
 * completely different axes. They share only MySQL and Redis.
 *
 * On a host that only gives you one process — Render's free tier, for example —
 * set WORKER_INLINE=true and the API starts this same worker itself. See
 * DEPLOYMENT.md.
 */
async function main(): Promise<void> {
  const worker = startEmailWorker();

  const shutdown = async (signal: string): Promise<void> => {
    log.info({ signal }, 'shutting down worker');
    await stopEmailWorker(worker);
    await closeRedisConnections();
    await disconnectPrisma();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err: unknown) => {
  logger.fatal({ err }, 'worker failed to start');
  process.exit(1);
});
