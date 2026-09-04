import type { Server } from 'node:http';
import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { prisma, disconnectPrisma } from './lib/prisma.js';
import { closeRedisConnections } from './lib/redis.js';
import { closeQueue } from './queue/emailQueue.js';
import { createApp } from './app.js';
import { startEmailWorker, stopEmailWorker } from './queue/emailWorker.js';
import { runBootReconciliation } from './services/reconciliation.js';

/**
 * API process.
 *
 * Boot order is the important part, and it is deliberate:
 *
 *   1. verify MySQL is reachable  - no point starting if it is not
 *   2. run reconciliation         - replay the DB's intent onto Redis
 *   3. THEN start listening       - so no request can create a row while the
 *                                   reconciler is mid-sweep and race it
 *
 * Step 3 is why `runBootReconciliation()` is awaited before `app.listen`.
 */
async function main(): Promise<void> {
  logger.info(
    { env: env.NODE_ENV, port: env.PORT, queue: env.EMAIL_QUEUE_NAME },
    'starting TimedInk API',
  );

  await prisma.$queryRaw`SELECT 1`;
  logger.info('database connection ok');

  await runBootReconciliation();

  // Single-process deployments run the worker here rather than as a separate
  // service. Started AFTER reconciliation, so the queue is whole before
  // anything starts draining it.
  const inlineWorker = env.WORKER_INLINE ? startEmailWorker() : null;

  const app = createApp();

  const server: Server = app.listen(env.PORT, () => {
    logger.info(
      {
        port: env.PORT,
        health: `http://localhost:${env.PORT}/health`,
        bullBoard: env.BULL_BOARD_ENABLED ? `http://localhost:${env.PORT}/admin/queues` : 'disabled',
      },
      `API listening on http://localhost:${env.PORT}`,
    );
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'shutting down API');

    // Stop accepting new connections, then drain.
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (inlineWorker) await stopEmailWorker(inlineWorker);
    await closeQueue();
    await closeRedisConnections();
    await disconnectPrisma();

    logger.info('shutdown complete');
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'unhandled promise rejection');
  });
}

main().catch((err: unknown) => {
  logger.fatal({ err }, 'API failed to start');
  process.exit(1);
});
