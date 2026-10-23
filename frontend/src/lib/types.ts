/**
 * Wire types, mirroring the DTOs in backend/src/lib/dto.ts.
 *
 * Hand-written rather than generated: with one backend and one client, a
 * codegen step costs more than it saves. If this grew, the honest answer is
 * to publish the types from the API package (or generate from an OpenAPI spec)
 * so they cannot drift.
 */

export type EmailStatus =
  | 'PENDING'
  | 'QUEUED'
  | 'SENDING'
  | 'SENT'
  | 'FAILED'
  | 'CANCELLED';

export type EmailEventType = EmailStatus | 'CREATED' | 'OPENED';

export interface DeliverabilityFlag {
  code: string;
  message: string;
  penalty: number;
}

export interface MailboxSummary {
  id: string;
  fromName: string;
  fromEmail: string;
}

export interface ScheduledEmail {
  id: string;
  to: string;
  cc: string | null;
  subject: string;
  scheduledAt: string;
  timezone: string;
  status: EmailStatus;
  attempts: number;
  lastError: string | null;
  previewUrl: string | null;
  deliverabilityScore: number | null;
  deliverabilityFlags: DeliverabilityFlag[];
  mailbox: MailboxSummary | null;
  followUpOfId: string | null;
  followUpAfterHours: number | null;
  /** Shared by every email created from one CSV upload. */
  batchId: string | null;
  hourlyLimit: number | null;
  openedAt: string | null;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EmailEvent {
  id: string;
  type: EmailEventType;
  meta: unknown;
  createdAt: string;
}

export interface ScheduledEmailDetail extends ScheduledEmail {
  bodyText: string;
  events: EmailEvent[];
}

export interface Mailbox {
  id: string;
  fromName: string;
  fromEmail: string;
  warmupDay: number;
  dailyLimit: number;
  effectiveDailyLimit: number;
  usedToday: number;
  createdAt: string;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  /** Google profile picture; null for email + password accounts. */
  avatarUrl: string | null;
}

export interface AuthConfig {
  /** Null when the server has no Google OAuth client configured. */
  googleClientId: string | null;
}

export interface Pagination {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface Paginated<T> {
  data: T[];
  pagination: Pagination;
}

export interface StatusCounts {
  counts: Record<EmailStatus, number>;
  total: number;
}

export interface DeliverabilityPreview {
  score: number;
  flags: string[];
  details: DeliverabilityFlag[];
}

export interface CreateEmailInput {
  to: string;
  cc?: string;
  subject: string;
  body: string;
  /** ISO-8601 UTC instant. */
  scheduledAt: string;
  timezone: string;
  followUpAfterHours?: number;
}

export interface BulkCreateInput {
  recipients: string[];
  subject: string;
  body: string;
  /** ISO-8601 UTC instant for the first send. */
  startAt: string;
  delayBetweenSeconds: number;
  hourlyLimit?: number;
  timezone: string;
  followUpAfterHours?: number;
}

export interface BulkCreateResult {
  batchId: string;
  count: number;
  firstAt: string | null;
  lastAt: string | null;
}

/** The pacing rules the worker enforces, and this hour's spend against them. */
export interface Throughput {
  minSendDelayMs: number;
  maxPerHour: number;
  maxPerHourPerSender: number;
  usedThisHour: number;
  workerConcurrency: number;
  bulkMaxRecipients: number;
}
