import type { EmailEventType, Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { childLogger } from '../lib/logger.js';

const log = childLogger('events');

/** Either the root client or a transaction client — both satisfy this. */
type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Append an immutable audit row for a state transition.
 *
 * Every status change on a ScheduledEmail gets one of these. Together they form
 * the per-email timeline the dashboard shows and the trail you'd reach for when
 * asked "why did this email go out at 3am?".
 *
 * Failing to write an *event* must never fail the operation that caused it, so
 * this swallows and logs rather than throwing.
 */
export async function recordEvent(
  scheduledEmailId: string,
  type: EmailEventType,
  meta?: Prisma.InputJsonValue,
  db: Db = prisma,
): Promise<void> {
  try {
    await db.emailEvent.create({
      data: { scheduledEmailId, type, ...(meta === undefined ? {} : { meta }) },
    });
  } catch (err) {
    log.error({ err, scheduledEmailId, type }, 'failed to write email event');
  }
}
