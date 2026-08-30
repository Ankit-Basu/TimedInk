# Outbox Pilot

A scheduled email sender: compose an email, pick a send time in your own timezone, and have it
go out reliably — surviving process restarts, a wiped Redis, and a provider that will throttle
you if you send too fast.

Built as a 48-hour take-home. Node + TypeScript + Express + Prisma/MySQL + BullMQ/Redis on the
back, React + Vite + TanStack Query on the front, Nodemailer against [Ethereal
Email](https://ethereal.email) so every "sent" message has a real, viewable preview.

---

## Table of contents

- [Prerequisites](#prerequisites)
- [Quick start](#quick-start)
- [Running the app](#running-the-app)
- [Ethereal Email setup](#ethereal-email-setup)
- [Architecture](#architecture)
  - [Scheduling](#scheduling)
  - [Restart persistence](#restart-persistence)
  - [Rate limiting and concurrency](#rate-limiting-and-concurrency)
- [Feature-to-code map](#feature-to-code-map)
- [Bonus layers](#bonus-layers)
- [API reference](#api-reference)
- [Tests](#tests)
- [Demo script](#demo-script)
- [Troubleshooting](#troubleshooting)

---

## Prerequisites

| Tool | Version used | Notes |
| --- | --- | --- |
| Node.js | 22.x | 20+ should be fine; `tsx` and native `fetch` are both assumed |
| npm | 11.x | ships with Node 22 |
| Docker Desktop | 28.x | only used for MySQL + Redis |

Nothing else needs installing. You do **not** need a local MySQL or Redis — compose provides
both — and you do not need any email credentials, because the app provisions its own Ethereal
test inbox on first boot.

---

## Quick start

From a clean clone this is about four minutes, most of it waiting on `npm install` and the MySQL
image pull.

```bash
docker compose up -d
```

```bash
cd backend && npm install && cp .env.example .env
```

```bash
npx prisma migrate deploy && npm run seed
```

Then start the API and the worker in **two separate terminals**:

```bash
npm run dev
```

```bash
npm run worker
```

And the frontend in a third:

```bash
cd frontend && npm install && npm run dev
```

Open <http://localhost:5173> and sign in with the seeded account (the login form is
pre-filled with it):

```
email:    demo@outboxpilot.dev
password: demo1234
```

| Surface | URL |
| --- | --- |
| Dashboard | <http://localhost:5173> |
| API health | <http://localhost:4000/health> |
| Bull Board (queue inspector) | <http://localhost:4000/admin/queues> |

> `JWT_SECRET` in `.env.example` is a placeholder. It works locally, but change it before this
> runs anywhere real — the app refuses to boot if it is shorter than 16 characters.

---

## Running the app

### Infrastructure

```bash
docker compose up -d
```

Starts two containers and nothing else:

- **MySQL 8** on host port **3307** (mapped to 3306 inside). Deliberately not 3306, so it cannot
  collide with a MySQL already installed on the reviewer's machine.
- **Redis 7** on **6379**, started with `--appendonly yes`. AOF persistence means delayed jobs
  survive `docker compose restart redis`. That is one half of the restart story; the other half
  is the boot reconciler, which does not trust Redis at all.

Both have healthchecks, so `docker compose ps` tells you when they are actually ready rather
than merely started.

### Backend

```bash
cd backend
npm install
cp .env.example .env          # every value has a working local default
npx prisma migrate deploy     # or `npx prisma migrate dev` while iterating on the schema
npm run seed                  # demo user + two mailboxes
```

The API and the worker are **two separate processes**:

```bash
npm run dev        # API on :4000  — HTTP, validation, boot reconciliation
npm run worker     # worker        — drains the queue, talks to SMTP
```

They are split for the usual reason: a wedged SMTP connection must not be able to make the HTTP
tier unresponsive, and the two scale on completely different axes. They share only MySQL and
Redis, so you can run several of either.

Other scripts:

| Command | What it does |
| --- | --- |
| `npm test` | full Vitest suite (no containers needed) |
| `npm run typecheck` | `tsc --noEmit` under `strict` |
| `npm run build` / `npm start` | compile to `dist/` and run the compiled API |
| `npm run seed` | idempotent demo user + mailboxes |
| `npm run burst -- --count=40` | schedule 40 emails at once to demo the rate limiter |
| `npx prisma studio` | browse the database |

### Frontend

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173
```

The Vite dev server proxies `/api` to `http://localhost:4000`, so the browser stays on a single
origin and there is no CORS preflight on every dashboard poll. Set `VITE_API_BASE_URL` if you
would rather the browser hit the API directly. See `frontend/.env.example`.

---

## Ethereal Email setup

Ethereal is a fake SMTP service: it accepts mail, delivers nothing, and gives you a web page per
message. Perfect for a demo, since you get real SMTP behaviour and a link you can open on
camera.

**You do not need to create an account.** On first boot the worker calls
`nodemailer.createTestAccount()`, provisions a throwaway inbox, and logs the credentials once:

```
INFO: provisioned a throwaway Ethereal account
    user: "igc3jypu3xblsw3o@ethereal.email"
    pass: "…"
INFO: Pin these into backend/.env to keep one inbox across restarts:
  ETHEREAL_USER=igc3jypu3xblsw3o@ethereal.email
  ETHEREAL_PASS=…
  Inbox: https://ethereal.email/login
```

Paste those two lines into `backend/.env` and restart the worker. Without pinning, every restart
creates a *new* inbox, and preview links from earlier runs point at an account you can no longer
sign into. The links themselves keep working — but you cannot browse the old inbox.

**Where to find a sent email's preview:** the dashboard's **Sent** tab has a `View email ↗` link
on every row. It is `nodemailer.getTestMessageUrl()`, captured at send time and stored on
`ScheduledEmail.previewUrl`, so it is also in the API response and in the worker log line for
that send.

---

## Architecture

Three processes, two datastores:

```
   browser                    API process                    worker process
  ┌────────┐   HTTP    ┌──────────────────────┐        ┌──────────────────────┐
  │ React  │ ────────▶ │ express + zod        │        │ BullMQ Worker        │
  │ + Query│           │ auth, validation     │        │ concurrency + limiter│
  └────────┘           │ boot reconciliation  │        │ Nodemailer → Ethereal│
       ▲               └───────┬──────────────┘        └────────┬─────────────┘
       │  poll 4s              │                                │
       └───────────────────────┼────────────────────────────────┘
                               ▼                                ▼
                        ┌─────────────┐                  ┌─────────────┐
                        │   MySQL     │ ◀─── truth ───▶  │    Redis    │
                        │  (Prisma)   │                  │  (BullMQ)   │
                        └─────────────┘                  └─────────────┘
```

The single most important design decision: **MySQL is the source of truth, Redis is a derived
index of outstanding work.** Every scheduled email exists as a row before any job exists, and
the queue can be rebuilt from the database at any moment. Nothing that matters lives only in
Redis.

### Scheduling

`POST /api/emails` does four things, in this order, and the order is the design:

1. **Write the row to MySQL with status `PENDING`.** Nothing has touched Redis yet. At this
   point the user's intent is durable.
2. **Compute `delay = scheduledAt - now`**, clamped at zero. `scheduledAt` is always an absolute
   UTC instant; the browser converts the local wall-clock time from the date picker before it
   sends. `timezone` is stored alongside purely so the UI can show what the user originally
   picked.
3. **Add a delayed BullMQ job** with `queue.add(name, payload, { delay, jobId: 'email-<row.id>' })`.
   The job id is *derived from the primary key* — this matters enormously, see below.
4. **Flip the row to `QUEUED`** and store `bullJobId`.

Each transition also appends an `EmailEvent`, so every email carries an immutable timeline
(`CREATED → QUEUED → SENDING → SENT`) — the trail you would want when someone asks why a message
went out at 3am.

If the process dies between (1) and (3), the row is stranded at `PENDING` and the reconciler
picks it up on the next boot. Doing it the other way round — Redis first — could produce a job
referencing a row that was never committed, which is unrecoverable.

The job payload deliberately carries **only an id**, not the email body. The worker re-reads the
row from MySQL on every attempt, so an email cancelled or edited while its job sat in the
delayed set is always handled correctly. A payload snapshot would go stale.

**Code:** [`backend/src/services/scheduling.ts`](backend/src/services/scheduling.ts),
[`backend/src/routes/emails.ts`](backend/src/routes/emails.ts)

### Restart persistence

There are two independent mechanisms, and the system needs both.

**1. Redis AOF.** Compose runs Redis with `--appendonly yes`, so the delayed job set survives a
container restart on its own.

**2. Boot reconciliation** — the mechanism that actually matters, because AOF does not protect
you against an evicted key, a wiped volume, a `FLUSHALL`, or a Redis that was never running when
the email was created.

On every API boot, **before `app.listen()`**, the reconciler:

- queries MySQL for every `ScheduledEmail` with status `PENDING` or `QUEUED`;
- for each one calls `queue.add` with **the same deterministic `jobId`** (`email-<uuid>`) and
  `delay = max(0, scheduledAt - now)`;
- logs a one-line summary.

The deterministic job id is what makes this safe to run unconditionally on every single start.
BullMQ treats `add` with an existing job id as a no-op, so if Redis still holds the job, nothing
happens — no duplicate sends. If Redis lost it, it comes back. The same function
(`enqueueScheduledEmail`) serves both the create path and the reconciler, so the two can never
drift apart in their delay maths.

Reconciliation runs *before* the server starts accepting traffic so no inbound request can
create a row mid-sweep and race it.

**The stale-catch-up rule.** Blindly re-queueing everything after a long outage would dump
thousands of cold emails onto real prospects at once — a genuinely destructive default. So any
email past due by more than `STALE_CATCHUP_THRESHOLD_MINUTES` (default `1440`, i.e. 24h) is
**not** sent. It is set to `FAILED` with
`lastError = "missed window, flagged for manual review"`, plus a `FAILED` event, and a human
decides. Anything past due by *less* than the threshold is re-queued with delay 0 and goes out
immediately — which is the desired "catch up on the last few minutes" behaviour after a normal
restart.

Verified end to end, all three paths:

```
# restart with Redis intact — deterministic ids make it a no-op
reconciliation complete: 3 job(s) re-queued, 0 flagged stale, 0 error(s) from 3 candidate(s) in 66ms
delayed jobs in Redis: 3          ← still 3, not 6. No duplicates.

# after `redis-cli FLUSHALL` — rebuilt entirely from MySQL
reconciliation complete: 3 job(s) re-queued, 0 flagged stale, 0 error(s) from 3 candidate(s) in 96ms
delayed jobs in Redis: 3          ← was 0 a second earlier

# with one row backdated 3 days
reconciliation complete: 2 job(s) re-queued, 1 flagged stale, 0 error(s) from 3 candidate(s) in 75ms
  → restart-test-3@example.com  FAILED  "missed window, flagged for manual review"
```

**Code:** [`backend/src/services/reconciliation.ts`](backend/src/services/reconciliation.ts),
called from [`backend/src/server.ts`](backend/src/server.ts)

### Rate limiting and concurrency

These are two different bounds that are easy to conflate, and the app uses both:

**Concurrency** (`WORKER_CONCURRENCY`, default `5`) is how many jobs a *single worker process*
runs simultaneously. It is a **local resource** bound — sockets, memory, event-loop headroom. If
you run three worker processes at concurrency 5, fifteen jobs can be in flight.

**The rate limiter** (`RATE_LIMIT_MAX` / `RATE_LIMIT_DURATION_MS`, default `10` per `10s`) is how
many jobs may *start* per window across **every** worker, coordinated through Redis. This is the
one that models the real-world constraint: a provider that starts returning `421 4.7.0 Too many
messages` above some rate. Adding worker processes does not raise it — that is the point.

> **Deviation from the brief, deliberately.** The brief describes `limiter: { max, duration }` as
> a Queue option. In BullMQ that option lives on the **Worker** (`WorkerOptions.limiter`). It is
> still a queue-wide limit enforced in Redis across all workers, which is the behaviour asked
> for; only the mounting point differs. Configured in
> [`backend/src/worker.ts`](backend/src/worker.ts), with the shared config exported from
> [`emailQueue.ts`](backend/src/queue/emailQueue.ts). Also noted in `ASSUMPTIONS.md`.

**Retries.** Transient failures rely on BullMQ's built-in `attempts` + exponential backoff
(`JOB_ATTEMPTS=3`, `JOB_BACKOFF_MS=5000`). Between attempts the row sits at `QUEUED` with
`lastError` populated, so the dashboard shows it as still in flight; it only lands in `FAILED`
once BullMQ has exhausted its attempts. Reporting `FAILED` on attempt 1 of 3 would be a lie the
UI then has to walk back.

Measured effect of a real 40-email burst (`npm run burst -- --count=40`), grouped from the
worker log:

```
  t+ 0s.. 9s : 14 sends  ##############     ← initial admission, then the limiter engages
  t+10s..19s :  6 sends  ######
  t+20s..29s : 10 sends  ##########
  t+30s..39s : 10 sends  ##########
  total 40 sends over 35 seconds
```

Without the limiter these 40 would have gone out in roughly two seconds.

**Code:** [`backend/src/worker.ts`](backend/src/worker.ts),
[`backend/src/queue/processor.ts`](backend/src/queue/processor.ts)

---

## Feature-to-code map

| Feature | Implemented in |
| --- | --- |
| **Scheduler** (create → delayed job) | [`src/services/scheduling.ts`](backend/src/services/scheduling.ts) · [`src/queue/emailQueue.ts`](backend/src/queue/emailQueue.ts) · [`src/routes/emails.ts`](backend/src/routes/emails.ts) |
| **Restart persistence / reconciliation** | [`src/services/reconciliation.ts`](backend/src/services/reconciliation.ts) · [`src/server.ts`](backend/src/server.ts) · [`docker-compose.yml`](docker-compose.yml) (`--appendonly yes`) |
| **Rate limiting** (queue-wide send cap) | [`src/worker.ts`](backend/src/worker.ts) (`limiter`) · [`src/queue/emailQueue.ts`](backend/src/queue/emailQueue.ts) (`rateLimitConfig`) |
| **Concurrency** (per-process bound) | [`src/worker.ts`](backend/src/worker.ts) (`concurrency`) |
| **Send pipeline / retries** | [`src/queue/processor.ts`](backend/src/queue/processor.ts) · [`src/services/mailer.ts`](backend/src/services/mailer.ts) |
| **Login / register / JWT** | [`src/services/auth.ts`](backend/src/services/auth.ts) · [`src/middleware/auth.ts`](backend/src/middleware/auth.ts) · [`src/routes/auth.ts`](backend/src/routes/auth.ts) · [`frontend/src/lib/auth.tsx`](frontend/src/lib/auth.tsx) · [`frontend/src/pages/LoginPage.tsx`](frontend/src/pages/LoginPage.tsx) |
| **Dashboard** (tabs, polling) | [`frontend/src/pages/DashboardPage.tsx`](frontend/src/pages/DashboardPage.tsx) |
| **Tables** (per-status, preview links) | [`frontend/src/features/emails/EmailTable.tsx`](frontend/src/features/emails/EmailTable.tsx) |
| **Compose** (tz-aware picker) | [`frontend/src/features/emails/ComposeModal.tsx`](frontend/src/features/emails/ComposeModal.tsx) · [`frontend/src/lib/format.ts`](frontend/src/lib/format.ts) |
| **Cancellation** | [`src/services/scheduling.ts`](backend/src/services/scheduling.ts) (`cancelScheduledEmail`) |
| **Audit trail** (`EmailEvent`) | [`src/services/events.ts`](backend/src/services/events.ts) |
| **Validation / error handling / logging** | [`src/middleware/validate.ts`](backend/src/middleware/validate.ts) · [`src/middleware/error.ts`](backend/src/middleware/error.ts) · [`src/lib/logger.ts`](backend/src/lib/logger.ts) · [`src/config/env.ts`](backend/src/config/env.ts) |
| **Bonus A — Deliverability Guard** | [`src/services/deliverability.ts`](backend/src/services/deliverability.ts) · badge in [`frontend/src/components/ui.tsx`](frontend/src/components/ui.tsx) |
| **Bonus B — Warmup throttling** | [`src/services/warmup.ts`](backend/src/services/warmup.ts) · enforced in [`src/queue/processor.ts`](backend/src/queue/processor.ts) · [`frontend/src/features/mailboxes/MailboxPanel.tsx`](frontend/src/features/mailboxes/MailboxPanel.tsx) |
| **Bonus C — Rotation, tracking, follow-ups** | [`src/services/scheduling.ts`](backend/src/services/scheduling.ts) (`pickMailboxId`) · [`src/services/tracking.ts`](backend/src/services/tracking.ts) · [`src/routes/track.ts`](backend/src/routes/track.ts) · [`src/services/followUp.ts`](backend/src/services/followUp.ts) |
| **Seed / demo tooling** | [`prisma/seed.ts`](backend/prisma/seed.ts) · [`scripts/burst.ts`](backend/scripts/burst.ts) |
| **Tests** | [`backend/tests/`](backend/tests) |

---

## Bonus layers

All three are implemented and wired end to end.

### A — Deliverability Guard

`scoreDeliverability(subject, bodyText) -> { score, flags, details }` is a pure function: no I/O,
no clock, no randomness. It penalises spam-trigger vocabulary (weighted more heavily in the
subject), ALL-CAPS ratio, a missing or thin plain-text body, exclamation-mark abuse, link density
and over-long subjects.

It runs at creation time and the score is stored on the row. It is **informational** — a score of
3 still gets scheduled, it just wears a red badge. Blocking sends on a heuristic would be the
wrong call. The compose form also scores live as you type (debounced, against
`POST /api/emails/preview-score`) so you see the flags before committing.

### B — Warmup throttling

`Mailbox.warmupDay` drives a daily ceiling: `day N -> min(10 × N, 100)`, further capped by an
explicit per-mailbox `dailyLimit` override. Enforcement is a Redis counter keyed by mailbox and
**UTC day**, consumed at the very top of the worker processor before any SMTP work happens.

Check-and-consume runs as a single Lua script — `INCR`, set the TTL on first write, and `DECR`
back if it went over. Doing that as separate round trips would race between worker processes.
A failed send refunds its unit so a flaky SMTP hop does not eat the day's allowance.

A job over its cap **re-delays itself** (`moveToDelayed` + `DelayedError`) rather than failing:
being over quota is a scheduling condition, not an error.

`POST /api/mailboxes/:id/advance-warmup` (the "Advance day" button in the sidebar) bumps the
warmup day so the ramp is demonstrable without waiting real days.

### C — Rotation, open tracking, follow-ups

- **Rotation:** new emails round-robin across a user's mailboxes via a Redis counter, assigned at
  creation time. Visible in the dashboard's *From* column, alternating cleanly.
- **Open tracking:** when an email sets a follow-up window, a 1×1 transparent PNG is injected
  into its HTML at send time. `GET /api/track/:id.png` records an `OPENED` event and stamps
  `openedAt`. The route is unauthenticated by necessity (a mail client has no token); the id is a
  v4 UUID, so it is unguessable, and it always returns the pixel — even for an unknown id — so it
  cannot be used to probe which ids exist.
- **Follow-ups:** a sweeper in the worker process looks for emails that were `SENT` with tracking
  on, whose window has elapsed, with no `OPENED` event. It claims the row with a conditional
  update (so two sweepers cannot both fire) and creates a **new** `ScheduledEmail` with
  `followUpOfId` set, which then flows through the identical queue path. It reuses the original
  mailbox on purpose — a follow-up from a different sender address breaks the thread.

> Pixel tracking is a lower bound on opens, not a measurement. Gmail proxies images, Apple Mail
> Privacy Protection fires them unconditionally, and text-only clients never fire them at all.
> "No `OPENED` event" means "no evidence of an open".

---

## API reference

All `/api/emails` and `/api/mailboxes` routes require `Authorization: Bearer <token>`.
Responses are `{ "data": … }`; list responses add `{ "pagination": … }`. Errors are
`{ "error": { "code", "message", "details? } }`.

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/api/auth/register` | create an account → `{ token, user }` |
| `POST` | `/api/auth/login` | sign in → `{ token, user }` |
| `GET` | `/api/auth/me` | validate a stored token |
| `POST` | `/api/emails` | schedule an email |
| `GET` | `/api/emails?status=&page=&pageSize=&q=` | list (status accepts `SENT,FAILED`) |
| `GET` | `/api/emails/stats` | per-status counts for the tab badges |
| `GET` | `/api/emails/:id` | detail incl. the event timeline |
| `DELETE` | `/api/emails/:id` | cancel a `PENDING`/`QUEUED` email |
| `POST` | `/api/emails/preview-score` | deliverability score without saving |
| `GET` | `/api/mailboxes` | mailboxes + today's warmup usage |
| `POST` | `/api/mailboxes` | add a mailbox |
| `POST` | `/api/mailboxes/:id/advance-warmup` | demo control for the warmup ramp |
| `GET` | `/api/track/:id.png` | open-tracking pixel (**unauthenticated**) |
| `GET` | `/health` | liveness |

**Auth choice:** JWT as a **bearer token**, stored in `localStorage`. Chosen over an httpOnly
cookie because the SPA and the API are on different origins in development, which would mean
`SameSite=None` + credentialed CORS + CSRF handling for no real benefit at this scale. The
trade-off (an XSS becomes a session compromise) is recorded in `ASSUMPTIONS.md`.

Example:

```bash
curl -s -X POST http://localhost:4000/api/auth/login -H 'Content-Type: application/json' -d '{"email":"demo@outboxpilot.dev","password":"demo1234"}'
```

---

## Tests

```bash
cd backend && npm test
```

56 tests, ~1.5s, and — deliberately — **no MySQL, Redis or SMTP required**. Everything at the
process edge is faked, so the suite runs on a clean checkout and in CI without containers.

| File | Covers |
| --- | --- |
| [`tests/unit/warmup.test.ts`](backend/tests/unit/warmup.test.ts) | the rate-limiting logic this app owns: the warmup token bucket (allow/deny at the boundary, roll-back on denial, TTL set exactly once, per-mailbox isolation, UTC-day rollover, refunds that never go negative) and the limit arithmetic |
| [`tests/unit/reconciliation.test.ts`](backend/tests/unit/reconciliation.test.ts) | boot reconciliation: the requeue-vs-stale policy including exact threshold boundaries, `PENDING` rows, a single clock across the sweep, and failure isolation when one row throws |
| [`tests/unit/deliverability.test.ts`](backend/tests/unit/deliverability.test.ts) | the scorer, including purity and score clamping |
| [`tests/integration/createEmail.test.ts`](backend/tests/integration/createEmail.test.ts) | `POST /api/emails` end to end through express → auth → zod → scheduling → `queue.add`, asserting the job is enqueued **with the correct delay** and the deterministic job id; plus write-ordering (row exists before Redis is touched), the event trail, past-time clamping, auth and validation rejection, and the cancel path |

The queue-level limiter itself is BullMQ's, so it is verified by observation (the burst
histogram above) rather than by unit-testing a library.

---

## Demo script

A five-minute path that hits everything worth showing.

**1. Seeded login** (~20s) — open <http://localhost:5173>, the demo credentials are pre-filled,
sign in.

**2. Compose** (~60s) — *New email*. Type a deliberately spammy subject
(`FREE CASH!!! ACT NOW`) and watch the deliverability score drop live with its flags. Pick a send
time a minute out, schedule it. It appears under **Scheduled** as `queued`; when the worker picks
it up the status flips without a refresh (4s polling). Open the `View email ↗` link on the
**Sent** tab for the real Ethereal preview.

**3. Rate limiting** (~90s) — with the worker log on screen:

```bash
cd backend && npm run burst -- --count=40
```

40 emails are accepted in ~3 seconds, then drain over ~35–40 seconds in visible batches.
<http://localhost:4000/admin/queues> shows the delayed/active/completed counts moving.

> If you want a *pure* rate-limit demo, click **Advance day** on both mailboxes first, so the
> warmup cap is not also binding. Leaving it alone demos warmup instead — jobs re-delay when a
> mailbox hits its ceiling.

**4. Restart persistence** (~90s) — schedule two emails ten minutes out, then:

```bash
docker exec outbox-redis redis-cli FLUSHALL
```

Stop the API (`Ctrl-C`) and start it again. The boot log prints one line:

```
reconciliation complete: 2 job(s) re-queued, 0 flagged stale, 0 error(s) from 2 candidate(s) in 96ms
```

Confirm the jobs are genuinely back:

```bash
docker exec outbox-redis redis-cli ZCARD bull:outbox-emails:delayed
```

**5. Stale flagging** (~40s) — set `STALE_CATCHUP_THRESHOLD_MINUTES=1` in `backend/.env`, schedule
something, backdate it, restart, and watch it land in **Failed** with *"missed window, flagged for
manual review"* instead of blasting out.

Logs are pino + pino-pretty (colourised, `pid`/`hostname` stripped, tracking-pixel and health
requests filtered out), so the terminal is readable on camera. Set `LOG_PRETTY=false` for JSON.

---

## Troubleshooting

**`docker compose up` hangs or `docker ps` never returns.** Docker Desktop's engine is not
running. If it crash-loops on Windows, check
`%LOCALAPPDATA%\Docker\log\host\com.docker.backend.exe.log` — a stale socket in
`%LOCALAPPDATA%\Docker\run\` (`dockerInference`) can block startup; rename that `run` folder
while Docker is stopped and relaunch. (This bit me while building it.)

**`Invalid environment configuration` on boot.** The message names the offending variable.
Usually a missing `.env` (`cp .env.example .env`) or a `JWT_SECRET` under 16 characters.

**`P1001: Can't reach database server`.** MySQL is still starting — `docker compose ps` should
show `healthy`. Note the port is **3307**, not 3306.

**Emails stay `QUEUED` forever.** The worker is not running. `npm run worker` is a separate
process from `npm run dev`.

**Emails go to `FAILED` with an SMTP error.** Ethereal needs outbound network access on port 587.
If credentials in `.env` were pinned from an old run and the account has lapsed, blank
`ETHEREAL_USER`/`ETHEREAL_PASS` to have a fresh one provisioned.

**A mailbox stops sending partway through a burst.** It hit its warmup daily cap. The sidebar
shows `n / limit sent today`; click **Advance day**, or set `WARMUP_ENABLED=false`.

**Start over completely:**

```bash
cd backend && npx prisma migrate reset --force && npm run seed
```

---

See [`ASSUMPTIONS.md`](ASSUMPTIONS.md) for every shortcut, trade-off and known limitation.
