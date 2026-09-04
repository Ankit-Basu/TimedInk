import { Worker, type Job } from 'bullmq';
import { env } from '../config/env.js';
import { childLogger } from '../lib/logger.js';
import { createRedisConnection } from '../lib/redis.js';
import { startFollowUpSweeper, stopFollowUpSweeper } from '../services/followUp.js';
import { closeMailer, verifyMailer } from '../services/mailer.js';
import { EMAIL_QUEUE_NAME, rateLimitConfig, type SendEmailJobData } from './emailQueue.js';
import { processSendEmailJob } from './processor.js';

const log = childLogger('worker');

/**
 * The BullMQ worker, extracted so it can run in either of two topologies:
 *
 *   dedicated  — `npm run worker`, its own process. The default, and what you
 *                want anywhere the platform supports background workers: a
 *                wedged SMTP hop cannot then affect the HTTP tier.
 *
 *   inline     — started inside the API process when WORKER_INLINE=true. Free
 *                hosting tiers (Render's included) only give you one runnable
 *                web process, so this makes a single-service deploy possible.
 *                It is a real trade-off, not a trick: the two now share an
 *                event loop, so a slow send does add latency to requests.
 *
 * Either way this is the same code path — there is no "deployment mode"
 * branching inside the processor itself.
 */
export function startEmailWorker(): Worker<SendEmailJobData> {
  log.info(
    {
      queue: EMAIL_QUEUE_NAME,
      concurrency: env.WORKER_CONCURRENCY,
      rateLimit: `${rateLimitConfig.max} per ${rateLimitConfig.duration}ms`,
      attempts: env.JOB_ATTEMPTS,
      backoffMs: env.JOB_BACKOFF_MS,
      mode: env.WORKER_INLINE ? 'inline (shares the API process)' : 'dedicated process',
    },
    'starting email worker',
  );

  // Fail loudly at boot rather than on the first job at 3am. Deliberately not
  // awaited by the caller — a provider blip should not stop the app booting,
  // and BullMQ will retry the jobs anyway.
  void verifyMailer().catch((err: unknown) => {
    log.error({ err }, 'SMTP verification failed; jobs will retry until it recovers');
  });

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
    log.warn({ jobId: job?.id, emailId: job?.data?.scheduledEmailId, err: err.message }, 'job failed');
  });

  worker.on('error', (err: Error) => {
    log.error({ err }, 'worker error');
  });

  // Visible proof the limiter is doing something during a burst demo.
  worker.on('ready', () => log.info('worker ready and listening for jobs'));

  // Bonus C — the follow-up sweeper rides with the worker, not the API, so it
  // does not run N times when the API is scaled out.
  startFollowUpSweeper();

  return worker;
}

/**
 * Drain and tear down, in dependency order: stop the sweeper, let in-flight
 * jobs finish, and only then close the SMTP pool those sends are still using.
 */
export async function stopEmailWorker(worker: Worker<SendEmailJobData>): Promise<void> {
  stopFollowUpSweeper();
  await worker.close();
  await closeMailer();
}
