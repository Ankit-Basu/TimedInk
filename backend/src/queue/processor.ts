import { DelayedError, UnrecoverableError, type Job } from 'bullmq';
import type { Mailbox, ScheduledEmail } from '@prisma/client';
import { env } from '../config/env.js';
import { childLogger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import { recordEvent } from '../services/events.js';
import { sendMail } from '../services/mailer.js';
import { consumeMailboxQuota, effectiveDailyLimit, refundMailboxQuota } from '../services/warmup.js';
import { injectTrackingPixel } from '../services/tracking.js';
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
