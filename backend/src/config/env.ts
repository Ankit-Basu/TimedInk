import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

// `quiet` suppresses dotenv v17 promo output — the demo log should be signal only.
loadDotenv({ quiet: true });

/**
 * Every knob the app has lives here. Parsing happens once, at import time, and
 * a bad/missing variable is a hard boot failure with a readable message —
 * rather than an `undefined` that surfaces as a mystery 500 an hour later.
 */
const booleanish = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4000),

  /** Public origin of the API itself. Used to build tracking-pixel URLs. */
  APP_BASE_URL: z.string().url().default('http://localhost:4000'),
  /** Comma-separated list of allowed browser origins. */
  CORS_ORIGIN: z.string().default('http://localhost:5173'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),

  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  BCRYPT_ROUNDS: z.coerce.number().int().min(4).max(15).default(10),

  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  /** Human-readable log output. Nice for the demo, off in production. */
  LOG_PRETTY: booleanish.optional(),

  // ---- SMTP / Ethereal -----------------------------------------------------
  SMTP_HOST: z.string().default('smtp.ethereal.email'),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: booleanish.default(false),
  /**
   * SMTP credentials.
   *
   * Leave ALL of these blank to have the app provision a throwaway Ethereal
   * account on boot (credentials are logged once so you can pin them into
   * .env). That is the default and what the demo uses.
   *
   * ETHEREAL_USER/PASS and SMTP_USER/PASS are the same slot under two names:
   * the Ethereal pair reads naturally for the default path, and the generic
   * pair makes it obvious that pointing SMTP_HOST at a real provider (and
   * supplying its credentials) is all it takes to send real mail. SMTP_* wins
   * if both are set.
   */
  ETHEREAL_USER: z.string().optional(),
  ETHEREAL_PASS: z.string().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),

  // ---- Queue / worker ------------------------------------------------------
  EMAIL_QUEUE_NAME: z.string().default('outbox-emails'),
  /** How many jobs one worker process handles at once. */
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(5),
  /** Simulated provider send-rate cap: RATE_LIMIT_MAX sends per DURATION_MS. */
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  RATE_LIMIT_DURATION_MS: z.coerce.number().int().positive().default(10_000),
  /** BullMQ retry policy for transient send failures. */
  JOB_ATTEMPTS: z.coerce.number().int().positive().default(3),
  JOB_BACKOFF_MS: z.coerce.number().int().positive().default(5_000),

  /**
   * On boot, a PENDING/QUEUED email whose scheduledAt is older than this is NOT
   * auto-sent — it is flagged FAILED for manual review. Prevents a mailstorm
   * after a long outage.
   */
  STALE_CATCHUP_THRESHOLD_MINUTES: z.coerce.number().int().positive().default(1440),

  // ---- Bonus layers --------------------------------------------------------
  WARMUP_ENABLED: booleanish.default(true),
  /** How long a job re-delays itself when its mailbox is at its daily cap. */
  WARMUP_RETRY_DELAY_MS: z.coerce.number().int().positive().default(60_000),
  MAILBOX_ROTATION_ENABLED: booleanish.default(true),
  /** How often the follow-up sweeper looks for unopened emails past their window. */
  FOLLOWUP_CHECK_INTERVAL_MS: z.coerce.number().int().positive().default(60_000),

  BULL_BOARD_ENABLED: booleanish.default(true),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const detail = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
  // Deliberately console.error: the logger itself depends on this module.
  console.error(`Invalid environment configuration:\n${detail}\n\nSee .env.example for the full list.`);
  process.exit(1);
}

export const env = parsed.data;

export const isProduction = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';

/** Origins allowed to call the API from a browser. */
export const corsOrigins: string[] = env.CORS_ORIGIN.split(',')
  .map((o) => o.trim())
  .filter(Boolean);

/**
 * The effective SMTP credentials, or null when none are configured — in which
 * case the mailer provisions a throwaway Ethereal account instead.
 */
export const smtpCredentials: { user: string; pass: string } | null =
  env.SMTP_USER && env.SMTP_PASS
    ? { user: env.SMTP_USER, pass: env.SMTP_PASS }
    : env.ETHEREAL_USER && env.ETHEREAL_PASS
      ? { user: env.ETHEREAL_USER, pass: env.ETHEREAL_PASS }
      : null;

export type Env = z.infer<typeof envSchema>;
