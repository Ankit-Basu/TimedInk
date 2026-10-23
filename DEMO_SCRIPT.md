# Demo Video Script — TimedInk (ReachInbox Assignment)

**Target Duration: 3:00 – 3:30.**
Read the **SAY** lines aloud with confidence; perform the **DO** lines on screen.

> **Pro-Tip**: Record locally against `localhost:5173` rather than free-tier hosting for lightning-fast UI responsiveness, zero cold-start lag, and snappy terminal logs. The deployed links are provided in the README for the judges to explore live.

---

## 🎬 Screen & Environment Setup

Two windows side by side:
- **Left (60–65% width)**: Chrome browser open at `http://localhost:5173` (starting on the landing page, signed out).
- **Right (35–40% width)**: Terminal with clear, readable font showing the **worker** process (`npm run worker`), with a second tab/split ready for Redis commands and the burst script.

**Prerequisites before pressing Record**:
- [x] Redis is running (`docker compose up -d` or local Redis)
- [x] Backend API running on `:4000` (`npm run dev`)
- [x] Worker running (`npm run worker`)
- [x] Frontend running on `:5173` (`npm run dev`)
- [x] Demo user seeded (`demo@timedink.dev` / `demo1234`)

---

## ⏱️ Timeline & Script

### 0:00 – 0:30 · Introduction & Core Guarantees
**DO**: Start on the landing page (`http://localhost:5173`). Scroll gently past the hero and point to the "How it works" pipeline.

> **SAY**:
> *"Hi everyone! This is TimedInk, built for the ReachInbox Full-Stack Email Scheduler assignment.
> When scheduling cold outreach at scale, the real challenge isn't just setting a timer—it's reliability under pressure:
> Surviving process crashes, avoiding double-sends, respecting strict provider rate limits, and maintaining an immutable audit trail.
> Let's sign in and see how the system guarantees this."*

**DO**: Click **Sign in** in the navbar or hero. The centered glassmorphic dialog opens with pre-filled demo credentials (`demo@timedink.dev` / `demo1234`). Click **Sign in →** to enter the Dashboard.

---

### 0:30 – 1:15 · Dashboard & Live Compose with Spam Scoring
**DO**: Briefly pan across the Dashboard: point to the active throughput ring, warmup progress, and email status tabs.

> **SAY**:
> *"Here in the dashboard, we have real-time queue metrics, hourly send throughput, and mailbox warmup limits.
> Let's compose an email by pressing 'c' or clicking 'Schedule email'."*

**DO**: Press **`c`** to open the Compose modal.
- Set **To**: `alex@example.com`
- Set **Subject**: `FREE CASH!!! ACT NOW limited time`
- Set **Body**: `CLICK HERE to claim your 100% guaranteed free money!!!`
- Point to the live Deliverability Gauge dropping to 20/100 with spam warning flags.

> **SAY**:
> *"As I type, our heuristic deliverability engine analyzes the draft in real time—checking spam keywords, excessive caps, and link ratios. It gives it a 20 out of 100 with actionable warnings. But notice it doesn't block the send: this is advisory intelligence for the SDR, not a rigid blocker."*

**DO**: Replace with clean copy:
- **Subject**: `Quick question regarding your outbound infrastructure`
- **Body**: `Hi Alex,\n\nNoticed ReachInbox is expanding the SDR team. Would love to share how our delayed scheduler handles high-throughput cold email.\n\nBest,\nAva`
- Watch the score jump to **100/100**.
- Leave **Send at** set to 1–2 minutes in the future, select a mailbox, and click **Schedule email**.

> **SAY**:
> *"The email is saved to the database first as the durable record of intent, and only then is a delayed BullMQ job placed on Redis with a deterministic ID. Let's look at the audit trail."*

---

### 1:15 – 1:45 · Delivery, Real Ethereal Preview & Immutable Audit Trail
**DO**: Wait a few seconds for the scheduled moment (or check a row that transitions to `SENT`).
- Point out the status updating to **Sent** without a manual page refresh (live 4s polling).
- Click the **Preview** button on the row to open the real rendered Ethereal email in a new tab.

> **SAY**:
> *"Every send goes over genuine pooled SMTP to Ethereal. Clicking Preview opens the real rendered message exactly as the prospect would see it in their inbox, complete with our invisible tracking pixel."*

**DO**: Close the preview tab and click on the recipient's row to open the **Detail Drawer**.

> **SAY**:
> *"Every state transition writes an immutable event. In this audit drawer, we see exactly when the email was created, queued with its initial delay, handed to the worker, and delivered. If it had failed, every retry attempt and error reason would be recorded here."*

**DO**: Press **Escape** to close the drawer.

---

### 1:45 – 2:25 · Rate Limiting & Burst Ingestion
**DO**: Open the terminal window next to the browser.
- Point to the worker logs.

> **SAY**:
> *"Email providers will throttle or blacklist you if you burst emails too quickly. We enforce a two-tier limiter: worker-level concurrency, plus an atomic Redis rate-limiter shared across all workers. It is configured to a strict ceiling of 10 sends per 10 seconds."*

**DO**: Run the burst script in the terminal:
```bash
cd backend && npm run burst -- --count=40
```
- Watch the API accept 40 emails in under 3 seconds.
- Watch the worker terminal: emails drain out in controlled, metered batches of 10 every 10 seconds.
- In the dashboard, click the **Pending / Queued** tab to show the remaining batch smoothly draining.

> **SAY**:
> *"Notice that all 40 emails were accepted in under 3 seconds by the API, but the worker releases them in metered batches of 10 every 10 seconds. Without this limiter, a burst of 40 would fire all at once and trigger provider bans."*

---

### 2:25 – 3:00 · The Acid Test: Surviving a Wiped Redis (`FLUSHALL`)
**DO**: Click **Schedule email**, set an email 10 minutes into the future.
- In terminal, inspect the Redis delayed zset:
```bash
docker exec outbox-redis redis-cli ZCARD bull:outbox-emails:delayed
```
*(Outputs `1`)*

> **SAY**:
> *"Now for the ultimate test: What happens if Redis completely crashes or the cache is wiped?"*

**DO**: Wipe Redis completely:
```bash
docker exec outbox-redis redis-cli FLUSHALL
docker exec outbox-redis redis-cli ZCARD bull:outbox-emails:delayed
```
*(Outputs `0`)*

> **SAY**:
> *"Redis is completely empty—zero jobs. In a naive implementation, that scheduled email is lost forever.
> Now watch what happens when our API restarts."*

**DO**: In the API terminal, press **Ctrl+C**, then run `npm run dev`.
- Point at the terminal output:
```text
[INFO]: database connection ok
[INFO]: reconciliation complete: 1 job(s) re-queued in 6ms
```
- Run the Redis check again:
```bash
docker exec outbox-redis redis-cli ZCARD bull:outbox-emails:delayed
```
*(Outputs `1`)*

> **SAY**:
> *"On boot, before accepting any HTTP traffic, the boot reconciler queries the database for all pending and queued emails, recomputes their remaining time, and re-enqueues them with deterministic IDs.
> The delayed job is restored to 1. And because job IDs are deterministic, replaying is completely idempotent—it will never double-send!"*

---

### 3:00 – 3:30 · Architecture, Testing & Wrap-Up
**DO**: Briefly switch back to the dashboard or terminal running `npm test`.

> **SAY**:
> *"A few additional architectural highlights:
> 1. Bulk CSV scheduling: Drop a CSV file, parse and deduplicate client-side, with configurable delay spacing and hourly batch limits.
> 2. Mailbox warmup & rotation: Daily sending ramps up automatically day by day, distributing volume evenly across sender mailboxes.
> 3. Zero-config deployment: Powered by embedded SQLite or MySQL, deployed live on Vercel and Render.
> 4. Test coverage: 73 unit and integration tests passing completely hermetically without requiring external containers.
>
> The code, documentation, and live links are available in the repository. Thank you for watching!"*

---

## 🆘 Quick Troubleshooting During Recording

| Situation | Action |
| --- | --- |
| Email stays in `QUEUED` | Ensure `npm run worker` is active in your terminal. |
| Burst stops midway | Mailbox hit daily warmup quota. Click **Advance day** in the sidebar. |
| Test suite command | Run `npm test` in `backend` directory (takes ~3s for all 73 tests). |
