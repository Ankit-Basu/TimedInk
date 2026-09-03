# Demo script — TimedInk

A read-aloud script for a screen recording. Target **4:30–5:00**.

Lines marked **SAY** are meant to be read more or less verbatim. Lines marked **DO** are what you
click. Don't rush the two "wait" moments — the pauses are the demo.

---

## Before you hit record

**1 — Reset to a clean slate** *(one terminal, then close it)*

```bash
cd backend && npx prisma migrate reset --force && npm run seed
```

**2 — Start four things.** Terminals 1 and 2 are the ones you'll show on camera, so give them a
readable font size.

| Terminal | Command |
| --- | --- |
| 1 — API | `cd backend && npm run dev` |
| 2 — Worker | `cd backend && npm run worker` |
| 3 — Frontend | `cd frontend && npm run dev` |
| 4 — hidden, for the burst | `cd backend` (leave it idle) |

**3 — Open these tabs** and leave them loaded:

- `http://localhost:5173` — signed **out** (you'll sign in on camera)
- `http://localhost:4000/admin/queues` — Bull Board

**4 — Screen layout.** Browser on the left ~⅔, terminals 1 and 2 stacked on the right ~⅓. You
need to see the worker log and the dashboard *at the same time* for the rate-limit section.

**5 — Quick checks:** the dashboard should show 0 emails, and both mailboxes should read
`0/30` and `0/10`.

---

## 0:00 – 0:25 · What it is

> **SAY:** "This is TimedInk — a scheduled email sender. You write an email, pick a send time in
> your own timezone, and it goes out then. The interesting part isn't the scheduling, it's what
> happens when things go wrong: when the process restarts, when Redis loses its data, or when the
> provider starts throttling you. That's what I'll show."

**DO:** Sign in. Credentials are pre-filled — just click **Sign in**.

> **SAY:** "Node, TypeScript and Express on the back, Prisma against MySQL, BullMQ on Redis for
> the queue, and React on the front. Mail goes through Nodemailer to Ethereal, so every send has
> a real preview link you can open."

---

## 0:25 – 1:20 · Compose, and the deliverability guard

**DO:** Press **`c`** *(mention the shortcut — it reads as a product someone actually uses)*.

**DO:** Fill it in, but type the **subject** deliberately badly:
`FREE CASH!!! ACT NOW — limited time`
and a body like: `CLICK HERE to claim your 100% guaranteed free money!!!`

> **SAY:** "As I type, it's scoring the email for deliverability. That's a pure function on the
> server — spam vocabulary, all-caps ratio, exclamation marks, link density. It's weighted so the
> subject line counts for more than the body."

**DO:** Let the score panel appear. Point at it.

> **SAY:** "Twenty out of a hundred, with four flags. But notice it still lets me schedule it —
> this is advisory, not a blocker. Blocking a send on a heuristic would be the wrong call."

**DO:** Now fix it — change the subject to `Quick question about your outbound stack` and the body
to something human. Watch the score jump to 100.

**DO:** Set **Send at** to about a minute out. Click **Schedule**.

> **SAY:** "It's in the Scheduled tab as queued. The row went into MySQL first, and only then did
> a delayed job go onto Redis — that ordering matters and I'll come back to it."

---

## 1:20 – 2:00 · The audit trail

**DO:** Wait for the status to flip to **Sent** *(no refresh — it polls every four seconds)*.

**DO:** Click the recipient address to open the drawer.

> **SAY:** "Every status change writes an immutable event row. So for any email I can answer 'what
> actually happened to this' — created, queued with a six hundred second delay, sending, sent, and
> the attempt number. If it had retried, every attempt would be here with its error."

**DO:** Scroll the drawer to show the timeline, then close it with **Escape**.

**DO:** Back in the table, click **Preview ↗** on that row. The real Ethereal message opens.

> **SAY:** "And that's the actual message, as the recipient would see it."

**DO:** Close that tab.

---

## 2:00 – 3:00 · Rate limiting

> **SAY:** "Now the throttling. The worker has two separate bounds. Concurrency is how many jobs
> one process runs at once — that's a local resource limit. The rate limiter is how many sends may
> start per window across *every* worker, coordinated through Redis. That's the one that models a
> provider that'll start rejecting you above a certain rate. It's set to ten sends per ten
> seconds."

**DO:** In the mailbox sidebar, click **Advance day** on both mailboxes a few times.

> **SAY:** "First I'll raise the warmup caps, so the daily limit isn't the thing we're watching."

**DO:** Switch to terminal 4 and run:

```bash
npm run burst -- --count=40
```

> **SAY:** "Forty emails, submitted at once."

**DO:** Point at the worker log as it drains.

> **SAY:** "The API accepted all forty in about three seconds. But look at the worker — they're
> going out in batches, not all at once. Forty sends takes about thirty-five to forty seconds.
> Without the limiter they'd all leave in roughly two."

**DO:** Switch to the Bull Board tab briefly — show delayed/active/completed moving.

> **SAY:** "Bull Board, mounted for local debugging, showing the same thing from the queue's side."

---

## 3:00 – 4:20 · Restart persistence — the main event

**DO:** Go back to the dashboard. Press **`c`**, schedule two emails for ~10 minutes out.

> **SAY:** "Two emails, ten minutes out. Both queued. Now I'm going to do the worst thing you can
> do to a queue."

**DO:** In terminal 4:

```bash
docker exec outbox-redis redis-cli ZCARD bull:outbox-emails:delayed
```

> **SAY:** "Two delayed jobs in Redis. Watch."

**DO:**

```bash
docker exec outbox-redis redis-cli FLUSHALL
docker exec outbox-redis redis-cli ZCARD bull:outbox-emails:delayed
```

> **SAY:** "Redis is now completely empty. Zero jobs. Under a naive implementation, those two
> emails are gone — they'd never send, and nothing would tell you."

**DO:** Go to terminal 1 (API). Press **Ctrl-C**, then `npm run dev` again.

**DO:** Point at the reconciliation line in the boot log.

> **SAY:** "On boot, before the server accepts a single request, it queries MySQL for everything
> still pending or queued and replays it back onto Redis. Two jobs re-queued."

**DO:**

```bash
docker exec outbox-redis redis-cli ZCARD bull:outbox-emails:delayed
```

> **SAY:** "Back to two. MySQL is the source of truth — Redis is just a derived index of
> outstanding work, and it can be rebuilt at any moment."

> **SAY:** "The reason this is safe to run on *every* boot is that the job ID is derived from the
> database row's primary key. So if the job is still there, re-adding it is a no-op. You never get
> duplicate sends."

**DO:** Open the drawer on one of those two emails.

> **SAY:** "And you can see it in the timeline — a second queued event, with a shorter delay,
> because the reconciler recomputed the time remaining. The recovery is visible in the product,
> not just in the logs."

> **SAY:** "One more thing here. If an email is more than twenty-four hours past due, it is *not*
> sent. It gets failed with 'missed window, flagged for manual review'. After a long outage you
> really don't want five thousand stale cold emails going out at once."

---

## 4:20 – 5:00 · Warmup, and wrap

**DO:** Point at the mailbox sidebar.

> **SAY:** "Last thing — warmup. Each mailbox has a daily cap that ramps: day one is ten sends,
> day two twenty, up to a hundred. It's enforced with a Redis counter that resets at UTC midnight,
> and the check-and-consume runs as a single Lua script so two workers can't race it. If a job is
> over its cap it re-delays itself rather than failing — being over quota is a scheduling
> condition, not an error."

> **SAY:** "New emails also round-robin across the mailboxes, which you can see in the From
> column."

> **SAY:** "There are fifty-eight tests, and they run with no containers at all — MySQL, Redis and
> SMTP are faked, so the suite runs on a clean checkout. They cover the rate limiter, the
> reconciliation policy including the exact stale threshold boundaries, and an end-to-end test that
> asserts the BullMQ job is enqueued with the correct delay."

> **SAY:** "The README covers the architecture, and there's an ASSUMPTIONS file with every
> trade-off I made — including the two places I deliberately deviated from the brief, and an
> honest list of what I verified end to end versus what I only implemented. Thanks for watching."

---

## If something goes wrong on camera

| Symptom | Do this |
| --- | --- |
| Emails stuck on `QUEUED` | The worker isn't running. Terminal 2, `npm run worker`. |
| A send fails with an SMTP error | Ethereal blipped. Say "that's the retry path" — it retries three times with backoff, and the drawer shows every attempt. Genuinely a good look. |
| Burst drains slower than expected | A mailbox hit its warmup cap. Click **Advance day**. |
| Dashboard shows a stale count | It polls every 4s; give it a beat rather than refreshing. |

## Things worth saying if you have spare seconds

- Nodemailer runs a **pooled** connection. Without pooling every message pays a full TLS and auth
  handshake — measured at ~4.4s each. Pooled, steady state is ~1.1s. Roughly 4× faster.
- The job payload carries **only an ID**, never the body — so the worker re-reads the row on every
  attempt and a cancellation is always respected.
- Between retries the row goes back to `QUEUED`, not `FAILED`. Marking it failed on attempt 1 of 3
  would be a lie the UI then has to walk back.
