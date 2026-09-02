/**
 * Demo helper — `npm run burst -- --count=40`
 *
 * Logs in as the seeded demo user and schedules N emails for "now", so the
 * rate limiter is visible on screen: with the defaults (concurrency 5,
 * 10 sends per 10s) 40 emails drain in ~40 seconds in clear batches of 10,
 * rather than all at once.
 *
 * Talks to the real HTTP API on purpose — it exercises the same path a user
 * does, so what you see in the demo is not a special code path.
 */
import { setTimeout as sleep } from 'node:timers/promises';

interface Args {
  count: number;
  baseUrl: string;
  email: string;
  password: string;
  spreadSeconds: number;
}

function parseArgs(argv: string[]): Args {
  const get = (name: string, fallback: string): string => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : fallback;
  };

  return {
    count: Number.parseInt(get('count', '40'), 10),
    baseUrl: get('url', process.env.API_BASE_URL ?? 'http://localhost:4000').replace(/\/$/, ''),
    email: get('email', process.env.SEED_USER_EMAIL ?? 'demo@timedink.dev'),
    password: get('password', process.env.SEED_USER_PASSWORD ?? 'demo1234'),
    // 0 = everything at the same instant (the sharpest rate-limit demo).
    spreadSeconds: Number.parseInt(get('spread', '0'), 10),
  };
}

async function postJson<T>(
  url: string,
  body: unknown,
  token?: string,
): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`POST ${url} -> ${response.status} ${response.statusText}: ${text}`);
  }
  return JSON.parse(text) as T;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  if (!Number.isFinite(args.count) || args.count < 1) {
    throw new Error('--count must be a positive integer');
  }

  console.log(`\nBursting ${args.count} emails at ${args.baseUrl} as ${args.email}\n`);

  const login = await postJson<{ data: { token: string } }>(`${args.baseUrl}/api/auth/login`, {
    email: args.email,
    password: args.password,
  });
  const token = login.data.token;

  const startedAt = Date.now();
  let ok = 0;
  let failed = 0;

  for (let i = 1; i <= args.count; i += 1) {
    const offsetMs =
      args.spreadSeconds > 0 ? Math.round((i / args.count) * args.spreadSeconds * 1000) : 0;

    try {
      await postJson(
        `${args.baseUrl}/api/emails`,
        {
          to: `burst-recipient-${i}@example.com`,
          subject: `Burst test ${i} of ${args.count}`,
          body:
            `Hi there,\n\nThis is burst message ${i} of ${args.count}, scheduled to go out ` +
            `immediately so the queue rate limiter is visible in the worker logs.\n\n` +
            `— TimedInk`,
          scheduledAt: new Date(Date.now() + offsetMs).toISOString(),
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
        token,
      );
      ok += 1;
      process.stdout.write('.');
    } catch (err) {
      failed += 1;
      process.stdout.write('x');
      if (failed <= 3) console.error(`\n  ${(err as Error).message}`);
    }

    // Tiny gap so we do not saturate the API's own event loop while measuring
    // the *queue's* limiter.
    await sleep(10);
  }

  console.log(
    `\n\nQueued ${ok} email(s) (${failed} failed) in ${Date.now() - startedAt}ms.\n` +
      `Watch the worker log — sends should come out in batches, not all at once.\n` +
      `Bull Board: ${args.baseUrl}/admin/queues\n`,
  );
}

main().catch((err: unknown) => {
  console.error('\nBurst failed:', err instanceof Error ? err.message : err);
  process.exit(1);
});
