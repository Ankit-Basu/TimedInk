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
  createScheduledEmail,
  rescheduleEmail,
} from '../services/scheduling.js';
import { scoreDeliverability } from '../services/deliverability.js';

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
