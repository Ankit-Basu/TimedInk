import nodemailer, { type Transporter } from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport/index.js';
import type SMTPPool from 'nodemailer/lib/smtp-pool/index.js';
import { env, smtpCredentials } from '../config/env.js';
import { childLogger } from '../lib/logger.js';

const log = childLogger('mailer');

/**
 * The transport is pooled, so its result carries the pool's shape. Aliased once
 * here rather than repeated at five call sites.
 */
type PooledTransporter = Transporter<SMTPPool.SentMessageInfo>;

export interface SendMailInput {
  from: string;
  to: string;
  cc?: string | null;
  subject: string;
  html: string;
  text: string;
}

export interface SendMailResult {
  messageId: string;
  /** Ethereal's web view of the message. Null for any non-Ethereal transport. */
  previewUrl: string | null;
  accepted: string[];
  rejected: string[];
}

let transporterPromise: Promise<PooledTransporter> | null = null;

/**
 * Shared transport tuning.
 *
 * `pool: true` is the single biggest latency win in the whole app. Without it
 * Nodemailer opens a fresh connection per message, and every message pays a
 * full TCP + STARTTLS + AUTH handshake — measured at ~4.4s each against
 * Ethereal. Pooled, that cost is paid once per connection and then amortised
 * across every message that connection carries.
 *
 * `maxConnections` tracks WORKER_CONCURRENCY so there is exactly one socket per
 * concurrently-processing job: fewer would make jobs queue behind each other
 * inside Nodemailer, defeating the worker's own concurrency.
 *
 * The explicit timeouts matter because the defaults are generous: a wedged
 * network should surface as a failed attempt that BullMQ retries with backoff,
 * not as a job that sits in `SENDING` indefinitely holding a worker slot.
 */
const TRANSPORT_TUNING = {
  pool: true,
  maxConnections: env.WORKER_CONCURRENCY,
  /** Rotate a connection after this many messages; long-lived sockets drift. */
  maxMessages: 100,
  connectionTimeout: 20_000,
  greetingTimeout: 15_000,
  socketTimeout: 30_000,
} as const;

/**
 * Lazily build (and memoise) the SMTP transport.
 *
 * If ETHEREAL_USER/ETHEREAL_PASS are set we use them. If not, we provision a
 * throwaway Ethereal account via `nodemailer.createTestAccount()` and log the
 * credentials **once** so they can be pinned into .env — otherwise every restart
 * creates a new inbox and previously-sent preview links become orphaned.
 */
async function buildTransporter(): Promise<PooledTransporter> {
  if (smtpCredentials) {
    const isEthereal = env.SMTP_HOST.endsWith('ethereal.email');
    log.info(
      {
        host: env.SMTP_HOST,
        port: env.SMTP_PORT,
        user: smtpCredentials.user,
        pool: true,
        maxConnections: env.WORKER_CONCURRENCY,
        // Worth stating plainly at boot: Ethereal accepts mail and discards it.
        delivery: isEthereal ? 'capture-only (Ethereal never delivers to real inboxes)' : 'real',
      },
      'using SMTP credentials from env',
    );
    return nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: smtpCredentials,
      ...TRANSPORT_TUNING,
    });
  }

  const account = await nodemailer.createTestAccount();

  // Credentials deliberately are NOT structured fields here — the redactor
  // would censor them, and for a throwaway Ethereal inbox showing them is the
  // entire point. They go out in the message below instead.
  log.info(
    { user: account.user, host: account.smtp.host, port: account.smtp.port },
    'provisioned a throwaway Ethereal account',
  );
  log.info(
    `Pin these into backend/.env to keep one inbox across restarts:\n` +
      `  ETHEREAL_USER=${account.user}\n` +
      `  ETHEREAL_PASS=${account.pass}\n` +
      `  Inbox: https://ethereal.email/login (sign in with the pair above)`,
  );

  return nodemailer.createTransport({
    host: account.smtp.host,
    port: account.smtp.port,
    secure: account.smtp.secure,
    auth: { user: account.user, pass: account.pass },
    ...TRANSPORT_TUNING,
  });
}

/**
 * Tear the pool down on shutdown. Without this the worker keeps open sockets
 * and the process lingers instead of exiting cleanly.
 */
export async function closeMailer(): Promise<void> {
  if (!transporterPromise) return;
  try {
    const transporter = await transporterPromise;
    transporter.close();
    log.debug('SMTP pool closed');
  } catch {
    // Nothing to close if the transport never came up.
  } finally {
    transporterPromise = null;
  }
}

export function getTransporter(): Promise<PooledTransporter> {
  transporterPromise ??= buildTransporter().catch((err: unknown) => {
    // Don't cache a failed provisioning attempt — the next send should retry.
    transporterPromise = null;
    throw err;
  });
  return transporterPromise;
}

/** Verify SMTP connectivity at boot so a bad config fails loudly and early. */
export async function verifyMailer(): Promise<void> {
  const transporter = await getTransporter();
  await transporter.verify();
  log.info('SMTP transport verified');
}

export async function sendMail(input: SendMailInput): Promise<SendMailResult> {
  const transporter = await getTransporter();

  const info = await transporter.sendMail({
    from: input.from,
    to: input.to,
    ...(input.cc ? { cc: input.cc } : {}),
    subject: input.subject,
    html: input.html,
    text: input.text,
  });

  // @types/nodemailer models the pooled result without `pending`, while
  // getTestMessageUrl is typed against the non-pooled shape. The two are
  // identical at runtime for the fields it reads, so the mismatch is adapted
  // once, here, instead of loosening the transport type everywhere.
  const previewUrl = nodemailer.getTestMessageUrl(
    info as unknown as SMTPTransport.SentMessageInfo,
  );

  return {
    messageId: info.messageId,
    previewUrl: typeof previewUrl === 'string' ? previewUrl : null,
    accepted: (info.accepted ?? []).map(String),
    rejected: (info.rejected ?? []).map(String),
  };
}

/** Test seam: lets unit tests drop a stub transport in. */
export function __setTransporterForTests(t: PooledTransporter | null): void {
  transporterPromise = t ? Promise.resolve(t) : null;
}
