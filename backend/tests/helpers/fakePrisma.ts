import { randomUUID } from 'node:crypto';
import type { EmailEvent, Mailbox, ScheduledEmail, User } from '@prisma/client';

/**
 * An in-memory stand-in for the slice of PrismaClient the HTTP create path
 * touches. Small on purpose: it exists so the integration test can assert on
 * queue behaviour without a MySQL container, not to reimplement Prisma.
 */

/** Real UUIDs, because the routes validate ids as UUIDs — exactly as in production. */
const nextId = (): string => randomUUID();

export interface FakePrismaSeed {
  users?: User[];
  mailboxes?: Mailbox[];
}

export class FakePrisma {
  users: User[] = [];
  mailboxes: Mailbox[] = [];
  scheduledEmails: ScheduledEmail[] = [];
  events: EmailEvent[] = [];

  constructor(seed: FakePrismaSeed = {}) {
    this.users = seed.users ?? [];
    this.mailboxes = seed.mailboxes ?? [];
  }

  readonly user = {
    findUnique: async ({ where }: { where: { email?: string; id?: string } }) =>
      this.users.find((u) => (where.email ? u.email === where.email : u.id === where.id)) ?? null,
  };

  readonly mailbox = {
    findMany: async ({ where }: { where?: { userId?: string } } = {}) =>
      this.mailboxes.filter((m) => !where?.userId || m.userId === where.userId),

    findFirst: async ({ where }: { where: { id?: string; userId?: string } }) =>
      this.mailboxes.find(
        (m) => (!where.id || m.id === where.id) && (!where.userId || m.userId === where.userId),
      ) ?? null,
  };

  readonly scheduledEmail = {
    create: async ({ data }: { data: Record<string, unknown> }): Promise<ScheduledEmail> => {
      const now = new Date();
      const row = {
        id: nextId(),
        mailboxId: null,
        cc: null,
        status: 'PENDING',
        attempts: 0,
        lastError: null,
        bullJobId: null,
        previewUrl: null,
        deliverabilityScore: null,
        deliverabilityFlags: null,
        followUpOfId: null,
        followUpAfterHours: null,
        followUpQueuedAt: null,
        openedAt: null,
        sentAt: null,
        timezone: 'UTC',
        createdAt: now,
        updatedAt: now,
        ...data,
      } as unknown as ScheduledEmail;

      this.scheduledEmails.push(row);
      return row;
    },

    update: async ({
      where,
      data,
    }: {
      where: { id: string };
      data: Record<string, unknown>;
    }): Promise<ScheduledEmail> => {
      const row = this.scheduledEmails.find((e) => e.id === where.id);
      if (!row) throw new Error(`FakePrisma: no scheduled email ${where.id}`);
      Object.assign(row, data, { updatedAt: new Date() });
      return row;
    },

    findUnique: async ({ where }: { where: { id: string } }) =>
      this.scheduledEmails.find((e) => e.id === where.id) ?? null,

    findUniqueOrThrow: async ({ where }: { where: { id: string } }) => {
      const row = this.scheduledEmails.find((e) => e.id === where.id);
      if (!row) throw new Error(`FakePrisma: no scheduled email ${where.id}`);
      return { ...row, mailbox: this.mailboxes.find((m) => m.id === row.mailboxId) ?? null };
    },

    findFirst: async ({ where }: { where: { id?: string; userId?: string } }) =>
      this.scheduledEmails.find(
        (e) => (!where.id || e.id === where.id) && (!where.userId || e.userId === where.userId),
      ) ?? null,

    findMany: async () => this.scheduledEmails,
    count: async () => this.scheduledEmails.length,
  };

  readonly emailEvent = {
    create: async ({ data }: { data: Record<string, unknown> }): Promise<EmailEvent> => {
      const row = { id: nextId(), meta: null, createdAt: new Date(), ...data } as unknown as EmailEvent;
      this.events.push(row);
      return row;
    },
  };

  /** Event types recorded for one email, in order — handy for assertions. */
  eventTypesFor(scheduledEmailId: string): string[] {
    return this.events.filter((e) => e.scheduledEmailId === scheduledEmailId).map((e) => e.type);
  }
}

export function makeMailbox(overrides: Partial<Mailbox> = {}): Mailbox {
  return {
    id: nextId(),
    userId: 'user-1',
    fromName: 'Ava from Outbox',
    fromEmail: 'ava@outboxpilot.dev',
    dailyLimit: 100,
    warmupDay: 3,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}
