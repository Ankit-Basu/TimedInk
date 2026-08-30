import { Queue, type JobsOptions } from 'bullmq';
import { env } from '../config/env.js';
import { createRedisConnection } from '../lib/redis.js';

export const EMAIL_QUEUE_NAME = env.EMAIL_QUEUE_NAME;
export const SEND_EMAIL_JOB = 'send-email';

/**
 * The job payload is deliberately thin: an id and a couple of hints. The worker
 * re-reads the row from MySQL before sending, so a payload that has gone stale
 * (email edited, cancelled, already sent) can never cause a wrong send.
 */
export interface SendEmailJobData {
  scheduledEmailId: string;
  userId: string;
  /** Only for log/trace correlation — never trusted for scheduling decisions. */
  enqueuedAt: string;
}

/**
 * Deterministic job id derived from the MySQL primary key.
 *
 * This is what makes the boot-time reconciler idempotent: `queue.add` with a
 * jobId that already exists in Redis is a no-op, so re-adding every
 * PENDING/QUEUED row on every boot cannot produce duplicate sends.
 */
export const jobIdForEmail = (scheduledEmailId: string): string => `email-${scheduledEmailId}`;

/** Retry policy for *transient* failures (SMTP timeouts, 4xx greylisting). */
export const defaultJobOptions: JobsOptions = {
  attempts: env.JOB_ATTEMPTS,
  backoff: { type: 'exponential', delay: env.JOB_BACKOFF_MS },
  // Keep a short tail of finished jobs so Bull Board stays useful for a demo
  // without letting Redis grow without bound.
  removeOnComplete: { age: 60 * 60 * 24, count: 1_000 },
  removeOnFail: { age: 60 * 60 * 24 * 7, count: 5_000 },
};

export const emailQueue = new Queue<SendEmailJobData>(EMAIL_QUEUE_NAME, {
  connection: createRedisConnection('queue'),
  defaultJobOptions,
});

/**
 * NOTE ON THE RATE LIMITER
 * ------------------------
 * The brief describes `limiter: { max, duration }` as a Queue option. In BullMQ
 * that option lives on the *Worker* (`WorkerOptions.limiter`) — it is still a
 * queue-wide limit, coordinated in Redis across every worker process, which is
 * the behaviour we want. It is configured in src/worker.ts. Documented in
 * ASSUMPTIONS.md.
 */
export const rateLimitConfig = {
  max: env.RATE_LIMIT_MAX,
  duration: env.RATE_LIMIT_DURATION_MS,
} as const;

export async function closeQueue(): Promise<void> {
  await emailQueue.close();
}
