import { randomUUID } from 'node:crypto';
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
  /** Shared by every row of one bulk request. */
  batchId?: string | null;
  /** That bulk request's own hourly cap, enforced by the worker per batch. */
  hourlyLimit?: number | null;
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
      batchId: input.batchId ?? null,
      hourlyLimit: input.hourlyLimit ?? null,
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

/**
 * Lay out send times for a bulk request.
 *
 * Recipient i goes out `delayBetweenMs` after recipient i-1. When an hourly
 * limit is set and that spacing would overrun it, the schedule rolls into the
 * next hour instead: recipient i lands in hour floor(i / hourlyLimit) after the
 * start. The worker enforces the same limit again at send time, so this plan is
 * what makes the dashboard show honest times, not the only line of defence.
 *
 * Pure, so it can be tested without a queue.
 */
export function planBulkSchedule(
  count: number,
  startAt: Date,
  delayBetweenMs: number,
  hourlyLimit?: number | null,
): Date[] {
  const HOUR = 60 * 60 * 1000;
  const start = startAt.getTime();
  const times: Date[] = [];

  for (let i = 0; i < count; i += 1) {
    let at = start + i * delayBetweenMs;
    if (hourlyLimit && hourlyLimit > 0) {
      const hour = Math.floor(i / hourlyLimit);
      const indexInHour = i % hourlyLimit;
      at = Math.max(at, start + hour * HOUR + indexInHour * delayBetweenMs);
    }
    times.push(new Date(at));
  }

  return times;
}

export interface BulkScheduleInput
  extends Omit<CreateScheduledEmailInput, 'to' | 'scheduledAt' | 'batchId' | 'hourlyLimit'> {
  recipients: string[];
  startAt: Date;
  delayBetweenMs: number;
  hourlyLimit?: number | null;
}

/** How many rows are written and queued at once during a bulk create. */
const BULK_CONCURRENCY = 8;

/**
 * Schedule one email per recipient, as a single batch.
 *
 * Each row goes through the same createScheduledEmail path as a single send —
 * same durability ordering, same deterministic job id — so a crash part-way
 * through leaves every row already written either queued or PENDING for the
 * reconciler. Nothing about a batch is special to the restart story.
 */
export async function createBulkScheduledEmails(
  input: BulkScheduleInput,
): Promise<{ batchId: string; emails: ScheduledEmail[] }> {
  const batchId = randomUUID();
  const { recipients, startAt, delayBetweenMs, hourlyLimit, ...shared } = input;
  const times = planBulkSchedule(recipients.length, startAt, delayBetweenMs, hourlyLimit);
  const emails: ScheduledEmail[] = new Array(recipients.length);

  for (let offset = 0; offset < recipients.length; offset += BULK_CONCURRENCY) {
    const chunk = recipients.slice(offset, offset + BULK_CONCURRENCY);
    const created = await Promise.all(
      chunk.map((to, i) =>
        createScheduledEmail({
          ...shared,
          to,
          scheduledAt: times[offset + i]!,
          batchId,
          hourlyLimit: hourlyLimit ?? null,
        }),
      ),
    );
    created.forEach((row, i) => {
      emails[offset + i] = row;
    });
  }

  log.info(
    {
      batchId,
      count: recipients.length,
      firstAt: times[0]?.toISOString(),
      lastAt: times.at(-1)?.toISOString(),
      delayBetweenMs,
      hourlyLimit,
    },
    'bulk batch scheduled',
  );

  return { batchId, emails };
}

const CANCELLABLE_STATUSES: readonly ScheduledEmail['status'][] = ['PENDING', 'QUEUED'];

/**
 * Move a not-yet-sent email to a new send time.
 *
 * The interesting part is the queue side. Cancelling and re-adding would churn
 * the job and lose its attempt history, so this uses BullMQ's `changeDelay`,
 * which rewrites the delay on the existing delayed job in place. If the job has
 * gone from Redis — evicted, flushed, or never added because Redis was down —
 * it falls back to the same enqueue path the create flow and the reconciler
 * use, so the row is repaired rather than left dangling.
 *
 * MySQL is updated first, for the same reason the create path writes the row
 * before touching Redis: the intent has to be durable before the derived index
 * moves.
 */
export async function rescheduleEmail(
  userId: string,
  id: string,
  scheduledAt: Date,
  now: Date = new Date(),
): Promise<ScheduledEmail> {
  const existing = await prisma.scheduledEmail.findFirst({ where: { id, userId } });
  if (!existing) throw notFound('Scheduled email not found');

  if (!CANCELLABLE_STATUSES.includes(existing.status)) {
    throw conflict(`Cannot reschedule an email with status ${existing.status}`, {
      status: existing.status,
    });
  }

  const previous = existing.scheduledAt;
  const delayMs = Math.max(0, scheduledAt.getTime() - now.getTime());

  const updated = await prisma.scheduledEmail.update({
    where: { id },
    data: { scheduledAt },
  });

  const jobId = existing.bullJobId ?? jobIdForEmail(existing.id);
  let strategy: 'changeDelay' | 're-enqueued' = 'changeDelay';

  try {
    const job = await emailQueue.getJob(jobId);
    if (job) {
      await job.changeDelay(delayMs);
    } else {
      // The row is real but the job is not — repair it through the shared path.
      strategy = 're-enqueued';
      await enqueueScheduledEmail(updated, now);
    }
  } catch (err) {
    log.error({ err, emailId: id, jobId }, 'failed to move the queued job; reconciler will repair');
  }

  await recordEvent(id, 'QUEUED', {
    rescheduled: true,
    strategy,
    from: previous.toISOString(),
    to: scheduledAt.toISOString(),
    delayMs,
  });

  log.info(
    { emailId: id, from: previous.toISOString(), to: scheduledAt.toISOString(), delayMs, strategy },
    'scheduled email rescheduled',
  );

  return updated;
}

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
