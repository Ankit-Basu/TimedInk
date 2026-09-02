# TimedInk

**A scheduled email sender that keeps its promises.** Write an email, pick a send time in your
own timezone, and it goes out then — surviving process restarts, a wiped Redis, and a provider
that throttles you if you send too fast.

Built as a take-home for [ReachInbox](https://reachinbox.ai/).

| | |
| --- | --- |
| **Backend** | Node 22 · TypeScript (strict) · Express · Prisma / MySQL 8 · BullMQ / Redis 7 |
| **Frontend** | React 19 · Vite · TanStack Query · Tailwind CSS 4 |
| **Email** | Nodemailer → [Ethereal](https://ethereal.email) — every send has a real preview link |
| **Tests** | 56 passing, hermetic — no containers needed |
| **Clone → running** | ~4 minutes, five commands |

---

## Contents

- [The three hard parts](#the-three-hard-parts)
- [Quick start](#quick-start)
- [Running the app](#running-the-app)
- [Ethereal Email](#ethereal-email)
- [Architecture](#architecture)
  - [Scheduling](#scheduling)
  - [Restart persistence](#restart-persistence)
  - [Rate limiting and concurrency](#rate-limiting-and-concurrency)
- [Data model](#data-model)
- [Bonus layers](#bonus-layers)
- [Feature-to-code map](#feature-to-code-map)
- [API reference](#api-reference)
- [Interface](#interface)
- [Tests](#tests)
- [Configuration](#configuration)
- [Demo script](#demo-script)
- [Troubleshooting](#troubleshooting)
- [What I'd build next](#what-id-build-next)

---

## The three hard parts

Everything else in this brief is CRUD. These three are where the design decisions live, so here
they are up front, each with the evidence that it actually works.

### 1. A scheduled email must survive the queue losing its memory

MySQL is the source of truth; Redis is a *derived index* of outstanding work that can be rebuilt
at any moment. Every boot replays the database's intent onto the queue using a job id derived
from the row's primary key, so replaying is a no-op when the job is still there.

```
# Redis wiped completely, then the API restarted:
$ docker exec outbox-redis redis-cli FLUSHALL
$ docker exec outbox-redis redis-cli ZCARD bull:outbox-emails:delayed   → 0

reconciliation complete: 3 job(s) re-queued, 0 flagged stale, 0 error(s) from 3 candidate(s) in 96ms

$ docker exec outbox-redis redis-cli ZCARD bull:outbox-emails:delayed   → 3
```

And with Redis **intact**, the same sweep is a no-op rather than a duplicate — 3 candidates
re-queued, delayed set still 3, not 6.

### 2. A provider will throttle you, so the queue has to pace itself

40 emails submitted at once, drained by a worker capped at 10 sends per 10 seconds:

```
  t+ 0s.. 9s : 14 sends  ##############   ← initial admission, then the limiter engages
  t+10s..19s :  6 sends  ######
  t+20s..29s : 10 sends  ##########
  t+30s..39s : 10 sends  ##########
  total 40 sends over 35 seconds
```

Without the limiter these would have gone out in about two seconds.

### 3. You have to be able to answer "why did this send at 3am?"

Every status transition writes an immutable `EmailEvent`. Clicking any recipient in the dashboard
opens its full timeline — this is a real one, from an email that lived through three restarts:

```
CREATED   2026-08-31 02:30   score 100
QUEUED    2026-08-31 02:30   delay 600s
QUEUED    2026-08-31 02:30   delay 576s     ← reconciler, restart #1
QUEUED    2026-08-31 02:31   delay 554s     ← reconciler, restart #2 (after FLUSHALL)
QUEUED    2026-08-31 02:31   delay 525s     ← reconciler, restart #3
SENDING   2026-08-31 02:40   attempt 1
SENT      2026-08-31 02:40   attempt 1
OPENED    2026-08-31 02:41   pixel
```

The shrinking delays are the reconciler recomputing `scheduledAt - now` on each boot.

---

## Quick start

**Prerequisites:** Node 22+, Docker Desktop. Nothing else — no local MySQL, no local Redis, and
no email credentials (the app provisions its own Ethereal inbox on first boot).

```bash
docker compose up -d
```

```bash
cd backend && npm install && cp .env.example .env
```

```bash
npx prisma migrate deploy && npm run seed
```

Now start the **API** and the **worker** in two terminals:

```bash
npm run dev
```

```bash
npm run worker
```

…and the frontend in a third:

```bash
cd frontend && npm install && npm run dev
```

Open **<http://localhost:5173>** and sign in — the form is pre-filled with the seeded account:

```
email:    demo@timedink.dev
password: demo1234
```

| Surface | URL |
| --- | --- |
| Dashboard | <http://localhost:5173> |
| API health | <http://localhost:4000/health> |
| Bull Board (queue inspector) | <http://localhost:4000/admin/queues> |

> The `JWT_SECRET` in `.env.example` is a placeholder that works locally. Change it before this
> runs anywhere real — the app refuses to boot if it is under 16 characters.

---

## Running the app

### Infrastructure

`docker compose up -d` starts two containers and nothing else:

- **MySQL 8** on host port **3307** (mapped to 3306 inside). Deliberately not 3306, so it cannot
  collide with a MySQL already installed on the reviewer's machine.
- **Redis 7** on **6379**, with `--appendonly yes`. AOF persistence means delayed jobs survive
  `docker compose restart redis` on their own — that is one half of the restart story; the boot
  reconciler is the half that matters.

Both have healthchecks, so `docker compose ps` tells you when they are genuinely ready rather
than merely started.

### Two backend processes

```bash
npm run dev        # API on :4000  — HTTP, validation, boot reconciliation
npm run worker     # worker        — drains the queue, talks to SMTP
```

Split for the usual reason: a wedged SMTP connection must not be able to make the HTTP tier
unresponsive, and the two scale on completely different axes. They share only MySQL and Redis, so
you can run several of either.

| Command | What it does |
| --- | --- |
| `npm test` | full Vitest suite (no containers needed) |
| `npm run typecheck` | `tsc --noEmit` under `strict` |
| `npm run build` / `npm start` | compile to `dist/` and run the compiled API |
| `npm run seed` | idempotent demo user + two mailboxes |
| `npm run burst -- --count=40` | submit 40 emails at once to demo the rate limiter |
| `npx prisma studio` | browse the database |

### Frontend

```bash
cd frontend && npm install && npm run dev     # http://localhost:5173
```

The Vite dev server proxies `/api` to `localhost:4000`, so the browser stays on a single origin
and there is no CORS preflight on every dashboard poll. Set `VITE_API_BASE_URL` if you'd rather
the browser hit the API directly.

---

## Ethereal Email

Ethereal is a fake SMTP service: it accepts mail, delivers nothing, and gives you a web page per
message. Ideal for a demo — real SMTP behaviour, plus a link you can open on camera.

**You do not need to create an account.** On first boot the worker calls
`nodemailer.createTestAccount()`, provisions a throwaway inbox, and logs the credentials once:

```
INFO: provisioned a throwaway Ethereal account
INFO: Pin these into backend/.env to keep one inbox across restarts:
  ETHEREAL_USER=igc3jypu3xblsw3o@ethereal.email
  ETHEREAL_PASS=…
```

Paste those into `backend/.env` and restart the worker. Without pinning, every restart creates a
*new* inbox — old preview links keep working, but you can no longer browse the old account.

**Finding a sent email's preview:** the **Sent** tab has a `Preview ↗` link on every row, and the
detail drawer has an *Open preview* button. It is `getTestMessageUrl()`, captured at send time
onto `ScheduledEmail.previewUrl`, so it is in the API response and the worker log too.

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

The single most important decision: **MySQL is the source of truth, Redis is a derived index of
outstanding work.** Every scheduled email exists as a row before any job exists, and the queue
can be rebuilt from the database at any moment. Nothing that matters lives only in Redis.

### Scheduling

`POST /api/emails` does four things, in this order, and the order *is* the design:

1. **Write the row to MySQL as `PENDING`.** Nothing has touched Redis yet; at this point the
   user's intent is durable.
2. **Compute `delay = scheduledAt - now`**, clamped at zero. `scheduledAt` is always an absolute
   UTC instant — the browser converts the picker's local wall-clock before sending. `timezone` is
   stored alongside purely so the UI can show what the user originally picked.
3. **Add a delayed BullMQ job** with `queue.add(name, payload, { delay, jobId: 'email-<row.id>' })`.
   The job id is derived from the primary key, which is what makes replay safe.
4. **Flip the row to `QUEUED`** and store `bullJobId`.

Each transition also appends an `EmailEvent`, giving every email an immutable timeline.

If the process dies between (1) and (3) the row is stranded at `PENDING` and the reconciler picks
it up next boot. The reverse order — Redis first — could produce a job referencing a row that was
never committed, which is unrecoverable.

The job payload carries **only an id**, never the body. The worker re-reads the row on every
attempt, so an email cancelled or edited while its job sat in the delayed set is always handled
correctly. A payload snapshot would go stale.

📄 [`services/scheduling.ts`](backend/src/services/scheduling.ts) · [`routes/emails.ts`](backend/src/routes/emails.ts)

### Restart persistence

Two independent mechanisms, and the system needs both.

**1. Redis AOF.** Compose runs Redis with `--appendonly yes`, so the delayed set survives a
container restart on its own.

**2. Boot reconciliation** — the mechanism that actually matters, because AOF does not protect
you against an evicted key, a wiped volume, a `FLUSHALL`, or a Redis that was never running when
the email was created.

On every API boot, **before `app.listen()`**, the reconciler:

- queries MySQL for every `ScheduledEmail` with status `PENDING` or `QUEUED`;
- for each, calls `queue.add` with **the same deterministic `jobId`** and
  `delay = max(0, scheduledAt - now)`;
- logs a one-line summary.

The deterministic job id is what makes this safe to run unconditionally on every start. BullMQ
treats `add` with an existing job id as a no-op, so if Redis still holds the job nothing happens
— no duplicate sends. If Redis lost it, it comes back. The same function
(`enqueueScheduledEmail`) serves both the create path and the reconciler, so the two cannot drift
apart in their delay maths.

It runs *before* the server accepts traffic so no inbound request can create a row mid-sweep and
race it.

**The stale-catch-up rule.** Blindly re-queueing everything after a long outage would dump
thousands of cold emails on real prospects at once — a genuinely destructive default. So anything
past due by more than `STALE_CATCHUP_THRESHOLD_MINUTES` (default 1440 = 24h) is **not** sent: it
becomes `FAILED` with `lastError = "missed window, flagged for manual review"` and a human
decides. Anything past due by *less* than the threshold is re-queued with delay 0 and goes
straight out — the desired "catch up on the last few minutes" behaviour after a normal restart.

All three paths verified end to end:

```
# 1 — restart, Redis intact. Deterministic ids make it a no-op.
reconciliation complete: 3 job(s) re-queued, 0 flagged stale, 0 error(s) from 3 candidate(s) in 66ms
delayed jobs in Redis: 3            ← still 3, not 6. No duplicates.

# 2 — restart after FLUSHALL. Rebuilt entirely from MySQL.
reconciliation complete: 3 job(s) re-queued, 0 flagged stale, 0 error(s) from 3 candidate(s) in 96ms
delayed jobs in Redis: 3            ← was 0 a second earlier

# 3 — one row backdated 3 days, threshold 24h.
reconciliation complete: 2 job(s) re-queued, 1 flagged stale, 0 error(s) from 3 candidate(s) in 75ms
  → restart-test-3@example.com   FAILED   "missed window, flagged for manual review"
```

📄 [`services/reconciliation.ts`](backend/src/services/reconciliation.ts) · called from [`server.ts`](backend/src/server.ts)

### Rate limiting and concurrency

Two different bounds that are easy to conflate. The app uses both:

| | What it bounds | Scope |
| --- | --- | --- |
| **`WORKER_CONCURRENCY`** (default 5) | how many jobs a *single process* runs at once | local resources — sockets, memory, event loop |
| **`RATE_LIMIT_MAX` / `_DURATION_MS`** (default 10 per 10s) | how many jobs may *start* per window | global, coordinated in Redis across **all** workers |

The limiter is the one that models the real constraint: a provider that starts returning
`421 4.7.0 Too many messages` above some rate. Adding worker processes does not raise it — that
is the point.

> **A deliberate deviation from the brief.** It describes `limiter: { max, duration }` as a Queue
> option. In BullMQ that option lives on the **Worker** (`WorkerOptions.limiter`) — there is no
> queue-level equivalent. It is still a queue-wide limit enforced in Redis across every worker,
> which is the behaviour asked for; only the mounting point differs. The shared config is exported
> from [`emailQueue.ts`](backend/src/queue/emailQueue.ts) and applied in
> [`worker.ts`](backend/src/worker.ts) so it reads as one setting.

**Retries.** Transient failures use BullMQ's built-in `attempts` + exponential backoff (3
attempts, 5s base). Between attempts the row sits at `QUEUED` with `lastError` populated, so the
dashboard shows it as still in flight; it only lands in `FAILED` once attempts are exhausted.
Reporting `FAILED` on attempt 1 of 3 would be a lie the UI then has to walk back.

📄 [`worker.ts`](backend/src/worker.ts) · [`queue/processor.ts`](backend/src/queue/processor.ts)

---

## Data model

```
User ──┬── Mailbox ──┐
       │             │
       └── ScheduledEmail ──── EmailEvent
                │
                └── followUpOf (self-relation)
```

| Table | Notes |
| --- | --- |
| `users` | email (unique), bcrypt hash, name |
| `mailboxes` | sender identity + `warmupDay` + `dailyLimit` |
| `scheduled_emails` | the row that *is* the truth. `scheduledAt` always UTC; `timezone` stored for display; `bullJobId` is derived, not authoritative |
| `email_events` | append-only audit trail, one row per transition, with a JSON `meta` |

Indexes are chosen for the two hot queries: `(userId, status)` for the dashboard listing and
`(status, scheduledAt)` for the reconciliation sweep.

📄 [`prisma/schema.prisma`](backend/prisma/schema.prisma)

---

## Bonus layers

All three are implemented and wired end to end.

### A — Deliverability Guard

`scoreDeliverability(subject, bodyText) → { score, flags, details }` is a pure function: no I/O,
no clock, no randomness. It penalises spam-trigger vocabulary (weighted more heavily in the
subject), ALL-CAPS ratio, a missing or thin plain-text body, exclamation-mark abuse, link density
and over-long subjects.

It runs at creation time and the score is stored on the row. It is **informational** — a score of
3 still gets scheduled, it just wears a red figure. Blocking sends on a heuristic would be the
wrong call. The compose form also scores live as you type (debounced, against
`POST /api/emails/preview-score`), so you see the flags before committing.

### B — Warmup throttling

`Mailbox.warmupDay` drives a daily ceiling: `day N → min(10 × N, 100)`, further capped by an
explicit per-mailbox `dailyLimit`. Enforcement is a Redis counter keyed by mailbox and **UTC
day**, consumed at the very top of the worker processor before any SMTP work happens.

Check-and-consume runs as a **single Lua script** — `INCR`, set the TTL on first write, `DECR`
back if it went over. Separate round trips would race between worker processes. A failed send
refunds its unit so a flaky SMTP hop does not eat the day's allowance.

A job over its cap **re-delays itself** (`moveToDelayed` + `DelayedError`) rather than failing:
being over quota is a scheduling condition, not an error.

`POST /api/mailboxes/:id/advance-warmup` (the *Advance day* button) bumps the warmup day so the
ramp is demonstrable without waiting real days.

### C — Rotation, open tracking, follow-ups

- **Rotation** — new emails round-robin across a user's mailboxes via a Redis counter, assigned at
  creation. Visible in the dashboard's *From* column, alternating cleanly.
- **Open tracking** — when an email sets a follow-up window, a 1×1 transparent PNG is injected
  into its HTML at send time. `GET /api/track/:id.png` records an `OPENED` event and stamps
  `openedAt`. Unauthenticated by necessity (a mail client has no token); the id is a v4 UUID so it
  is unguessable, and it always returns the pixel — even for an unknown id — so it cannot be used
  to probe which ids exist. The write is idempotent.
- **Follow-ups** — a sweeper in the worker process finds emails that were `SENT` with tracking on,
  whose window elapsed, with no `OPENED` event. It claims the row with a conditional update (so
  two sweepers cannot both fire) and creates a **new** `ScheduledEmail` with `followUpOfId` set,
  which flows through the identical queue path. It reuses the original mailbox on purpose — a
  follow-up from a different sender address breaks the thread.

> Pixel tracking is a lower bound on opens, not a measurement. Gmail proxies images, Apple Mail
> Privacy Protection fires them unconditionally, and text-only clients never fire them at all.
> "No `OPENED` event" means "no evidence of an open".

---

## Feature-to-code map

### Backend

| Feature | File(s) |
| --- | --- |
| Scheduler (create → delayed job) | [`services/scheduling.ts`](backend/src/services/scheduling.ts) · [`queue/emailQueue.ts`](backend/src/queue/emailQueue.ts) · [`routes/emails.ts`](backend/src/routes/emails.ts) |
| Restart persistence / reconciliation | [`services/reconciliation.ts`](backend/src/services/reconciliation.ts) · [`server.ts`](backend/src/server.ts) · [`docker-compose.yml`](docker-compose.yml) |
| Rate limiting (queue-wide cap) | [`worker.ts`](backend/src/worker.ts) · [`queue/emailQueue.ts`](backend/src/queue/emailQueue.ts) |
| Concurrency (per-process bound) | [`worker.ts`](backend/src/worker.ts) |
| Send pipeline / retries | [`queue/processor.ts`](backend/src/queue/processor.ts) · [`services/mailer.ts`](backend/src/services/mailer.ts) |
| Auth (JWT + bcrypt) | [`services/auth.ts`](backend/src/services/auth.ts) · [`middleware/auth.ts`](backend/src/middleware/auth.ts) · [`routes/auth.ts`](backend/src/routes/auth.ts) |
| Cancellation | [`services/scheduling.ts`](backend/src/services/scheduling.ts) (`cancelScheduledEmail`) |
| Audit trail | [`services/events.ts`](backend/src/services/events.ts) |
| Validation / errors / logging / config | [`middleware/validate.ts`](backend/src/middleware/validate.ts) · [`middleware/error.ts`](backend/src/middleware/error.ts) · [`lib/logger.ts`](backend/src/lib/logger.ts) · [`config/env.ts`](backend/src/config/env.ts) |
| Bonus A — deliverability | [`services/deliverability.ts`](backend/src/services/deliverability.ts) |
| Bonus B — warmup | [`services/warmup.ts`](backend/src/services/warmup.ts) · [`queue/processor.ts`](backend/src/queue/processor.ts) |
| Bonus C — rotation / tracking / follow-ups | [`services/scheduling.ts`](backend/src/services/scheduling.ts) · [`services/tracking.ts`](backend/src/services/tracking.ts) · [`routes/track.ts`](backend/src/routes/track.ts) · [`services/followUp.ts`](backend/src/services/followUp.ts) |
| Seed / demo tooling | [`prisma/seed.ts`](backend/prisma/seed.ts) · [`scripts/burst.ts`](backend/scripts/burst.ts) |

### Frontend

| Feature | File(s) |
| --- | --- |
| Login / register | [`LoginPage.tsx`](frontend/src/pages/LoginPage.tsx) · [`RegisterPage.tsx`](frontend/src/pages/RegisterPage.tsx) · [`lib/auth.tsx`](frontend/src/lib/auth.tsx) |
| Dashboard (status tabs, polling) | [`DashboardPage.tsx`](frontend/src/pages/DashboardPage.tsx) |
| Tables (per-status, preview links) | [`EmailTable.tsx`](frontend/src/features/emails/EmailTable.tsx) |
| **Detail drawer + event timeline** | [`EmailDetailDrawer.tsx`](frontend/src/features/emails/EmailDetailDrawer.tsx) |
| Compose (tz-aware picker, live scoring) | [`ComposeModal.tsx`](frontend/src/features/emails/ComposeModal.tsx) · [`lib/format.ts`](frontend/src/lib/format.ts) |
| Mailbox panel (warmup, rotation) | [`MailboxPanel.tsx`](frontend/src/features/mailboxes/MailboxPanel.tsx) |
| Typed API client | [`lib/api.ts`](frontend/src/lib/api.ts) |
| Design system / shared UI | [`index.css`](frontend/src/index.css) · [`components/ui.tsx`](frontend/src/components/ui.tsx) |
| Accessibility plumbing | [`lib/useFocusTrap.ts`](frontend/src/lib/useFocusTrap.ts) · [`lib/useDocumentTitle.ts`](frontend/src/lib/useDocumentTitle.ts) · [`components/ErrorBoundary.tsx`](frontend/src/components/ErrorBoundary.tsx) |

---

## API reference

All `/api/emails` and `/api/mailboxes` routes require `Authorization: Bearer <token>`. Responses
are `{ "data": … }`; list responses add `{ "pagination": … }`. Errors are
`{ "error": { "code", "message", "details"? } }`.

| Method | Route | Purpose |
| --- | --- | --- |
| `POST` | `/api/auth/register` | create an account → `{ token, user }` |
| `POST` | `/api/auth/login` | sign in → `{ token, user }` |
| `GET` | `/api/auth/me` | validate a stored token |
| `POST` | `/api/emails` | schedule an email |
| `GET` | `/api/emails?status=&page=&pageSize=&q=` | list (status accepts `SENT,FAILED`) |
| `GET` | `/api/emails/stats` | per-status counts for the tab badges |
| `GET` | `/api/emails/:id` | detail **incl. the event timeline** |
| `DELETE` | `/api/emails/:id` | cancel a `PENDING`/`QUEUED` email |
| `POST` | `/api/emails/preview-score` | deliverability score without saving |
| `GET` | `/api/mailboxes` | mailboxes + today's warmup usage |
| `POST` | `/api/mailboxes` | add a mailbox |
| `POST` | `/api/mailboxes/:id/advance-warmup` | demo control for the warmup ramp |
| `GET` | `/api/track/:id.png` | open-tracking pixel (**unauthenticated**) |
| `GET` | `/health` | liveness |

**Auth choice:** JWT as a **bearer token** in `localStorage`. Chosen over an httpOnly cookie
because the SPA and the API are cross-origin in development, which would mean `SameSite=None` +
credentialed CORS + CSRF handling for no benefit at this scale. The trade-off — an XSS becomes a
session compromise — is recorded in [`ASSUMPTIONS.md`](ASSUMPTIONS.md) §2.1.

```bash
curl -s -X POST http://localhost:4000/api/auth/login -H 'Content-Type: application/json' -d '{"email":"demo@timedink.dev","password":"demo1234"}'
```

---

## Interface

React 19 + TanStack Query + Tailwind 4. No component library and no animation library — the four
runtime dependencies are React, React DOM, React Router and TanStack Query.

The design is editorial: a warm paper canvas, ink type, hairline rules, and a single amber accent
reserved for primary actions and the active marker. Depth is a 1px rule and a surface one shade
lighter than the canvas — never a shadow or a blur. The whole app sits inside a ruled frame with
the paper showing around it, which is what makes it read as a composed page rather than a browser
window.

Three typefaces, each with a job and a full system fallback:

| Face | Used for |
| --- | --- |
| Instrument Serif | display only — page titles, auth headline, drawer and modal headings |
| Inter | all running text and UI |
| JetBrains Mono | micro-labels, timestamps, scores, counts |

Details worth calling out:

- **Timestamps** render as `2026-08-31 02:29` — shorter than a locale string in a fixed-width
  column, sorts the way it reads, and 24h removes the AM/PM ambiguity that bites people scheduling
  near midnight. The human-readable "3 days ago" sits underneath.
- **Polling, not sockets.** The dashboard re-reads every 4s. That is the right call at this size
  and it recovers from an API restart with no reconnect logic; at scale this becomes an SSE or
  WebSocket subscription, and the worker's `EmailEvent` writes are already exactly the stream you
  would publish. Noted in a comment where the interval is defined.
- **Accessibility.** Every text/background pair is measured against WCAG AA (`ink-3` at 4.84:1,
  status hues 4.5–6.1:1) and form-control boundaries against the 3:1 required by 1.4.11. Both
  dialogs trap Tab and restore focus to their trigger; there is a skip link, `<main>` landmarks,
  `aria-live` toasts, and status is conveyed by a **dot *and* a word**, never colour alone.
- **Failure containment.** A render-time throw hits an error boundary that keeps the page usable
  and points out that the queue is unaffected, rather than white-screening.
- **Keyboard.** `c` opens the composer, `Esc` closes either overlay.

---

## Tests

```bash
cd backend && npm test
```

**56 tests, ~2s, and no MySQL, Redis or SMTP required.** Everything at the process edge is faked,
so the suite runs on a clean checkout and in CI without containers.

| File | Covers |
| --- | --- |
| [`unit/warmup.test.ts`](backend/tests/unit/warmup.test.ts) | the rate-limiting logic this app owns: the warmup token bucket (allow/deny at the boundary, roll-back on denial, TTL set exactly once, per-mailbox isolation, UTC-day rollover, refunds that never go negative) and the limit arithmetic |
| [`unit/reconciliation.test.ts`](backend/tests/unit/reconciliation.test.ts) | boot reconciliation: the requeue-vs-stale policy including exact threshold boundaries, `PENDING` rows, one clock across the sweep, and failure isolation when a row throws |
| [`unit/deliverability.test.ts`](backend/tests/unit/deliverability.test.ts) | the scorer, including purity and score clamping |
| [`integration/createEmail.test.ts`](backend/tests/integration/createEmail.test.ts) | `POST /api/emails` end to end through express → auth → zod → scheduling → `queue.add`, asserting the job is enqueued **with the correct delay** and the deterministic job id; plus write-ordering (row durable before Redis is touched), the event trail, past-time clamping, auth/validation rejection, and the cancel path |

The queue-level limiter is BullMQ's own, so it is verified by observation (the burst histogram
above) rather than by unit-testing a library.

---

## Configuration

Every value is validated by zod at import time — a missing or malformed variable is a hard boot
failure with a readable message, never an `undefined` that surfaces as a mystery 500 an hour
later. Full list with defaults in [`backend/.env.example`](backend/.env.example) and
[`frontend/.env.example`](frontend/.env.example).

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | `mysql://root:outbox@localhost:3307/outbox_pilot` | Prisma connection |
| `REDIS_URL` | `redis://localhost:6379` | BullMQ + warmup counters |
| `JWT_SECRET` | *(placeholder)* | must be ≥ 16 chars |
| `ETHEREAL_USER` / `_PASS` | *(auto-provisioned)* | pin to keep one inbox |
| `WORKER_CONCURRENCY` | `5` | jobs in flight per worker process |
| `RATE_LIMIT_MAX` / `_DURATION_MS` | `10` / `10000` | queue-wide send cap |
| `JOB_ATTEMPTS` / `JOB_BACKOFF_MS` | `3` / `5000` | retry policy |
| `STALE_CATCHUP_THRESHOLD_MINUTES` | `1440` | past-due window before flagging for review |
| `WARMUP_ENABLED` | `true` | bonus B toggle |
| `MAILBOX_ROTATION_ENABLED` | `true` | bonus C toggle |
| `FOLLOWUP_CHECK_INTERVAL_MS` | `60000` | follow-up sweep cadence |
| `BULL_BOARD_ENABLED` | `true` | **unauthenticated** — keep `false` in production |
| `LOG_PRETTY` | `true` | human-readable logs (`false` for JSON) |
| `VITE_POLL_INTERVAL_MS` | `4000` | dashboard refresh cadence |

---

## Demo script

A five-minute path that hits everything worth showing.

**1 · Seeded login** *(~20s)* — open <http://localhost:5173>; the demo credentials are pre-filled.

**2 · Compose** *(~60s)* — press `c`. Type a deliberately spammy subject (`FREE CASH!!! ACT NOW`)
and watch the deliverability score fall live with its flags. Pick a time a minute out and
schedule. It appears under **Scheduled** as `QUEUED`; when the worker picks it up the status flips
with no refresh. Open `Preview ↗` on the **Sent** tab for the real Ethereal message.

**3 · The timeline** *(~40s)* — click any recipient. The drawer shows the full
`CREATED → QUEUED → SENDING → SENT` trail with per-event metadata. This is the audit story.

**4 · Rate limiting** *(~90s)* — with the worker log on screen:

```bash
cd backend && npm run burst -- --count=40
```

40 emails accepted in ~3 seconds, then draining over ~35–40 seconds in visible batches.
<http://localhost:4000/admin/queues> shows delayed/active/completed moving.

> For a *pure* rate-limit demo, click **Advance day** on both mailboxes first so the warmup cap is
> not also binding. Leaving it alone demos warmup instead — jobs re-delay at the ceiling.

**5 · Restart persistence** *(~90s)* — schedule two emails ten minutes out, then:

```bash
docker exec outbox-redis redis-cli FLUSHALL
```

Stop the API (`Ctrl-C`) and start it again. One line in the boot log:

```
reconciliation complete: 2 job(s) re-queued, 0 flagged stale, 0 error(s) from 2 candidate(s) in 96ms
```

Confirm they are genuinely back:

```bash
docker exec outbox-redis redis-cli ZCARD bull:outbox-emails:delayed
```

Then reopen the drawer on one of them — a second `QUEUED` event has appeared, which is the
reconciler's work made visible in the product.

**6 · Stale flagging** *(~40s)* — set `STALE_CATCHUP_THRESHOLD_MINUTES=1`, backdate a row,
restart, and watch it land in **Failed** with *"missed window, flagged for manual review"* instead
of blasting out.

Logs are pino + pino-pretty (colourised, pid/hostname stripped, pixel and health requests filtered
out), so the terminal reads well on camera. `LOG_PRETTY=false` for JSON.

---

## Troubleshooting

**`docker compose up` hangs, or `docker ps` never returns.** The Docker engine is not running. On
Windows, if Docker Desktop crash-loops, check
`%LOCALAPPDATA%\Docker\log\host\com.docker.backend.exe.log` — a stale socket in
`%LOCALAPPDATA%\Docker\run\` (`dockerInference`) blocks startup. Rename that `run` folder while
Docker is stopped, then relaunch. *(This happened while building it.)*

**`Invalid environment configuration` on boot.** The message names the variable. Usually a missing
`.env` (`cp .env.example .env`) or a `JWT_SECRET` under 16 characters.

**`P1001: Can't reach database server`.** MySQL is still starting — `docker compose ps` should
show `healthy`. Note the port is **3307**, not 3306.

**Emails stay `QUEUED` forever.** The worker is not running. `npm run worker` is a separate
process from `npm run dev`.

**Emails go to `FAILED` with an SMTP error.** Ethereal needs outbound access on port 587. If
pinned credentials have lapsed, blank `ETHEREAL_USER`/`ETHEREAL_PASS` to provision a fresh inbox.

**A mailbox stops sending partway through a burst.** It hit its warmup daily cap — the sidebar
shows `n/limit today`. Click **Advance day**, or set `WARMUP_ENABLED=false`.

**Start over completely:**

```bash
cd backend && npx prisma migrate reset --force && npm run seed
```

---

## What I'd build next

In priority order, with reasoning — the full list of shortcuts and trade-offs is in
[`ASSUMPTIONS.md`](ASSUMPTIONS.md).

1. **Push instead of poll.** The `EmailEvent` stream already exists; an SSE endpoint over it would
   drop the 4-second refresh and make the dashboard genuinely live.
2. **Rate-limit the auth endpoints.** `express-rate-limit` keyed by IP + email, ~10 lines. The
   most obvious hardening gap today.
3. **A conditional status update as the send gate.** Closes the last microseconds of the
   cancel-versus-send race (§3.1) with a compare-and-set instead of a read-then-send.
4. **Frontend tests.** All 56 are backend; with the time available, testing the
   scheduling/reconciliation/limiter logic was worth more than testing that a table renders.
5. **CI + app Dockerfiles.** `npm test` and `npm run typecheck` are hermetic and would drop
   straight into a workflow.
6. **Observability.** Queue depth, send latency and failure rate are the three metrics you would
   want before running this for real.

---

**See [`ASSUMPTIONS.md`](ASSUMPTIONS.md)** for every shortcut, trade-off and known limitation —
including the two deliberate deviations from the brief, and an explicit list separating what was
verified end to end from what was only implemented.
