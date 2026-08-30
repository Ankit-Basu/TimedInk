import nodemailer, { type Transporter } from 'nodemailer';
import type SMTPTransport from 'nodemailer/lib/smtp-transport/index.js';
import { env } from '../config/env.js';
import { childLogger } from '../lib/logger.js';

const log = childLogger('mailer');

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

let transporterPromise: Promise<Transporter<SMTPTransport.SentMessageInfo>> | null = null;

/**
 * Lazily build (and memoise) the SMTP transport.
 *
 * If ETHEREAL_USER/ETHEREAL_PASS are set we use them. If not, we provision a
 * throwaway Ethereal account via `nodemailer.createTestAccount()` and log the
 * credentials **once** so they can be pinned into .env — otherwise every restart
 * creates a new inbox and previously-sent preview links become orphaned.
 */
async function buildTransporter(): Promise<Transporter<SMTPTransport.SentMessageInfo>> {
  if (env.ETHEREAL_USER && env.ETHEREAL_PASS) {
    log.info({ host: env.SMTP_HOST, user: env.ETHEREAL_USER }, 'using SMTP credentials from env');
    return nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth: { user: env.ETHEREAL_USER, pass: env.ETHEREAL_PASS },
    });
  }

  const account = await nodemailer.createTestAccount();

  log.info(
    { user: account.user, pass: account.pass, host: account.smtp.host, port: account.smtp.port },
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
  });
}

export function getTransporter(): Promise<Transporter<SMTPTransport.SentMessageInfo>> {
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

  const previewUrl = nodemailer.getTestMessageUrl(info);

  return {
    messageId: info.messageId,
    previewUrl: typeof previewUrl === 'string' ? previewUrl : null,
    accepted: (info.accepted ?? []).map(String),
    rejected: (info.rejected ?? []).map(String),
  };
}

/** Test seam: lets unit tests drop a stub transport in. */
export function __setTransporterForTests(
  t: Transporter<SMTPTransport.SentMessageInfo> | null,
): void {
  transporterPromise = t ? Promise.resolve(t) : null;
}
