import { Worker, type Job } from 'bullmq';
import { env } from './config/env.js';
import { childLogger, logger } from './lib/logger.js';
import { createRedisConnection, closeRedisConnections } from './lib/redis.js';
import { disconnectPrisma } from './lib/prisma.js';
import { EMAIL_QUEUE_NAME, rateLimitConfig, type SendEmailJobData } from './queue/emailQueue.js';
import { processSendEmailJob } from './queue/processor.js';
import { startFollowUpSweeper, stopFollowUpSweeper } from './services/followUp.js';
import { verifyMailer } from './services/mailer.js';

const log = childLogger('worker');

/**
 * Worker process.
 *
 * Runs separately from the API (`npm run worker`) for the usual reason: a slow
 * or wedged SMTP hop must not be able to make the HTTP tier unresponsive, and
 * the two scale independently. They share only MySQL and Redis.
 *
 * Two independent throttles, which are often conflated:
 *
 *   concurrency  - how many jobs THIS process runs at once (a local resource
 *                  bound: sockets, memory, CPU).
 *   limiter      - how many jobs may start per window across ALL workers (a
 *                  global bound, coordinated in Redis). This is the one that
 *                  models "the provider will 421 you above N/sec".
 *
 * With the defaults (concurrency 5, 10 per 10s) a burst of 50 emails drains in
 * ~50 seconds in visible batches of 10, which is the effect to show on screen.
 */
async function main(): Promise<void> {
  log.info(
    {
      queue: EMAIL_QUEUE_NAME,
      concurrency: env.WORKER_CONCURRENCY,
      rateLimit: `${rateLimitConfig.max} per ${rateLimitConfig.duration}ms`,
      attempts: env.JOB_ATTEMPTS,
      backoffMs: env.JOB_BACKOFF_MS,
    },
    'starting email worker',
  );

  // Fail loudly at boot rather than on the first job at 3am.
  try {
    await verifyMailer();
  } catch (err) {
    log.error({ err }, 'SMTP verification failed; jobs will retry until it recovers');
  }

  const worker = new Worker<SendEmailJobData>(
    EMAIL_QUEUE_NAME,
    (job: Job<SendEmailJobData>, token?: string) => processSendEmailJob(job, token),
    {
      connection: createRedisConnection('worker'),
      concurrency: env.WORKER_CONCURRENCY,
      limiter: { max: rateLimitConfig.max, duration: rateLimitConfig.duration },
    },
  );

  worker.on('completed', (job: Job<SendEmailJobData>) => {
    log.debug({ jobId: job.id, emailId: job.data.scheduledEmailId }, 'job completed');
  });

  worker.on('failed', (job: Job<SendEmailJobData> | undefined, err: Error) => {
    log.warn(
      { jobId: job?.id, emailId: job?.data?.scheduledEmailId, err: err.message },
      'job failed',
    );
  });

  worker.on('error', (err: Error) => {
    log.error({ err }, 'worker error');
  });

  // Visible proof the limiter is doing something during a burst demo.
  worker.on('ready', () => log.info('worker ready and listening for jobs'));

  // Bonus C - the follow-up sweeper lives in the worker process, not the API,
  // so it does not run N times when the API is scaled out.
  startFollowUpSweeper();

  const shutdown = async (signal: string): Promise<void> => {
    log.info({ signal }, 'shutting down worker');
    stopFollowUpSweeper();
    // `worker.close()` waits for in-flight jobs so a send in progress is not
    // orphaned halfway through.
    await worker.close();
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
