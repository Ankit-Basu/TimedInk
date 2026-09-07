# Hosting TimedInk — the short version

Frontend on **Vercel**, backend on **Render**, both free. ~20 minutes.

[`DEPLOYMENT.md`](DEPLOYMENT.md) is the long version with troubleshooting. This is the
copy-paste path.

---

## First: can you skip the database?

**No.** Not for a backend that runs.

MySQL is not a cache in this app — it is the source of truth. The API executes `SELECT 1` at boot
and exits if it fails, deliberately, because every guarantee the project makes depends on it: the
restart reconciler replays from MySQL, the audit timeline lives in MySQL, cancel-vs-send is
resolved by the MySQL row. A backend without it is not a degraded backend, it is a crash loop.

The good news is the database is the *easiest* part:

| | Time | Card needed |
| --- | --- | --- |
| **Aiven MySQL** (recommended) | ~5 min, mostly waiting | No |
| Render Key Value (Redis) | ~1 min | No |

So "skip the database" saves about five minutes and costs you a working deploy. Do the five
minutes.

> **Also worth knowing:** for an SDE role, reviewers usually clone the repo and read the code —
> the deployed link is a convenience, not the artefact being judged. Your README and
> ASSUMPTIONS are accurate and detailed; that consistency is what makes the submission credible.
> If the deployed instance is asleep or the free tier is slow, say so plainly in the video. "This
> is on a free tier, so the first request takes a moment" costs you nothing. A claim that does not
> survive someone opening the repo costs you a lot.

---

## Step 1 · MySQL (5 min)

1. <https://aiven.io> → sign up → **Create service → MySQL → Free plan**.
2. Leave the auto-assigned cloud (it will pick one near you). Name it `timedink-mysql`.
   Create, wait ~4 minutes.

   **Note which region it lands in** — you want Render in the same part of the world in step 3.
   Auto-assigned *Asia Pacific* pairs with Render's **Singapore**; a US region pairs with
   **Oregon**. Split them across continents and every query pays ~200ms of round trip.
3. Copy the **Service URI** and append `?ssl-mode=REQUIRED`:

```
mysql://avnadmin:AVNS_xxx@timedink-mysql-xxx.aivencloud.com:12345/defaultdb?ssl-mode=REQUIRED
```

Save that — it is `DATABASE_URL`.

## Step 2 · Redis (1 min)

Render dashboard → **New → Key Value** → name `timedink-redis`, plan **Free**, same region you
will use next. Copy the **Internal Key Value URL** (`redis://red-xxxx:6379`).

## Step 3 · Backend on Render (5 min)

**New → Web Service** → connect `Ankit-Basu/TimedInk`.

| Field | Value |
| --- | --- |
| Root Directory | `backend` |
| Build Command | `npm ci && npx prisma generate && npm run build` |
| Start Command | `npx prisma migrate deploy && node dist/server.js` |
| Instance Type | **Free** |
| Health Check Path | `/health` |

Environment variables:

```
NODE_ENV            = production
DATABASE_URL        = <from step 1>
REDIS_URL           = <from step 2>
JWT_SECRET          = <click Generate>
WORKER_INLINE       = true
LOG_PRETTY          = false
BULL_BOARD_ENABLED  = false
```

`WORKER_INLINE=true` matters: Render's free plan has no background workers, so the queue worker
runs inside the web process. `BULL_BOARD_ENABLED=false` matters more — Bull Board has no auth.

Deploy. When it finishes, copy the URL and add two more variables, then let it redeploy:

```
APP_BASE_URL = https://timedink-api.onrender.com     ← your actual URL
CORS_ORIGIN  = https://timedink.vercel.app           ← fill in after step 4
```

Then seed the demo user from your machine (free tier has no shell):

```bash
cd backend
DATABASE_URL="<your Aiven URI>" npm run seed
```

## Step 4 · Frontend on Vercel (3 min)

1. <https://vercel.com> → **Add New → Project** → import the same repo.
2. **Root Directory: `frontend`**. Leave everything else — `frontend/vercel.json` handles it.
3. Add one environment variable:

```
VITE_API_BASE_URL = https://timedink-api.onrender.com
```

4. Deploy. Copy the resulting URL back into Render's `CORS_ORIGIN` (step 3).

Vite inlines `VITE_*` at **build** time, so changing it later needs a redeploy, not a restart.

## Step 5 · Keep it awake (2 min)

A free Render service sleeps after ~15 minutes, and a sleeping scheduler sends nothing.

<https://cron-job.org> → new job → `https://timedink-api.onrender.com/health` every **10 minutes**.

The boot reconciler means nothing is *lost* while asleep — the backlog replays on wake — but it
arrives late. The ping avoids that entirely.

---

## Verify

```bash
curl https://timedink-api.onrender.com/health
```

Then open the Vercel URL and sign in with `demo@timedink.dev` / `demo1234`.

- [ ] Login works with no CORS error in the console
- [ ] A scheduled email reaches **Sent** and its preview link opens
- [ ] `/admin/queues` returns **404**
- [ ] Render logs show `reconciliation complete` on restart

---

## Record the demo locally, not against this

Cold starts take ~50 seconds. A rate-limiting demo is not compelling when the service just spent
a minute waking up, and the burst script is far snappier against localhost. Deploy because a live
link is a nice thing to include — record the video on your machine.

Also switch `SMTP_*` back to Ethereal before recording. Gmail rewrites the `From` header and has
send limits that can bite mid-take.
