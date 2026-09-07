# Deploying TimedInk for free

Backend on **Render**, frontend on **Vercel**, MySQL on **Aiven**, Redis on **Render Key Value**.
All four have genuine free tiers — no card required for Vercel or Aiven; Render asks for one but
does not charge on the free plan.

Budget about **35 minutes** end to end, most of it waiting on the Aiven database to provision.

---

## Read this first — the free-tier catch

A Render free web service **sleeps after ~15 minutes without traffic**, and a sleeping process
sends nothing. A scheduler that sleeps is a contradiction, so you have to deal with it.

Two things make it survivable:

1. **The boot reconciler.** When the service wakes, it replays every `PENDING`/`QUEUED` row from
   MySQL back onto the queue before accepting traffic. Nothing is lost — anything whose moment
   passed while asleep goes out on wake, as long as it is inside
   `STALE_CATCHUP_THRESHOLD_MINUTES`. This is the same mechanism that survives a wiped Redis, and
   it is why free hosting is viable at all.
2. **A keep-alive ping** ([step 6](#6--keep-the-service-awake)) — free, and removes the problem
   entirely.

Set `STALE_CATCHUP_THRESHOLD_MINUTES` generously in production (the 1440 default is fine): on a
sleepy free instance you *want* the catch-up window to be wide.

> **Don't demo on free hosting.** Record the video locally. Cold starts take ~50s, and a rate
> limiter is not compelling when the whole service just took a minute to boot. Deploy it because a
> live link is nice to include, not because it is the better demo.

---

## Architecture once deployed

```
   Vercel (static)              Render (one free web service)
  ┌──────────────┐   HTTPS    ┌──────────────────────────────┐
  │  React SPA   │ ─────────▶ │  Express API                 │
  │              │            │  + BullMQ worker (inline)    │
  └──────────────┘            │  + follow-up sweeper         │
                              └───────┬──────────────┬───────┘
                                      │              │
                              ┌───────▼──────┐  ┌────▼─────────┐
                              │ Aiven MySQL  │  │ Render       │
                              │ (free)       │  │ Key Value    │
                              └──────────────┘  └──────────────┘
```

The API and worker share a process here (`WORKER_INLINE=true`) because Render's free plan has no
background workers. It is a real trade-off — a slow SMTP send now adds latency to HTTP requests —
and it is the one thing you would change first on a paid plan. Nothing else about the topology
differs from local.

---

## 1 · MySQL on Aiven

Render has no MySQL, so the database comes from elsewhere. Aiven's free plan gives 1 CPU / 1 GB
RAM / 1 GB storage — far more than this needs, which stores a few KB per email.

1. Sign up at **<https://aiven.io>** (no card on the free plan).
2. **Create service → MySQL**.
3. Pick the **Free** plan. Aiven auto-assigns a cloud near you; whatever it picks, put Render in
   the same part of the world in step 3 — *Asia Pacific* pairs with Render's **Singapore**, a US
   region with **Oregon**. Split across continents and every query pays ~200ms of round trip,
   which is felt on every dashboard poll.
4. Name it `timedink-mysql`. Create, then wait — provisioning takes 3–5 minutes.
5. When it goes green, open the service and copy the **Service URI**. It looks like:

   ```
   mysql://avnadmin:AVNS_xxxxxxxx@timedink-mysql-yourproject.a.aivencloud.com:12345/defaultdb
   ```

6. Aiven requires TLS. Append the SSL parameter Prisma expects:

   ```
   ?ssl-mode=REQUIRED
   ```

   So the value you will paste into Render is:

   ```
   mysql://avnadmin:AVNS_xxx@host.aivencloud.com:12345/defaultdb?ssl-mode=REQUIRED
   ```

Keep this to hand — it becomes `DATABASE_URL`.

> **Alternatives if Aiven does not suit:** Clever Cloud (free MySQL, 10 MB — tight but workable
> for a demo), or TiDB Cloud Serverless (MySQL-compatible, 5 GB free). Any MySQL 8 connection
> string works; nothing in the app is provider-specific.

---

## 2 · Redis on Render

1. In the Render dashboard: **New → Key Value** (older accounts call it Redis).
2. Name `timedink-redis`, region **the same as your web service**, plan **Free**.
3. Under **Access Control**, leave the internal-only default. The API reaches it over Render's
   private network.
4. Create it, then copy the **Internal Key Value URL** (`redis://red-xxxxx:6379`).

> The free plan has **no persistence** — a restart empties it. This app is fine with that: MySQL
> is the source of truth and the reconciler rebuilds the queue on every boot. That is not a
> rationalisation, it is the same property the `FLUSHALL` test in the README exercises.

---

## 3 · The API on Render

**New → Web Service → Build and deploy from a Git repository**, pick `Ankit-Basu/TimedInk`.

| Setting | Value |
| --- | --- |
| Name | `timedink-api` |
| Region | **match your Aiven region** (Asia Pacific → Singapore, US → Oregon) |
| Branch | `main` |
| Root Directory | `backend` |
| Runtime | Node |
| Build Command | `npm ci && npx prisma generate && npm run build` |
| Start Command | `npx prisma migrate deploy && node dist/server.js` |
| Instance Type | **Free** |
| Health Check Path | `/health` |

Two details that matter:

- `prisma generate` must run **before** `npm run build`, because the TypeScript build imports the
  generated client.
- `prisma migrate deploy` runs at **start**, not build — Render's build step has no database
  access. It is idempotent, so running it on every boot is safe.

### Environment variables

Add these under **Environment**:

| Key | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `DATABASE_URL` | the Aiven URI from step 1 |
| `REDIS_URL` | the internal Key Value URL from step 2 |
| `JWT_SECRET` | click **Generate** — must be ≥ 16 chars |
| `WORKER_INLINE` | `true` |
| `LOG_PRETTY` | `false` |
| `BULL_BOARD_ENABLED` | `false` |
| `APP_BASE_URL` | `https://timedink-api.onrender.com` *(fill in after the first deploy)* |
| `CORS_ORIGIN` | your Vercel URL — set this in [step 5](#5--connect-the-two) |
| `ETHEREAL_USER` / `ETHEREAL_PASS` | leave **blank** on the first deploy |

**`BULL_BOARD_ENABLED=false` is not optional.** Bull Board has no authentication — it would let
anyone on the internet read job payloads and delete jobs.

**`APP_BASE_URL`** is what tracking-pixel URLs are built from, so it must be the public Render URL
or open tracking silently breaks. You will not know it until the first deploy finishes; set it
then and let it redeploy.

### First deploy

Click **Create Web Service**. The first build takes 3–5 minutes. Watch the logs for:

```
starting TimedInk API
database connection ok
reconciliation complete: 0 job(s) re-queued, 0 flagged stale, ...
mode: "inline (shares the API process)"
API listening on ...
worker ready and listening for jobs
```

Then pin the Ethereal credentials it logged (`ETHEREAL_USER` / `ETHEREAL_PASS`) into the
environment, so restarts keep one inbox instead of orphaning old preview links.

### Seed the demo user

Render's free plan has no shell. Run the seed from your machine against the hosted database:

```bash
cd backend
DATABASE_URL="<your Aiven URI>" npm run seed
```

---

## 4 · The frontend on Vercel

1. **<https://vercel.com>** → **Add New → Project** → import `Ankit-Basu/TimedInk`.
2. Vercel will detect Vite. Set **Root Directory** to `frontend`.
3. Leave build command and output directory alone — `frontend/vercel.json` already declares them,
   along with the SPA fallback that stops `/dashboard` 404ing on a hard refresh.
4. Add one **Environment Variable**:

   | Key | Value |
   | --- | --- |
   | `VITE_API_BASE_URL` | `https://timedink-api.onrender.com` |

   Vite inlines this at **build** time, so changing it later needs a redeploy, not just a restart.

5. **Deploy.**

---

## 5 · Connect the two

Back in Render, set `CORS_ORIGIN` to your Vercel domain — no trailing slash, comma-separate if you
want preview deployments too:

```
https://timed-ink.vercel.app
```

Save; Render redeploys. Auth is a bearer token rather than a cookie, so there is no `SameSite` or
credentialed-CORS complication — the origin allowlist is the whole of it.

<details>
<summary><b>Alternative: proxy through Vercel and skip CORS entirely</b></summary>

Instead of `VITE_API_BASE_URL`, add a rewrite to `frontend/vercel.json` **above** the SPA
fallback:

```json
{
  "source": "/api/:path*",
  "destination": "https://timedink-api.onrender.com/api/:path*"
}
```

Leave `VITE_API_BASE_URL` unset and the browser stays same-origin, exactly as it does behind the
Vite dev proxy locally. Costs an extra network hop; buys you no CORS configuration at all.
</details>

---

## 6 · Keep the service awake

Without this, emails scheduled while the instance sleeps are delivered late — on wake — rather
than on time.

1. Go to **<https://cron-job.org>** (free) or UptimeRobot.
2. Create a job hitting `https://timedink-api.onrender.com/health` every **10 minutes**.
3. Render's sleep timer is ~15 minutes of no traffic, so a 10-minute ping keeps it up permanently.

`/health` is deliberately excluded from request logging, so this will not fill your log with noise.

> Free instance hours are capped (750/month across the account), which one always-on service fits
> inside. Two always-on free services would not.

---

## 7 · Verify the deployment

```bash
# 1 — health
curl https://timedink-api.onrender.com/health

# 2 — auth against the hosted database
curl -s -X POST https://timedink-api.onrender.com/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"demo@timedink.dev","password":"demo1234"}'
```

Then open the Vercel URL, sign in, and schedule something a minute out. Watch the Render log for
`email sent`, and open the preview link from the Sent tab.

**Checklist:**

- [ ] `/health` returns `{"status":"ok"}`
- [ ] Login works from the Vercel domain (no CORS error in the browser console)
- [ ] A scheduled email reaches `SENT` and its preview link opens
- [ ] The detail drawer shows the event timeline
- [ ] `/admin/queues` returns **404** — proof Bull Board is disabled
- [ ] Render logs show `reconciliation complete` on every restart

---

## Production settings that differ from local

| Variable | Local | Deployed | Why |
| --- | --- | --- | --- |
| `WORKER_INLINE` | `false` | `true` | Free tier has one process |
| `BULL_BOARD_ENABLED` | `true` | `false` | Unauthenticated admin surface |
| `LOG_PRETTY` | `true` | `false` | JSON logs for the platform's aggregator |
| `NODE_ENV` | `development` | `production` | Stack traces stop being returned to clients |
| `APP_BASE_URL` | `localhost:4000` | Render URL | Tracking pixels must be publicly reachable |

---

## Troubleshooting

**Build fails on `@prisma/client did not initialize yet`.** `prisma generate` is missing from the
build command, or runs after `npm run build`.

**`P1001: Can't reach database server`.** The Aiven URI is missing `?ssl-mode=REQUIRED`, or the
service is still provisioning.

**Login works with curl but fails in the browser.** `CORS_ORIGIN` does not exactly match the
Vercel origin. It is compared literally — scheme included, trailing slash excluded.

**Emails sit at `QUEUED` and never send.** `WORKER_INLINE` is not `true`, so nothing is draining
the queue. Check the boot log for `worker ready and listening for jobs`.

**First request after a quiet period takes ~50 seconds.** That is the cold start. Step 6 fixes it.

**Emails scheduled overnight all arrive at once in the morning.** The instance slept and the
reconciler caught up on wake — working as designed. Step 6 is the fix.

**Open tracking never records.** `APP_BASE_URL` still points at `localhost`, so the pixel URL is
unreachable from a mail client.
