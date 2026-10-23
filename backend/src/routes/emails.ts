import { Router } from 'express';
import { z } from 'zod';
import { EmailStatus } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { notFound } from '../lib/errors.js';
import { requireAuth, currentUser } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/error.js';
import { validate, validated } from '../middleware/validate.js';
import {
  paginated,
  toScheduledEmailDetailDto,
  toScheduledEmailDto,
  type ScheduledEmailDto,
} from '../lib/dto.js';
import {
  cancelScheduledEmail,
  createBulkScheduledEmails,
  createScheduledEmail,
  rescheduleEmail,
} from '../services/scheduling.js';
import { scoreDeliverability } from '../services/deliverability.js';
import { hourlyUsage } from '../services/throttle.js';
import { env } from '../config/env.js';

export const emailsRouter = Router();

emailsRouter.use(requireAuth);

const EMAIL_STATUSES = Object.values(EmailStatus) as [EmailStatus, ...EmailStatus[]];

/** Accepts "a@b.com" or "a@b.com, c@d.com" - Nodemailer takes either. */
const emailList = z
  .string()
  .trim()
  .min(1)
  .refine(
    (value) =>
      value
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean)
        .every((part) => z.email().safeParse(part).success),
    { message: 'Must be a comma-separated list of valid email addresses' },
  );

const createEmailSchema = z.object({
  to: emailList,
  cc: emailList.nullish(),
  subject: z.string().trim().min(1, 'Subject is required').max(998),
  /** Plain-text body from the compose textarea. */
  body: z.string().max(100_000).default(''),
  /** Optional pre-rendered HTML; derived from `body` when absent. */
  bodyHtml: z.string().max(200_000).optional(),
  /**
   * Absolute instant, ISO-8601, already converted to UTC by the client.
   * A time in the past is allowed on purpose: delay clamps to 0 and the email
   * goes out immediately, which is how the demo sends "now".
   */
  scheduledAt: z.coerce.date().refine((d) => !Number.isNaN(d.getTime()), {
    message: 'scheduledAt must be a valid ISO-8601 datetime',
  }),
  /** IANA zone the user composed in, recorded for display only. */
  timezone: z.string().trim().min(1).max(64).default('UTC'),
  mailboxId: z.string().uuid().nullish(),
  /** Bonus C. Capped at 30 days. */
  followUpAfterHours: z.coerce.number().int().min(1).max(720).nullish(),
});

type CreateEmailBody = z.infer<typeof createEmailSchema>;

/**
 * Bulk request, as sent by the compose form after it has parsed an uploaded
 * CSV / text file. The file itself never reaches the server — the browser
 * extracts the addresses, so the API takes a plain list it can validate.
 */
const bulkEmailSchema = z.object({
  recipients: z
    .array(z.string().trim().toLowerCase().pipe(z.email('Every recipient must be a valid email address')))
    .min(1, 'Add at least one recipient')
    .max(env.BULK_MAX_RECIPIENTS, `At most ${env.BULK_MAX_RECIPIENTS} recipients per request`)
    // The same address twice in one upload is almost always a CSV artefact.
    .transform((list) => [...new Set(list)]),
  subject: z.string().trim().min(1, 'Subject is required').max(998),
  body: z.string().max(100_000).default(''),
  /** When the first email goes out. ISO-8601, already UTC. */
  startAt: z.coerce.date().refine((d) => !Number.isNaN(d.getTime()), {
    message: 'startAt must be a valid ISO-8601 datetime',
  }),
  /** Gap between consecutive recipients, in seconds. */
  delayBetweenSeconds: z.coerce.number().int().min(0).max(86_400).default(2),
  /** This batch's own ceiling, on top of the server-wide ones. */
  hourlyLimit: z.coerce.number().int().min(1).max(10_000).nullish(),
  timezone: z.string().trim().min(1).max(64).default('UTC'),
  followUpAfterHours: z.coerce.number().int().min(1).max(720).nullish(),
});

type BulkEmailBody = z.infer<typeof bulkEmailSchema>;

const listEmailsSchema = z.object({
  /** Single status, or a comma-separated list ("SENT,FAILED"). */
  status: z
    .string()
    .optional()
    .transform((value) =>
      value
        ? value
            .split(',')
            .map((s) => s.trim().toUpperCase())
            .filter(Boolean)
        : undefined,
    )
    .refine(
      (values) => !values || values.every((v) => EMAIL_STATUSES.includes(v as EmailStatus)),
      { message: `status must be one of: ${EMAIL_STATUSES.join(', ')}` },
    ),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  /** Free-text match on recipient or subject. */
  q: z.string().trim().max(200).optional(),
});

type ListEmailsQuery = z.infer<typeof listEmailsSchema>;

const idParamSchema = z.object({ id: z.string().uuid('Not a valid id') });

/**
 * POST /api/emails
 *
 * Writes the row first (PENDING), then enqueues a delayed BullMQ job keyed on
 * the row id. See services/scheduling.ts for why that ordering matters.
 */
emailsRouter.post(
  '/',
  validate({ body: createEmailSchema }),
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const body = validated<CreateEmailBody>(res, 'body');

    const email = await createScheduledEmail({
      userId: user.id,
      to: body.to,
      cc: body.cc ?? null,
      subject: body.subject,
      bodyText: body.body,
      ...(body.bodyHtml ? { bodyHtml: body.bodyHtml } : {}),
      scheduledAt: body.scheduledAt,
      timezone: body.timezone,
      mailboxId: body.mailboxId ?? null,
      followUpAfterHours: body.followUpAfterHours ?? null,
    });

    const withMailbox = await prisma.scheduledEmail.findUniqueOrThrow({
      where: { id: email.id },
      include: { mailbox: true },
    });

    res.status(201).json({ data: toScheduledEmailDto(withMailbox) });
  }),
);

/**
 * POST /api/emails/bulk
 *
 * One row and one delayed job per recipient, spaced `delayBetweenSeconds`
 * apart and rolled into later hours when `hourlyLimit` would be exceeded.
 */
emailsRouter.post(
  '/bulk',
  validate({ body: bulkEmailSchema }),
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const body = validated<BulkEmailBody>(res, 'body');

    const { batchId, emails } = await createBulkScheduledEmails({
      userId: user.id,
      recipients: body.recipients,
      subject: body.subject,
      bodyText: body.body,
      startAt: body.startAt,
      delayBetweenMs: body.delayBetweenSeconds * 1000,
      hourlyLimit: body.hourlyLimit ?? null,
      timezone: body.timezone,
      followUpAfterHours: body.followUpAfterHours ?? null,
    });

    res.status(201).json({
      data: {
        batchId,
        count: emails.length,
        firstAt: emails[0]?.scheduledAt.toISOString() ?? null,
        lastAt: emails.at(-1)?.scheduledAt.toISOString() ?? null,
      },
    });
  }),
);

/**
 * GET /api/emails/throughput
 *
 * The pacing rules the worker is enforcing and how much of this hour's global
 * budget is already spent — so the dashboard can show the limits, not just
 * claim them.
 */
emailsRouter.get(
  '/throughput',
  asyncHandler(async (_req, res) => {
    const [globalUsed] = await hourlyUsage([{ scope: 'global', id: 'all' }]).catch(() => [0]);
    res.json({
      data: {
        minSendDelayMs: env.MIN_SEND_DELAY_MS,
        maxPerHour: env.MAX_EMAILS_PER_HOUR,
        maxPerHourPerSender: env.MAX_EMAILS_PER_HOUR_PER_SENDER,
        usedThisHour: globalUsed ?? 0,
        workerConcurrency: env.WORKER_CONCURRENCY,
        bulkMaxRecipients: env.BULK_MAX_RECIPIENTS,
      },
    });
  }),
);

/**
 * GET /api/emails?status=SENT&page=1&pageSize=20
 *
 * Scoped to the caller. This is what the dashboard polls every few seconds.
 */
emailsRouter.get(
  '/',
  validate({ query: listEmailsSchema }),
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const query = validated<ListEmailsQuery>(res, 'query');

    const where = {
      userId: user.id,
      ...(query.status?.length ? { status: { in: query.status as EmailStatus[] } } : {}),
      ...(query.q
        ? {
            OR: [
              { to: { contains: query.q } },
              { subject: { contains: query.q } },
            ],
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      prisma.scheduledEmail.findMany({
        where,
        include: { mailbox: true },
        orderBy: { scheduledAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      prisma.scheduledEmail.count({ where }),
    ]);

    const data: ScheduledEmailDto[] = rows.map(toScheduledEmailDto);
    res.json(paginated(data, query.page, query.pageSize, total));
  }),
);

/** Per-status counts, so the dashboard tabs can show badges in one request. */
emailsRouter.get(
  '/stats',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);

    const grouped = await prisma.scheduledEmail.groupBy({
      by: ['status'],
      where: { userId: user.id },
      _count: { _all: true },
    });

    const counts = Object.fromEntries(EMAIL_STATUSES.map((s) => [s, 0])) as Record<
      EmailStatus,
      number
    >;
    for (const row of grouped) counts[row.status] = row._count._all;

    res.json({ data: { counts, total: Object.values(counts).reduce((a, b) => a + b, 0) } });
  }),
);

/**
 * Live deliverability scoring for the compose form. Pure function, no writes -
 * lets the UI show the score before the user commits.
 */
emailsRouter.post(
  '/preview-score',
  validate({
    body: z.object({ subject: z.string().default(''), body: z.string().default('') }),
  }),
  asyncHandler(async (_req, res) => {
    const { subject, body } = validated<{ subject: string; body: string }>(res, 'body');
    res.json({ data: scoreDeliverability(subject, body) });
  }),
);

/** Full detail including the event timeline. */
emailsRouter.get(
  '/:id',
  validate({ params: idParamSchema }),
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const { id } = validated<{ id: string }>(res, 'params');

    const email = await prisma.scheduledEmail.findFirst({
      where: { id, userId: user.id },
      include: { mailbox: true, events: { orderBy: { createdAt: 'asc' } } },
    });
    if (!email) throw notFound('Scheduled email not found');

    res.json({ data: toScheduledEmailDetailDto(email) });
  }),
);

const rescheduleSchema = z.object({
  /** New absolute instant, ISO-8601, already converted to UTC by the client. */
  scheduledAt: z.coerce.date().refine((d) => !Number.isNaN(d.getTime()), {
    message: 'scheduledAt must be a valid ISO-8601 datetime',
  }),
});

/**
 * PATCH /api/emails/:id/schedule - move a PENDING/QUEUED email to a new time.
 *
 * Uses BullMQ's changeDelay on the existing job rather than cancel-and-recreate,
 * so the job keeps its identity and attempt history.
 */
emailsRouter.patch(
  '/:id/schedule',
  validate({ params: idParamSchema, body: rescheduleSchema }),
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const { id } = validated<{ id: string }>(res, 'params');
    const { scheduledAt } = validated<{ scheduledAt: Date }>(res, 'body');

    await rescheduleEmail(user.id, id, scheduledAt);

    const withMailbox = await prisma.scheduledEmail.findUniqueOrThrow({
      where: { id },
      include: { mailbox: true },
    });
    res.json({ data: toScheduledEmailDto(withMailbox) });
  }),
);

/** DELETE /api/emails/:id - cancel a PENDING/QUEUED email. */
emailsRouter.delete(
  '/:id',
  validate({ params: idParamSchema }),
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const { id } = validated<{ id: string }>(res, 'params');

    const cancelled = await cancelScheduledEmail(user.id, id);
    res.json({ data: toScheduledEmailDto(cancelled) });
  }),
);
