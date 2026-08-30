import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { FakePrisma, makeMailbox } from '../helpers/fakePrisma.js';

/**
 * Integration test: POST /api/emails must persist a row and enqueue a delayed
 * BullMQ job with the right delay and the deterministic job id.
 *
 * Everything at the process edge (MySQL, Redis, BullMQ) is replaced, so this
 * runs on a clean checkout with no containers. What is genuinely under test is
 * the real chain: express -> auth middleware -> zod validation -> scheduling
 * service -> queue.add, plus the DB writes and event trail along the way.
 */

const FROZEN_NOW = new Date('2026-03-14T12:00:00.000Z');
const USER = { id: 'user-1', email: 'demo@outboxpilot.dev', name: 'Demo Operator' };

const mailbox = makeMailbox({ userId: USER.id });
const fakePrisma = new FakePrisma({ mailboxes: [mailbox] });

/** Spy standing in for BullMQ's Queue#add. */
const queueAdd = vi.fn().mockImplementation(async (_name: string, _data: unknown, opts: { jobId: string }) => ({
  id: opts.jobId,
}));
const queueGetJob = vi.fn().mockResolvedValue(null);

vi.mock('../../src/lib/prisma.js', () => ({
  prisma: fakePrisma,
  disconnectPrisma: async () => undefined,
}));

// The real module opens an ioredis connection at import time.
vi.mock('../../src/lib/redis.js', () => ({
  redis: { incr: vi.fn().mockResolvedValue(1), get: vi.fn(), set: vi.fn(), del: vi.fn() },
  createRedisConnection: () => ({}),
  closeRedisConnections: async () => undefined,
}));

// Keep the real jobId/queue-name helpers; replace only the live Queue.
vi.mock('../../src/queue/emailQueue.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/queue/emailQueue.js')>();
  return {
    ...actual,
    emailQueue: { add: queueAdd, getJob: queueGetJob, close: async () => undefined },
    closeQueue: async () => undefined,
  };
});

// Imported after the mocks are registered.
const { createApp } = await import('../../src/app.js');
const { signToken } = await import('../../src/services/auth.js');
const { jobIdForEmail, SEND_EMAIL_JOB } = await import('../../src/queue/emailQueue.js');

const app = createApp();
const authHeader = (): string => `Bearer ${signToken(USER)}`;

const validPayload = {
  to: 'prospect@example.com',
  subject: 'Quick question about your outbound stack',
  body: 'Hi there,\n\nNoticed you are hiring SDRs. Worth a short chat?\n\nThanks,\nAva',
  scheduledAt: '2026-03-14T12:15:00.000Z', // exactly 15 minutes after FROZEN_NOW
  timezone: 'Asia/Kolkata',
};

beforeAll(() => {
  // Fake only Date: faking every timer would break supertest's sockets.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(FROZEN_NOW);
});

afterAll(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  fakePrisma.scheduledEmails.length = 0;
  fakePrisma.events.length = 0;
  queueAdd.mockClear();
  queueGetJob.mockClear();
});

afterEach(() => {
  vi.setSystemTime(FROZEN_NOW);
});

describe('POST /api/emails', () => {
  it('persists the email and enqueues a delayed job with the correct delay', async () => {
    const response = await request(app)
      .post('/api/emails')
      .set('Authorization', authHeader())
      .send(validPayload)
      .expect(201);

    const created = response.body.data;
    expect(created.status).toBe('QUEUED');
    expect(created.to).toBe(validPayload.to);
    expect(created.timezone).toBe('Asia/Kolkata');

    // --- the assertion the brief asks for --------------------------------
    expect(queueAdd).toHaveBeenCalledTimes(1);
    const [jobName, payload, options] = queueAdd.mock.calls[0]!;

    expect(jobName).toBe(SEND_EMAIL_JOB);
    // 15 minutes, to the millisecond, because the clock is frozen.
    expect(options.delay).toBe(15 * 60 * 1000);
    expect(options.jobId).toBe(jobIdForEmail(created.id));
    expect(payload).toMatchObject({ scheduledEmailId: created.id, userId: USER.id });
  });

  it('stores the row in MySQL before it touches the queue', async () => {
    let rowExistedAtEnqueue = false;
    queueAdd.mockImplementationOnce(async (_n: string, _d: unknown, opts: { jobId: string }) => {
      // MySQL is the source of truth: by the time we reach Redis the row must
      // already be durable, otherwise a crash here would orphan the job.
      rowExistedAtEnqueue = fakePrisma.scheduledEmails.length === 1;
      return { id: opts.jobId };
    });

    await request(app)
      .post('/api/emails')
      .set('Authorization', authHeader())
      .send(validPayload)
      .expect(201);

    expect(rowExistedAtEnqueue).toBe(true);
  });

  it('records a CREATED then QUEUED event trail', async () => {
    const response = await request(app)
      .post('/api/emails')
      .set('Authorization', authHeader())
      .send(validPayload)
      .expect(201);

    expect(fakePrisma.eventTypesFor(response.body.data.id)).toEqual(['CREATED', 'QUEUED']);
  });

  it('clamps a past scheduledAt to an immediate send rather than a negative delay', async () => {
    await request(app)
      .post('/api/emails')
      .set('Authorization', authHeader())
      .send({ ...validPayload, scheduledAt: '2026-03-14T11:00:00.000Z' })
      .expect(201);

    expect(queueAdd.mock.calls[0]![2].delay).toBe(0);
  });

  it('assigns the user mailbox and scores deliverability at creation time', async () => {
    const response = await request(app)
      .post('/api/emails')
      .set('Authorization', authHeader())
      .send(validPayload)
      .expect(201);

    expect(response.body.data.mailbox).toMatchObject({ id: mailbox.id, fromEmail: mailbox.fromEmail });
    expect(response.body.data.deliverabilityScore).toBeGreaterThan(0);
  });

  it('still schedules a spammy email, flagging it rather than blocking it', async () => {
    const response = await request(app)
      .post('/api/emails')
      .set('Authorization', authHeader())
      .send({
        ...validPayload,
        subject: 'FREE CASH!!! ACT NOW',
        body: 'CLICK HERE to claim your 100% guaranteed free money!!!',
      })
      .expect(201);

    expect(response.body.data.status).toBe('QUEUED');
    expect(response.body.data.deliverabilityScore).toBeLessThan(50);
    expect(response.body.data.deliverabilityFlags.length).toBeGreaterThan(0);
    expect(queueAdd).toHaveBeenCalledTimes(1);
  });

  it('rejects an unauthenticated request without touching the queue', async () => {
    await request(app).post('/api/emails').send(validPayload).expect(401);
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it('rejects an invalid payload with a 400 and field-level detail', async () => {
    const response = await request(app)
      .post('/api/emails')
      .set('Authorization', authHeader())
      .send({ ...validPayload, to: 'not-an-email', subject: '' })
      .expect(400);

    expect(response.body.error.code).toBe('BAD_REQUEST');
    expect(response.body.error.details).toEqual(
      expect.arrayContaining([expect.objectContaining({ path: 'to' })]),
    );
    expect(queueAdd).not.toHaveBeenCalled();
  });

  it('rejects a scheduledAt that is not a real datetime', async () => {
    await request(app)
      .post('/api/emails')
      .set('Authorization', authHeader())
      .send({ ...validPayload, scheduledAt: 'next tuesday' })
      .expect(400);

    expect(queueAdd).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/emails/:id', () => {
  it('cancels a queued email and removes its job', async () => {
    const created = await request(app)
      .post('/api/emails')
      .set('Authorization', authHeader())
      .send(validPayload)
      .expect(201);

    const id = created.body.data.id as string;
    const remove = vi.fn().mockResolvedValue(undefined);
    queueGetJob.mockResolvedValueOnce({ id: jobIdForEmail(id), remove });

    const response = await request(app)
      .delete(`/api/emails/${id}`)
      .set('Authorization', authHeader())
      .expect(200);

    expect(response.body.data.status).toBe('CANCELLED');
    expect(queueGetJob).toHaveBeenCalledWith(jobIdForEmail(id));
    expect(remove).toHaveBeenCalledTimes(1);
    expect(fakePrisma.eventTypesFor(id)).toContain('CANCELLED');
  });

  it('refuses to cancel an email that has already been sent', async () => {
    const created = await request(app)
      .post('/api/emails')
      .set('Authorization', authHeader())
      .send(validPayload)
      .expect(201);

    const id = created.body.data.id as string;
    await fakePrisma.scheduledEmail.update({ where: { id }, data: { status: 'SENT' } });

    const response = await request(app)
      .delete(`/api/emails/${id}`)
      .set('Authorization', authHeader())
      .expect(409);

    expect(response.body.error.code).toBe('CONFLICT');
  });
});
