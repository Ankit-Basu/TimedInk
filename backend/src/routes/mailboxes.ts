import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { notFound } from '../lib/errors.js';
import { requireAuth, currentUser } from '../middleware/auth.js';
import { asyncHandler } from '../middleware/error.js';
import { validate, validated } from '../middleware/validate.js';
import { toMailboxDto } from '../lib/dto.js';
import {
  WARMUP_CEILING,
  dailyLimitForWarmupDay,
  getQuotaUsage,
} from '../services/warmup.js';
import { childLogger } from '../lib/logger.js';

const log = childLogger('mailboxes');

export const mailboxesRouter = Router();

mailboxesRouter.use(requireAuth);

const idParamSchema = z.object({ id: z.string().uuid() });

const createMailboxSchema = z.object({
  fromName: z.string().trim().min(1).max(120),
  fromEmail: z.email(),
  warmupDay: z.coerce.number().int().min(1).max(60).default(1),
  dailyLimit: z.coerce.number().int().min(1).max(10_000).default(WARMUP_CEILING),
});

type CreateMailboxBody = z.infer<typeof createMailboxSchema>;

/** GET /api/mailboxes - includes today's warmup usage for the dashboard. */
mailboxesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const user = currentUser(req);

    const mailboxes = await prisma.mailbox.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'asc' },
    });

    const dtos = await Promise.all(
      mailboxes.map(async (mailbox) => toMailboxDto(mailbox, await getQuotaUsage(mailbox.id))),
    );

    res.json({ data: dtos });
  }),
);

mailboxesRouter.post(
  '/',
  validate({ body: createMailboxSchema }),
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const body = validated<CreateMailboxBody>(res, 'body');

    const mailbox = await prisma.mailbox.create({
      data: {
        userId: user.id,
        fromName: body.fromName,
        fromEmail: body.fromEmail,
        warmupDay: body.warmupDay,
        dailyLimit: body.dailyLimit,
      },
    });

    res.status(201).json({ data: toMailboxDto(mailbox, 0) });
  }),
);

/**
 * POST /api/mailboxes/:id/advance-warmup
 *
 * Demo affordance for bonus B: warmup normally advances one day per real day,
 * which is unwatchable in a five-minute video. This bumps warmupDay by one (or
 * by `days`) so the rising daily limit can be shown live.
 */
mailboxesRouter.post(
  '/:id/advance-warmup',
  validate({
    params: idParamSchema,
    body: z.object({ days: z.coerce.number().int().min(-60).max(60).default(1) }),
  }),
  asyncHandler(async (req, res) => {
    const user = currentUser(req);
    const { id } = validated<{ id: string }>(res, 'params');
    const { days } = validated<{ days: number }>(res, 'body');

    const mailbox = await prisma.mailbox.findFirst({ where: { id, userId: user.id } });
    if (!mailbox) throw notFound('Mailbox not found');

    const warmupDay = Math.min(60, Math.max(1, mailbox.warmupDay + days));
    const updated = await prisma.mailbox.update({
      where: { id },
      data: { warmupDay, dailyLimit: Math.max(mailbox.dailyLimit, dailyLimitForWarmupDay(warmupDay)) },
    });

    log.info(
      { mailboxId: id, from: mailbox.warmupDay, to: warmupDay, limit: dailyLimitForWarmupDay(warmupDay) },
      'warmup day advanced',
    );

    res.json({ data: toMailboxDto(updated, await getQuotaUsage(updated.id)) });
  }),
);
