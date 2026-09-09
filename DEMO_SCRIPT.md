# Demo script — TimedInk

**Target: 2:45–3:00.** Read the **SAY** lines aloud, do the **DO** lines on screen.

Recorded against `localhost`, not the deployed instance — a free-tier cold start takes ~50s and
the burst is far snappier locally. The deployed link is in the README for anyone who wants to
click it.

---

## Screen setup

Two windows, side by side:

- **Left, ~⅔** — browser at `http://localhost:5173`, signed **out**
- **Right, ~⅓** — the **worker** terminal, font size up. This is the one that matters; the
  rate-limit and send lines come out of it.

Keep a third terminal ready but off-screen for the burst and the Redis commands.

Everything is already running: MySQL and Redis in Docker, API on `:4000`, worker, Vite on `:5173`.
Ethereal is freshly provisioned, and the dashboard is empty.

---

## 0:00 – 0:15 · What it is

> **SAY:** "TimedInk is a scheduled email sender. You write an email, pick a send time in your own
> timezone, and it goes out then. The interesting part isn't the scheduling — it's what happens
> when the queue loses its memory, or the provider starts throttling you."

**DO:** Click **Sign in**. Credentials are pre-filled.

---

## 0:15 – 0:55 · Compose, and the deliverability guard

**DO:** Press **`c`**.

**DO:** To: `priya@example.com`. Subject — type it deliberately badly:

```
FREE CASH!!! ACT NOW limited time
```

Body:

```
CLICK HERE to claim your 100% guaranteed free money!!!
```

> **SAY:** "As I type it's scoring deliverability on the server — spam wording, all-caps, exclamation
> marks, link density. Twenty out of a hundred. But it still lets me schedule it: this is advisory,
> not a blocker. Blocking a send on a heuristic would be the wrong call."

**DO:** Now fix it. Subject → `Quick question about your outbound stack`, body → something human.
Watch the score jump to 100.

**DO:** Leave **Send at** as-is (two minutes out), click **Schedule**.

> **SAY:** "The row goes into MySQL first, and only then does a delayed job go onto Redis. That
> ordering is the whole design, and I'll show why in a second."

---

## 0:55 – 1:15 · The audit trail

**DO:** Wait for the status to flip to **Sent** — no refresh, it polls every four seconds.

**DO:** Click the recipient address.

> **SAY:** "Every status change writes an immutable event. So for any email I can answer what
> actually happened to it — created, queued with a delay, sending, sent. If it had retried, every
> attempt would be here with its error."

**DO:** Close with **Escape**, then click **Preview** on the row — the real Ethereal message opens.

> **SAY:** "And that's the actual email, as the recipient sees it."

**DO:** Close that tab.

---

## 1:15 – 1:50 · Rate limiting

> **SAY:** "The worker has two separate limits. Concurrency is how many jobs one process runs at
> once. The rate limiter is how many sends may start per window across every worker, coordinated
> in Redis — that's the one that models a provider that rejects you above a certain rate. It's set
> to ten per ten seconds."

**DO:** In the hidden terminal:

```bash
cd backend && npm run burst -- --count=40
```

**DO:** Point at the worker log.

> **SAY:** "Forty emails accepted in about three seconds. But they're going out in batches, not all
> at once — roughly ten every ten seconds. Without the limiter they'd all leave in about two."

**DO:** Let it run ~15 seconds. Don't wait for all forty; move on while it drains.

---

## 1:50 – 2:40 · Restart persistence — the main event

**DO:** Press **`c`**, schedule one email ten minutes out.

**DO:** In the terminal:

```bash
docker exec outbox-redis redis-cli ZCARD bull:outbox-emails:delayed
```

> **SAY:** "One delayed job in Redis. Now the worst thing you can do to a queue."

**DO:**

```bash
docker exec outbox-redis redis-cli FLUSHALL
docker exec outbox-redis redis-cli ZCARD bull:outbox-emails:delayed
```

> **SAY:** "Redis is empty. Zero jobs. In a naive implementation that email is gone — it never
> sends, and nothing tells you."

**DO:** In the API terminal, **Ctrl-C**, then `npm run dev`.

**DO:** Point at the reconciliation line.

> **SAY:** "On boot, before the server accepts a single request, it queries MySQL for everything
> still pending or queued and replays it onto Redis. One job re-queued."

**DO:**

```bash
docker exec outbox-redis redis-cli ZCARD bull:outbox-emails:delayed
```

> **SAY:** "Back to one. MySQL is the source of truth — Redis is just a derived index of
> outstanding work, and it can be rebuilt any time. And this is safe to run on every boot because
> the job ID comes from the database row's primary key, so re-adding a job that's still there is a
> no-op. You never get duplicate sends."

**DO:** Open the drawer on that email.

> **SAY:** "You can see it in the timeline — a second queued event with a shorter delay, because
> the reconciler recomputed the time remaining. The recovery shows up in the product, not just the
> logs."

---

## 2:40 – 2:55 · Close

> **SAY:** "Two things I'll mention rather than show. Warmup: each mailbox has a daily cap that
> ramps day by day, enforced with a Redis counter — a job over its cap re-delays itself instead of
> failing. And if an email is more than twenty-four hours past due on restart, it is deliberately
> *not* sent — it's flagged for manual review, because after a long outage you don't want five
> thousand stale cold emails going out at once."

> **SAY:** "Fifty-eight tests, and they run with no containers — MySQL, Redis and SMTP are all
> faked. The README has the architecture, and ASSUMPTIONS has every trade-off I made, including
> what I verified end to end versus what I only implemented. Thanks for watching."

---

## If something goes wrong on camera

| Symptom | Say / do |
| --- | --- |
| A send fails | *"That's the retry path"* — open the drawer, every attempt is listed with its error. Genuinely a good look. |
| Burst drains slowly | A mailbox hit its warmup cap. Click **Advance day** in the sidebar. |
| Stuck on `QUEUED` | The worker terminal died. Restart `npm run worker`. |
| Count looks stale | It polls every 4s — pause rather than refresh. |

## Lines worth having ready

- The job payload carries **only an ID**, never the body — so the worker re-reads the row on every
  attempt and a cancellation is always respected.
- Between retries the row goes back to `QUEUED`, not `FAILED`. Marking it failed on attempt 1 of 3
  would be a lie the UI then has to walk back.
- SMTP runs a **pooled** connection: without pooling every message pays a full TLS and auth
  handshake, measured at ~4.4s each. Pooled, steady state is ~1.1s.
