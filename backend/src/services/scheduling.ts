import type { Prisma, ScheduledEmail } from '@prisma/client';
import { env } from '../config/env.js';
import { childLogger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import { redis } from '../lib/redis.js';
import { badRequest, conflict, notFound } from '../lib/errors.js';
import { htmlToText } from '../lib/html.js';
import { renderEmailHtml } from '../lib/emailTemplate.js';
import {
  emailQueue,
  jobIdForEmail,
  SEND_EMAIL_JOB,
  type SendEmailJobData,
} from '../queue/emailQueue.js';
import { recordEvent } from './events.js';
import { scoreDeliverability } from './deliverability.js';

const log = childLogger('scheduling');

export interface CreateScheduledEmailInput {
  userId: string;
  to: string;
  cc?: string | null;
  subject: string;
  /** Plain-text body as typed in the compose form. */
  bodyText?: string;
  /** Optional pre-rendered HTML; derived from bodyText when omitted. */
  bodyHtml?: string;
  /** Absolute send time. Always UTC by the time it reaches here. */
  scheduledAt: Date;
  /** IANA zone the user composed in, e.g. "Asia/Kolkata". */
  timezone: string;
  /** Explicit mailbox; when omitted we round-robin (bonus C). */
  mailboxId?: string | null;
  /** Bonus C - queue a follow-up if no OPENED event within N hours. */
  followUpAfterHours?: number | null;
  /** Set when this row *is* the follow-up of an earlier email. */
  followUpOfId?: string | null;
}

/**
 * Round-robin a user's mailboxes.
 *
 * A Redis counter (rather than "least recently used" in SQL) keeps this O(1)
 * and correct across multiple API processes. If Redis is unavailable we fall
 * back to the oldest mailbox rather than failing the request - an uneven
 * distribution is much cheaper than a dropped email.
 */
export async function pickMailboxId(
  userId: string,
  explicitMailboxId?: string | null,
): Promise<string | null> {
  if (explicitMailboxId) {
    const owned = await prisma.mailbox.findFirst({
      where: { id: explicitMailboxId, userId },
      select: { id: true },
    });
    if (!owned) throw badRequest('mailboxId does not belong to this user');
    return owned.id;
  }

  const mailboxes = await prisma.mailbox.findMany({
    where: { userId },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  if (mailboxes.length === 0) return null;
  if (!env.MAILBOX_ROTATION_ENABLED || mailboxes.length === 1) return mailboxes[0]!.id;

  try {
    const counter = await redis.incr(`rotation:mailbox:${userId}`);
    const index = (counter - 1) % mailboxes.length;
    return mailboxes[index]!.id;
  } catch (err) {
    log.warn({ err, userId }, 'rotation counter unavailable; falling back to first mailbox');
    return mailboxes[0]!.id;
  }
}

/**
 * Put a row on the queue and move it to QUEUED.
 *
 * Shared by the create path and the boot-time reconciler, so both use exactly
 * the same deterministic jobId and the same delay maths. `queue.add` with an
 * existing jobId is a no-op in BullMQ, which is what makes replaying safe.
 */
export async function enqueueScheduledEmail(
  row: Pick<ScheduledEmail, 'id' | 'userId' | 'scheduledAt'>,
  now: Date = new Date(),
): Promise<{ jobId: string; delayMs: number }> {
  const delayMs = Math.max(0, row.scheduledAt.getTime() - now.getTime());
  const jobId = jobIdForEmail(row.id);

  const payload: SendEmailJobData = {
    scheduledEmailId: row.id,
    userId: row.userId,
    enqueuedAt: now.toISOString(),
  };

  await emailQueue.add(SEND_EMAIL_JOB, payload, { delay: delayMs, jobId });

  await prisma.scheduledEmail.update({
    where: { id: row.id },
    data: { status: 'QUEUED', bullJobId: jobId },
  });
  await recordEvent(row.id, 'QUEUED', {
    jobId,
    delayMs,
    scheduledAt: row.scheduledAt.toISOString(),
  });

  return { jobId, delayMs };
}

/**
 * Create a scheduled email.
 *
 * Ordering matters and is deliberate:
 *   1. write the row to MySQL as PENDING  (durable source of truth)
 *   2. compute delay = scheduledAt - now
 *   3. add the delayed BullMQ job with jobId = `email-<row.id>`
 *   4. flip the row to QUEUED and store bullJobId
 *
 * If the process dies between (1) and (3) the row is left PENDING and the
 * boot-time reconciler picks it up. The reverse order - Redis first - could
 * produce a job for a row that never existed.
 */
export async function createScheduledEmail(
  input: CreateScheduledEmailInput,
): Promise<ScheduledEmail> {
  const bodyText = input.bodyText ?? (input.bodyHtml ? htmlToText(input.bodyHtml) : '');

  // Bonus A: informational only - a bad score never blocks scheduling.
  const deliverability = scoreDeliverability(input.subject, bodyText);

  const mailboxId = await pickMailboxId(input.userId, input.mailboxId);

  // Render the HTML part against the resolved mailbox, so the sender's display
  // name can appear in the masthead. An explicit bodyHtml from the caller wins.
  const mailbox = mailboxId
    ? await prisma.mailbox.findUnique({ where: { id: mailboxId }, select: { fromName: true } })
    : null;
  const bodyHtml =
    input.bodyHtml ??
    renderEmailHtml(bodyText, { fromName: mailbox?.fromName ?? null, subject: input.subject });

  const created = await prisma.scheduledEmail.create({
    data: {
      userId: input.userId,
      mailboxId,
      to: input.to,
      cc: input.cc ?? null,
      subject: input.subject,
      bodyHtml,
      bodyText,
      scheduledAt: input.scheduledAt,
      timezone: input.timezone,
      status: 'PENDING',
      deliverabilityScore: deliverability.score,
      deliverabilityFlags: deliverability.details as unknown as Prisma.InputJsonValue,
      followUpAfterHours: input.followUpAfterHours ?? null,
      followUpOfId: input.followUpOfId ?? null,
    },
  });

  await recordEvent(created.id, 'CREATED', {
    scheduledAt: created.scheduledAt.toISOString(),
    timezone: created.timezone,
    mailboxId,
    deliverabilityScore: deliverability.score,
  });

  try {
    const { delayMs } = await enqueueScheduledEmail(created);
    log.info(
      { emailId: created.id, delayMs, scheduledAt: created.scheduledAt.toISOString(), mailboxId },
      'scheduled email queued',
    );
  } catch (err) {
    // Redis is down. The row stays PENDING; the reconciler will queue it on the
    // next boot, and the API still reports success because the *intent* is
    // durably recorded. Surfacing a 500 here would be misleading.
    log.error(
      { err, emailId: created.id },
      'failed to enqueue job; row left PENDING for reconciliation',
    );
  }

  const fresh = await prisma.scheduledEmail.findUnique({ where: { id: created.id } });
  return fresh ?? created;
}

const CANCELLABLE_STATUSES: readonly ScheduledEmail['status'][] = ['PENDING', 'QUEUED'];

/**
 * Cancel a not-yet-sent email: drop the Redis job, then mark the row CANCELLED.
 *
 * There is an unavoidable race where the worker picks the job up in between.
 * The worker closes it by re-reading the row and refusing to send anything that
 * is no longer PENDING/QUEUED - so the DB status is the tiebreaker, not Redis.
 */
export async function cancelScheduledEmail(userId: string, id: string): Promise<ScheduledEmail> {
  const existing = await prisma.scheduledEmail.findFirst({ where: { id, userId } });
  if (!existing) throw notFound('Scheduled email not found');

  if (!CANCELLABLE_STATUSES.includes(existing.status)) {
    throw conflict(`Cannot cancel an email with status ${existing.status}`, {
      status: existing.status,
    });
  }

  const jobId = existing.bullJobId ?? jobIdForEmail(existing.id);
  try {
    const job = await emailQueue.getJob(jobId);
    if (job) await job.remove();
  } catch (err) {
    // A locked (actively processing) job cannot be removed. Fall through: the
    // status flip below still stops the send.
    log.warn({ err, emailId: id, jobId }, 'could not remove bull job during cancel');
  }

  const updated = await prisma.scheduledEmail.update({
    where: { id },
    data: { status: 'CANCELLED', bullJobId: null },
  });
  await recordEvent(id, 'CANCELLED', { cancelledBy: userId, previousStatus: existing.status });
  log.info({ emailId: id }, 'scheduled email cancelled');

  return updated;
}
