import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

loadDotenv();

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
   * Leave both blank to have the app provision a throwaway Ethereal account on
   * boot (credentials are logged once so you can pin them into .env).
   */
  ETHEREAL_USER: z.string().optional(),
  ETHEREAL_PASS: z.string().optional(),

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

export type Env = z.infer<typeof envSchema>;
