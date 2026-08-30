import type { EmailEvent, Mailbox, ScheduledEmail } from '@prisma/client';
import type { DeliverabilityFlag } from '../services/deliverability.js';
import { effectiveDailyLimit } from '../services/warmup.js';

/**
 * Wire shapes. Kept explicit rather than returning Prisma rows directly: the
 * DB row carries things the client has no business seeing (bodyHtml with an
 * embedded tracking pixel, internal job ids), and an explicit DTO means a
 * schema change cannot silently alter the public API.
 */

export interface MailboxSummaryDto {
  id: string;
  fromName: string;
  fromEmail: string;
}

export interface ScheduledEmailDto {
  id: string;
  to: string;
  cc: string | null;
  subject: string;
  scheduledAt: string;
  timezone: string;
  status: ScheduledEmail['status'];
  attempts: number;
  lastError: string | null;
  previewUrl: string | null;
  deliverabilityScore: number | null;
  deliverabilityFlags: DeliverabilityFlag[];
  mailbox: MailboxSummaryDto | null;
  followUpOfId: string | null;
  followUpAfterHours: number | null;
  openedAt: string | null;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduledEmailDetailDto extends ScheduledEmailDto {
  bodyText: string;
  events: EmailEventDto[];
}

export interface EmailEventDto {
  id: string;
  type: EmailEvent['type'];
  meta: unknown;
  createdAt: string;
}

export interface MailboxDto {
  id: string;
  fromName: string;
  fromEmail: string;
  warmupDay: number;
  dailyLimit: number;
  /** min(warmup ramp, explicit dailyLimit) - what the worker actually enforces. */
  effectiveDailyLimit: number;
  /** Sends already consumed in the current UTC day. */
  usedToday: number;
  createdAt: string;
}

type EmailWithMailbox = ScheduledEmail & { mailbox?: Mailbox | null };

/** `deliverabilityFlags` is a Json column, so it comes back as `unknown`. */
function readFlags(value: unknown): DeliverabilityFlag[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (f): f is DeliverabilityFlag =>
      typeof f === 'object' && f !== null && 'code' in f && 'message' in f,
  );
}

export function toScheduledEmailDto(email: EmailWithMailbox): ScheduledEmailDto {
  return {
    id: email.id,
    to: email.to,
    cc: email.cc,
    subject: email.subject,
    scheduledAt: email.scheduledAt.toISOString(),
    timezone: email.timezone,
    status: email.status,
    attempts: email.attempts,
    lastError: email.lastError,
    previewUrl: email.previewUrl,
    deliverabilityScore: email.deliverabilityScore,
    deliverabilityFlags: readFlags(email.deliverabilityFlags),
    mailbox: email.mailbox
      ? { id: email.mailbox.id, fromName: email.mailbox.fromName, fromEmail: email.mailbox.fromEmail }
      : null,
    followUpOfId: email.followUpOfId,
    followUpAfterHours: email.followUpAfterHours,
    openedAt: email.openedAt?.toISOString() ?? null,
    sentAt: email.sentAt?.toISOString() ?? null,
    createdAt: email.createdAt.toISOString(),
    updatedAt: email.updatedAt.toISOString(),
  };
}

export function toEmailEventDto(event: EmailEvent): EmailEventDto {
  return {
    id: event.id,
    type: event.type,
    meta: event.meta ?? null,
    createdAt: event.createdAt.toISOString(),
  };
}

export function toScheduledEmailDetailDto(
  email: EmailWithMailbox & { events: EmailEvent[] },
): ScheduledEmailDetailDto {
  return {
    ...toScheduledEmailDto(email),
    bodyText: email.bodyText,
    events: email.events.map(toEmailEventDto),
  };
}

export function toMailboxDto(mailbox: Mailbox, usedToday: number): MailboxDto {
  return {
    id: mailbox.id,
    fromName: mailbox.fromName,
    fromEmail: mailbox.fromEmail,
    warmupDay: mailbox.warmupDay,
    dailyLimit: mailbox.dailyLimit,
    effectiveDailyLimit: effectiveDailyLimit(mailbox),
    usedToday,
    createdAt: mailbox.createdAt.toISOString(),
  };
}

export interface Paginated<T> {
  data: T[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
}

export const paginated = <T>(
  data: T[],
  page: number,
  pageSize: number,
  total: number,
): Paginated<T> => ({
  data,
  pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
});
