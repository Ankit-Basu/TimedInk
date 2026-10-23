import { DelayedError, UnrecoverableError, type Job } from 'bullmq';
import type { Mailbox, ScheduledEmail } from '@prisma/client';
import { env } from '../config/env.js';
import { childLogger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import { recordEvent } from '../services/events.js';
import { sendMail } from '../services/mailer.js';
import { consumeMailboxQuota, effectiveDailyLimit, refundMailboxQuota } from '../services/warmup.js';
import { injectTrackingPixel } from '../services/tracking.js';
import { consumeHourly, refundHourly, reserveSendSlot, type HourlyLimit } from '../services/throttle.js';
import type { SendEmailJobData } from './emailQueue.js';

const log = childLogger('worker');

/** Statuses a job is still allowed to act on when it wakes up. */
const SENDABLE_STATUSES: readonly ScheduledEmail['status'][] = ['PENDING', 'QUEUED', 'SENDING'];

export type ProcessOutcome =
  | { result: 'sent'; previewUrl: string | null }
  | { result: 'skipped'; reason: string }
  | { result: 'throttled'; retryInMs: number };

function fromAddress(mailbox: Mailbox | null): string {
  if (!mailbox) return 'TimedInk <no-reply@timedink.local>';
  return `${mailbox.fromName} <${mailbox.fromEmail}>`;
}

/**
 * A reserved slot this close is simply waited out in place. Anything further
 * away puts the job back in the delayed set, so it does not hold a concurrency
 * slot while it waits.
 */
const INLINE_WAIT_MAX_MS = 5_000;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Hold this job until its sender may send again (MIN_SEND_DELAY_MS).
 *
 * Throws DelayedError when the slot is far enough away that the job should go
 * back to sleep instead of waiting inline; BullMQ then re-runs it at the slot.
 */
async function waitForSendSlot(
  job: Job<SendEmailJobData>,
  token: string | undefined,
  senderId: string,
  jobLog: typeof log,
): Promise<void> {
  if (env.MIN_SEND_DELAY_MS <= 0) return;

  const reserved = job.data.sendSlotAt;
  if (reserved !== undefined) {
    // Woken for a slot reserved before the job was put to sleep: use it rather
    // than queueing behind everyone again.
    const { sendSlotAt: _used, ...rest } = job.data;
    await job.updateData(rest);
    const wait = reserved - Date.now();
    if (wait > 0) await sleep(wait);
    return;
  }

  const slot = await reserveSendSlot(senderId, env.MIN_SEND_DELAY_MS);
  const wait = slot - Date.now();
  if (wait <= 0) return;
  if (wait <= INLINE_WAIT_MAX_MS) {
    await sleep(wait);
    return;
  }

  jobLog.debug({ senderId, waitMs: wait }, 'sender is busy; sleeping until its reserved slot');
  await job.updateData({ ...job.data, sendSlotAt: slot });
  await job.moveToDelayed(slot, token);
  throw new DelayedError();
}

/** Truncate before it hits a TEXT column / the UI. */
const trimError = (message: string): string =>
  message.length > 2_000 ? `${message.slice(0, 2_000)}...` : message;

/**
 * The send pipeline for one scheduled email.
 *
 * Note that the job payload carries only an id: the row is re-read from MySQL
 * on every attempt, so a cancellation or an edit that happened while the job
 * was sitting in the delayed set is always respected.
 */
export async function processSendEmailJob(
  job: Job<SendEmailJobData>,
  token?: string,
): Promise<ProcessOutcome> {
  const { scheduledEmailId } = job.data;
  const jobLog = log.child({ emailId: scheduledEmailId, jobId: job.id, attempt: job.attemptsMade + 1 });

  const email = await prisma.scheduledEmail.findUnique({
    where: { id: scheduledEmailId },
    include: { mailbox: true },
  });

  // --- Guards --------------------------------------------------------------
  if (!email) {
    // The row was hard-deleted. Nothing to do, and retrying will not help.
    jobLog.warn('scheduled email row no longer exists; dropping job');
    return { result: 'skipped', reason: 'row-missing' };
  }

  if (!SENDABLE_STATUSES.includes(email.status)) {
    // Cancelled between being queued and being picked up, or already sent by a
    // duplicate job. The DB status wins over whatever Redis thinks.
    jobLog.info({ status: email.status }, 'skipping job: email is no longer sendable');
    return { result: 'skipped', reason: `status-${email.status}` };
  }

  // --- Spacing: minimum gap between sends from one sender ------------------
  // Runs before any quota is taken, so a job that goes back to sleep here has
  // not spent anything it would then spend a second time on waking.
  const senderId = email.mailboxId ?? `user-${email.userId}`;
  await waitForSendSlot(job, token, senderId, jobLog);

  // --- Bonus B: warmup / per-mailbox daily cap -----------------------------
  // Checked at the top of the processor, before any SMTP work. A job over its
  // mailbox's cap re-delays itself rather than failing - being over quota is a
  // scheduling condition, not an error.
  let quotaConsumed = false;
  if (env.WARMUP_ENABLED && email.mailbox) {
    const limit = effectiveDailyLimit(email.mailbox);
    const decision = await consumeMailboxQuota(email.mailbox.id, limit);

    if (!decision.allowed) {
      const retryInMs = env.WARMUP_RETRY_DELAY_MS;
      jobLog.info(
        { mailboxId: email.mailbox.id, used: decision.used, limit, retryInMs },
        'mailbox at its warmup daily limit; re-delaying job',
      );

      // BullMQ contract for "put me back to sleep from inside a processor":
      // moveToDelayed(...) then throw DelayedError so the worker does not treat
      // the return as a completion.
      await job.moveToDelayed(Date.now() + retryInMs, token);
      throw new DelayedError();
    }
    quotaConsumed = true;
  }

  // --- Hourly ceilings: global, per sender, and per bulk batch -------------
  const hourlyLimits: HourlyLimit[] = [
    { scope: 'global', id: 'all', limit: env.MAX_EMAILS_PER_HOUR },
    { scope: 'sender', id: senderId, limit: env.MAX_EMAILS_PER_HOUR_PER_SENDER },
    ...(email.batchId && email.hourlyLimit
      ? [{ scope: 'batch', id: email.batchId, limit: email.hourlyLimit }]
      : []),
  ];
  const hourly = await consumeHourly(hourlyLimits, email.scheduledAt);

  if (!hourly.allowed) {
    if (quotaConsumed && email.mailbox) {
      await refundMailboxQuota(email.mailbox.id).catch((refundErr: unknown) =>
        jobLog.warn({ err: refundErr }, 'failed to refund warmup quota'),
      );
    }

    const reason = `${hourly.hit.scope} hourly limit (${hourly.hit.limit}/h) reached`;
    jobLog.info({ ...hourly.hit, retryAt: new Date(hourly.retryAt).toISOString() }, `${reason}; deferring to next window`);
    await recordEvent(email.id, 'QUEUED', {
      deferred: true,
      reason,
      retryAt: new Date(hourly.retryAt).toISOString(),
    });

    // Over the hour's budget is a scheduling condition, not a failure: the job
    // keeps its attempts and simply wakes up in the next window.
    await job.moveToDelayed(hourly.retryAt, token);
    throw new DelayedError();
  }

  // --- Send ----------------------------------------------------------------
  const attemptNumber = job.attemptsMade + 1;

  await prisma.scheduledEmail.update({
    where: { id: email.id },
    data: { status: 'SENDING', attempts: attemptNumber },
  });
  await recordEvent(email.id, 'SENDING', { attempt: attemptNumber, jobId: job.id });

  try {
    // Bonus C: only embed a pixel when this email actually needs open tracking.
    const html = email.followUpAfterHours
      ? injectTrackingPixel(email.bodyHtml, email.id)
      : email.bodyHtml;

    const info = await sendMail({
      from: fromAddress(email.mailbox),
      to: email.to,
      cc: email.cc,
      subject: email.subject,
      html,
      text: email.bodyText,
    });

    await prisma.scheduledEmail.update({
      where: { id: email.id },
      data: {
        status: 'SENT',
        sentAt: new Date(),
        previewUrl: info.previewUrl,
        lastError: null,
        attempts: attemptNumber,
      },
    });
    await recordEvent(email.id, 'SENT', {
      messageId: info.messageId,
      previewUrl: info.previewUrl,
      accepted: info.accepted,
      attempt: attemptNumber,
    });

    jobLog.info({ previewUrl: info.previewUrl, to: email.to }, 'email sent');
    return { result: 'sent', previewUrl: info.previewUrl };
  } catch (err) {
    // We reserved warmup budget but never handed anything to the provider on a
    // connection-level failure - give the unit back so a flaky SMTP hop does
    // not eat the mailbox's daily allowance.
    if (quotaConsumed && email.mailbox) {
      await refundMailboxQuota(email.mailbox.id).catch((refundErr: unknown) =>
        jobLog.warn({ err: refundErr }, 'failed to refund warmup quota'),
      );
    }
    await refundHourly(hourlyLimits).catch((refundErr: unknown) =>
      jobLog.warn({ err: refundErr }, 'failed to refund hourly quota'),
    );

    const message = trimError(err instanceof Error ? err.message : String(err));
    const isFinalAttempt = attemptNumber >= (job.opts.attempts ?? env.JOB_ATTEMPTS);

    await prisma.scheduledEmail.update({
      where: { id: email.id },
      data: {
        // Between retries the row goes back to QUEUED so the dashboard shows it
        // as still in flight; it only lands in FAILED once BullMQ has exhausted
        // its attempts. See ASSUMPTIONS.md.
        status: isFinalAttempt ? 'FAILED' : 'QUEUED',
        lastError: message,
        attempts: attemptNumber,
      },
    });
    await recordEvent(email.id, 'FAILED', {
      attempt: attemptNumber,
      maxAttempts: job.opts.attempts ?? env.JOB_ATTEMPTS,
      final: isFinalAttempt,
      error: message,
    });

    jobLog.error({ err, final: isFinalAttempt }, 'send failed');

    // Rethrow so BullMQ applies its exponential backoff and retries.
    if (isFinalAttempt) throw new UnrecoverableError(message);
    throw err;
  }
}
