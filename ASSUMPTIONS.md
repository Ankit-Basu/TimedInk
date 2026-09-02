# Assumptions, trade-offs and known limitations

Everything below is a deliberate decision made under a 48-hour budget, not an oversight I
haven't noticed. Where something is a genuine shortcut, it says so and says what the real answer
would be.

Status key: **Done** · **Partial** · **Not built**

---

## 1. Deviations from the brief

### 1.1 The rate limiter lives on the Worker, not the Queue — **Done**

The brief specifies `limiter: { max, duration }` as a Queue option. In BullMQ that option is on
`WorkerOptions`, not `QueueOptions`; there is no queue-level equivalent. It is still a
**queue-wide** limit coordinated through Redis across every worker process, which is the
behaviour the brief describes — only the mounting point differs.

The shared config lives in `src/queue/emailQueue.ts` (`rateLimitConfig`) and is applied in
`src/worker.ts`, so it reads as one setting even though it is attached to the worker.

### 1.2 Status between retries is `QUEUED`, not `FAILED` — **Done**

The brief says "on failure stores FAILED + lastError". Taken literally, an email would show as
`FAILED` after attempt 1 of 3 while BullMQ was still going to retry it — the UI would then have
to un-fail it, which is a lie the dashboard has to walk back.

What actually happens: `lastError` and `attempts` are written on **every** failed attempt, and
the status goes to `FAILED` only when BullMQ has exhausted its attempts. In between it returns to
`QUEUED` with `lastError` populated, so the dashboard shows "still in flight, last error was X".
A `FAILED` `EmailEvent` is written for each attempt with `{ attempt, maxAttempts, final }`, so the
audit trail is complete either way.

### 1.3 Prisma pinned to 6.x, TypeScript to 5.9 — **Done**

Prisma 7 removes `url = env("DATABASE_URL")` from `schema.prisma` in favour of a
`prisma.config.ts` plus a driver adapter (`@prisma/adapter-mariadb` for MySQL). That is more
moving parts, a less familiar schema, and more setup steps between clone and running app — the
opposite of what "clone to running in under 10 minutes" wants. Prisma 6.19 is current-generation
and uses the conventional layout every reviewer will recognise.

TypeScript is pinned to 5.9 rather than 7.0 (the new native compiler) for the same reason:
maximum compatibility with the Prisma-generated client and the rest of the toolchain.

### 1.4 Schema additions beyond the specified model — **Done**

The brief's field list is implemented in full. Four columns were added to `ScheduledEmail`,
each load-bearing for a bonus layer:

| Column | Why |
| --- | --- |
| `deliverabilityFlags` (Json) | `deliverabilityScore` alone is a number with no explanation; the dashboard needs the flag list to be useful. |
| `followUpAfterHours` | The brief's "follow up after N hours if unopened" field has to live somewhere. |
| `followUpQueuedAt` | Idempotency guard so two sweepers cannot both queue a follow-up. |
| `openedAt`, `sentAt` | Denormalised from the `OPENED`/`SENT` events so the follow-up sweeper is one indexed query rather than a join per row. The events remain the audit record. |

---

## 2. Security

### 2.1 JWT in `localStorage` — **Deliberate, would change in production**

Bearer token in `Authorization`, stored in `localStorage`. Chosen because the SPA (`:5173`) and
API (`:4000`) are cross-origin in development, so an httpOnly cookie would require
`SameSite=None`, credentialed CORS and CSRF protection — real complexity for no benefit at this
scale, and it makes `curl` demos trivial.

**The cost:** any XSS on the page can read the token. The production answer is a short-lived
access token in memory plus an httpOnly, `SameSite=Strict` refresh cookie.

### 2.2 Tokens cannot be revoked before expiry — **Known gap**

`requireAuth` verifies signatures only; there is no per-request database lookup. Deleting a user
does not invalidate their outstanding tokens until the 7-day expiry. A Redis token blocklist
checked in the middleware is the standard fix; it was not worth the round-trip-per-request here.

### 2.3 Bull Board is unauthenticated — **Local only**

`/admin/queues` exposes job payloads and lets you retry/remove jobs with no auth at all. It is
gated behind `BULL_BOARD_ENABLED` (default `true` for the demo) and **must** be `false` or put
behind an auth proxy in any real deployment. Called out in the code comment too.

### 2.4 No rate limiting on the auth endpoints — **Not built**

`/api/auth/login` will accept unlimited attempts. `express-rate-limit` keyed by IP + email is
~10 lines and is the obvious first hardening step. Login *does* compare against a dummy bcrypt
hash when the email is unknown, so response timing does not leak which accounts exist.

### 2.5 The tracking pixel route is unauthenticated — **By necessity**

A recipient's mail client has no token. Mitigations: the id is a v4 UUID (unguessable), the route
always returns the pixel even for unknown ids (so it cannot enumerate), and the write is
idempotent. The worst a forged hit achieves is suppressing one follow-up.

### 2.6 Email bodies are stored and sent as-is — **Acceptable here**

The compose form collects plain text and the server derives HTML with everything escaped
(`src/lib/html.ts`), so there is no injection path today. If users were ever allowed to author
raw HTML, that input would need sanitising (DOMPurify or equivalent) before storage.

### 2.7 No CSRF protection — **Not needed with bearer tokens**

Requests authenticate via a header, not an ambient cookie, so cross-site form posts cannot carry
credentials. This becomes required the moment auth moves to cookies (see 2.1).

---

## 3. Correctness and edge cases

### 3.1 Cancel has a small unavoidable race — **Handled, not eliminated**

`DELETE /api/emails/:id` removes the Redis job then flips the row to `CANCELLED`. If the worker
picks the job up in between, `job.remove()` fails on a locked job. The safety net is that **the
worker re-reads the row and refuses to send anything that is not `PENDING`/`QUEUED`/`SENDING`** —
the database status is the tiebreaker, not Redis. The residual window is the microseconds
between that status read and the SMTP call; closing it fully needs a conditional status update
(compare-and-set) as the send gate, which is the right fix at volume.

### 3.2 Exactly-once delivery is not claimed — **Inherent**

If the process dies *after* SMTP accepts a message but *before* the row is updated to `SENT`, the
retry will send it again. This is the standard at-least-once outcome for any queue + external
side effect; genuinely fixing it needs a provider-side idempotency key. Deterministic job ids
prevent duplicate *jobs*, which is the failure mode that actually occurs in practice here.

### 3.3 Reconciliation writes a `QUEUED` event on every boot — **Cosmetic**

An email that survives four restarts accumulates four `QUEUED` events. That is truthful — it
genuinely was re-queued four times — but it makes the timeline noisier than a first-time reader
expects. Suppressing the event when the job already existed would need `queue.add` to report
whether it deduplicated, which BullMQ does not surface directly.

### 3.4 `scheduledAt` in the past is allowed — **Deliberate**

The delay clamps to 0 and the email sends immediately. This is what makes "send now" possible
from the same code path, and it is what the burst script relies on. The boot reconciler applies
the stale threshold, so a *past-due* email is only auto-sent on restart if it is inside the
catch-up window.

### 3.5 Timezones are stored, not computed with — **Sufficient here**

`scheduledAt` is an absolute UTC instant; `timezone` is recorded for display only. The browser
does the local→UTC conversion once, at compose time. This is correct for one-shot sends. It would
**not** be correct for recurring schedules ("every weekday at 9am Berlin time"), where DST means
you must store the wall-clock time plus the zone and recompute each occurrence.

### 3.6 The warmup quota window is a fixed UTC day, not a sliding window — **Simplification**

A mailbox's counter resets at UTC midnight rather than tracking a rolling 24 hours. That means
sending 100 at 23:59 and 100 at 00:01 is possible. A sliding window (a sorted set of send
timestamps, trimmed on read) is the correct implementation; the fixed bucket is one `INCR` and
was the right cost/benefit for the demo. The Lua check-and-consume is genuinely atomic, so the
*concurrency* correctness is real — only the window shape is simplified.

### 3.7 Follow-ups are swept on an interval, not scheduled per email — **Deliberate**

A `setInterval` in the worker process (60s, Redis-locked) rather than a delayed job per email,
because the decision depends on state that arrives *after* scheduling (did an open land?), and a
periodic indexed query is easier to reason about than a job that must be cancelled when the pixel
fires. At real volume this becomes a BullMQ repeatable job with a cursor over a partitioned
table. The sweep is capped at 200 rows per pass.

### 3.8 Mailbox rotation is a Redis counter, not least-recently-used — **Simplification**

`INCR rotation:mailbox:<userId>` modulo the mailbox count. O(1) and correct across API processes,
but the counter is not persisted per-mailbox, so mailboxes added mid-stream shift the assignment.
If Redis is unavailable it falls back to the oldest mailbox rather than failing the request — an
uneven distribution is much cheaper than a dropped email.

### 3.9 Deliverability scoring is a hand-written heuristic — **By design**

A ~30-word spam list and some ratios. It is intentionally simple, pure and fast enough to run
inside a request handler. A real product would use a maintained corpus, per-tenant tuning, and
would learn from actual bounce/complaint feedback — plus SPF/DKIM/DMARC checks and domain
reputation, none of which are meaningful against Ethereal.

---

## 4. Scope explicitly not built

| Not built | Why / what it would take |
| --- | --- |
| **WebSocket/SSE live updates** | The dashboard polls every 4s. Noted in a comment in `DashboardPage.tsx`. The worker already writes an `EmailEvent` per transition, which is exactly the stream you would publish. |
| **Editing a scheduled email** | Only create and cancel. Editing means changing the delay, which means `job.changeDelay()` plus revalidation — cancel-and-recreate covers the need. |
| **Mailbox CRUD in the UI** | `POST /api/mailboxes` exists and is tested by hand; the UI only lists mailboxes and advances warmup. The seed creates two, which is what the demo needs. |
| **Email detail drawer** | `GET /api/emails/:id` returns the full event timeline and is used by nothing in the UI yet. It is the single highest-value next addition — the audit trail is the interesting part of this system. |
| **Bulk actions** | No multi-select cancel. |
| **Refresh tokens / password reset / email verification** | Out of scope for a take-home; register + login only. |
| **Frontend tests** | All 56 tests are backend. With the time available, testing the scheduling/reconciliation/limiter logic was worth more than testing that a React table renders. Vitest + Testing Library would slot in with no config change. |
| **CI pipeline** | No GitHub Actions workflow. `npm test` and `npm run typecheck` are hermetic and would drop straight into one. |
| **Dockerfiles for the app itself** | Compose runs MySQL + Redis only; the app runs on the host for fast reloads and readable stack traces. Production would add multi-stage Dockerfiles for API and worker. |
| **Observability** | Structured pino logs only. No metrics, no tracing. Queue depth, send latency and failure rate are the three you would want first. |
| **Migrations beyond the initial one** | One `init` migration. |

---

## 4a. Interface decisions

### 4a.1 The UI is deliberately plain — **Done**

An earlier pass built this as a glassmorphic dark theme: a WebGL particle field, four levels of
`backdrop-filter` glass, violet-to-aqua gradients, animated counters, spotlight cards and a
grain overlay. It was rebuilt flat, and the reasons are worth stating because "less" was the
harder call:

- **It fought the data.** This screen exists to answer "what is queued, what went out, what
  broke". Translucent panels over a drifting gradient reduce text contrast and add motion next
  to a table that is already updating every four seconds.
- **It cost real performance.** A 140-particle WebGL canvas plus `backdrop-filter` on every
  panel keeps the GPU busy continuously, on a dashboard people leave open all day.
- **One widget was actively dishonest.** The stat cards carried a progress bar whose width was
  `min(100, value * 8)` — a bar that encoded nothing, filling up as a number grew with no
  denominator behind it. It has been removed rather than restyled.

What replaced it is an editorial layout: a warm paper canvas, ink type, hairline rules, one
amber accent, and a ruled frame around the whole app. `ogl` and `framer-motion` were removed,
taking the runtime dependency list down to React, React DOM, React Router and TanStack Query.

### 4a.2 Three webfonts, deliberately — **Done**

Instrument Serif (display), Inter (UI), JetBrains Mono (labels and figures), from Google Fonts.
An earlier pass ran on the system stack alone; in this layout type *is* the design, so the three
faces earn their bytes. Each has a full system fallback declared in `index.css`, so a reviewer
with no network still gets a working, legible app — just a plainer one.

### 4a.3 Light-only, with no theme toggle — **Deliberate**

The palette is defined once as CSS custom properties, so a dark variant is a token swap rather
than a rewrite, but none is shipped and there is no toggle. Two themes means two sets of contrast
decisions to verify, and only one of them would get demoed.

### 4a.4 Density over comfort in the table — **Deliberate**

13px body type, seven columns fixed with a `colgroup`, every cell `overflow-hidden` and
truncating with the full value in `title`. The display type is generous; the data is not. The
table sets a 940px minimum width and scrolls horizontally below it rather than reflowing or
hiding columns, because on a phone the honest answer is that this view needs a different layout,
not a squeezed one — which is not built.

---

## 5. Environment and operational assumptions

- **Single-tenant-ish.** Every query is scoped by `userId`, but there is no organisation/team
  model, no roles, and no sharing.
- **One worker process in the demo.** The design supports many (the limiter and the warmup bucket
  are both Redis-coordinated); only one is run.
- **The follow-up sweeper runs in the worker, not the API**, so it does not multiply if the API is
  scaled out. If you run several workers, the Redis lock keeps it to one sweep per interval.
- **MySQL 8 and Redis 7** as pinned in `docker-compose.yml`. MySQL is on host port **3307** to
  avoid colliding with a natively installed server.
- **Ethereal is a test service.** Nothing is actually delivered, so bounce handling, unsubscribe
  headers, DKIM signing and reputation management are all out of scope — they are also most of
  what a real cold-email product is.
- **`.env` is gitignored; `.env.example` is committed** with working local defaults. The one value
  that must change outside local dev is `JWT_SECRET`.
- **No secrets are committed.** The Ethereal credentials in the demo run live only in the local
  `.env`; a fresh clone provisions its own.

---

## 6. Verified vs. assumed

Everything in this list was actually run, not just written:

- ✅ `docker compose up -d` → both containers healthy
- ✅ `prisma migrate dev` → schema applied to MySQL 8
- ✅ `npm run seed` → demo user + 2 mailboxes, idempotent on re-run
- ✅ Register, login, `/api/auth/me`, and 401 on a missing token
- ✅ Schedule → `QUEUED` → `SENDING` → `SENT` with a real Ethereal preview URL
- ✅ 40-email burst: accepted in ~3s, drained over 35s in visible batches (limiter working)
- ✅ Restart with Redis intact: 3 re-queued, delayed set still 3 — **no duplicates**
- ✅ Restart after `FLUSHALL`: delayed set rebuilt 0 → 3 from MySQL
- ✅ Backdated row past the threshold → `FAILED` / *"missed window, flagged for manual review"*
- ✅ Cancel from the UI → job removed, status `CANCELLED`, event written
- ✅ Mailbox rotation alternating cleanly across both mailboxes in the Sent table
- ✅ Warmup counters incrementing per send and surfaced in the sidebar
- ✅ Tracking pixel returns a real 1×1 PNG, records `OPENED` once, idempotent on repeat hits
- ✅ Live deliverability preview in compose (spammy draft scored 20 with 4 flags, still schedulable)
- ✅ `npm test` — 56 passing, no containers required
- ✅ `tsc --noEmit` clean on both backend and frontend under `strict`
- ✅ `npm run build` clean on both

Assumed but **not** directly exercised:

- ⚠️ **The follow-up sweeper firing for real.** The code path is complete and the sweeper is
  running (it logs on start), but the shortest demonstrable window is 1 hour, so a live
  end-to-end follow-up was not waited out. Open tracking and the `OPENED` event — the part the
  sweeper reads — *were* verified directly. To exercise it: schedule with
  `followUpAfterHours: 1`, let it send, then backdate `sentAt` by an hour in MySQL and drop
  `FOLLOWUP_CHECK_INTERVAL_MS` to something small.
- ⚠️ **Multi-worker operation.** The limiter and warmup bucket are Redis-coordinated and designed
  for it, but only one worker process was run.
- ⚠️ **Retry/backoff on a real transient failure.** The retry path is implemented and the final
  attempt correctly lands in `FAILED`, but no SMTP outage was simulated to watch all three
  attempts and their backoff.
