# Deploy — Agentic Trading Desk & AI Inbox (Nirvana 1.0.0)

This release adds a premium, admin-gated **Trading Desk** agent that reviews a
household's holdings and watchlist, runs a staged workflow
(Scan → Signals → Plan → Risk → Decision), and routes buy / sell / trim / hold /
new-idea recommendations to an **AI Inbox** inside Holdings for human review.
Nothing is ever traded automatically.

The feature is **off by default** for every household. The household owner turns
it on in the app (Holdings → Trading Desk → Settings), so you can charge for it
later without a code change.

---

## What's in this change

New files:

- `db/101_agentic_trading_desk.sql` — five household-scoped tables (settings,
  watchlist, agent runs, recommendations, review audit log).
- `server/services/trading-desk-engine.js` — the agentic pipeline.
- `server/services/trading-desk-service.js` — shared run/persist logic used by
  both the API and the nightly scheduler.
- `server/routes/trading-desk.js` — REST API (`/api/trading-desk/*`).
- `public/trading-desk.css`, `public/trading-desk-ui.js` — the UI.
- `tests/trading-desk-engine.test.js` — unit tests.

Modified files:

- `server/index.js` — mounts the router; version → 1.0.0.
- `server/config.js` — adds the `tradingDesk` config block.
- `server/services/agent-scheduler.js` — nightly auto-run hook.
- `public/app.html` — new "Trading Desk" tab + panel inside Holdings.
- `public/holdings-ui.js` — registers the new tab.
- `.env.example`, `env.example.txt` — new optional variables.
- `package.json` — version → 1.0.0.

No existing files are deleted and no columns are dropped. Migration `101` is
idempotent (`CREATE TABLE IF NOT EXISTS`, etc.) and safe to re-run.

---

## Local machine: push to git

From your Mac, in the repository you unzipped this into:

```bash
git add -A
git commit -m "Add agentic Trading Desk & AI Inbox (1.0.0)"
git push origin main
```

---

## Server: pull and release

Run from the app directory (adjust the path if different):

```bash
cd /opt/apps/nirvana

# 1. Pull
git pull --ff-only origin main

# 2. Install (no new dependencies were added, but this is safe)
npm install --omit=dev

# 3. Validate
node --check server/index.js
node --check server/routes/trading-desk.js
node --check server/services/trading-desk-engine.js
node --check server/services/trading-desk-service.js
npm test

# 4. Apply the database migration (idempotent; only 101 is new)
npm run db:migrate

# 5. Restart only Nirvana
pm2 restart nirvana --update-env

# 6. Health check
curl -s http://localhost:5015/api/health
```

`/api/health` should report `"version":"1.0.0"`.

> Note: the migration script is `npm run db:migrate` (defined in `package.json`).
> It applies every numbered file in `db/` that isn't already recorded in
> `schema_migrations`, so only `101_agentic_trading_desk.sql` runs this time.

---

## Configuration

The feature reuses your existing `AI_PROVIDER` / `AI_MODEL` and
`MARKET_DATA_PROVIDER` settings — no new keys are required. Two optional global
flags were added (defaults shown):

```bash
# Allow the nightly scheduler to auto-run the desk for households that have
# BOTH the feature and auto-run enabled. Set to false to make the desk
# manual-run-only across the whole install.
TRADING_DESK_SCHEDULER_ENABLED=true

# Max symbols to pull live market data for per run.
TRADING_DESK_MAX_LIVE_SYMBOLS=24
```

The nightly auto-run only fires when the global scheduler
(`AGENT_SCHEDULER_ENABLED`) is on **and** `TRADING_DESK_SCHEDULER_ENABLED` is on
**and** the household owner has enabled both the feature and "Include in nightly
auto-run" in settings.

---

## Turning it on (per household)

1. Sign in as the household owner.
2. Go to **Holdings → Trading Desk**.
3. Click **Turn on Trading Desk** (or open **Settings** to set risk profile,
   position caps, and idea count first).
4. Add any candidate tickers to the **Watchlist**, then click **Run agent**.
5. Review recommendations in the **AI Inbox** (Approve / Watch / Snooze /
   Reject). Every action is recorded in `trading_review_events`.

Non-owners see the workspace once it's enabled but cannot toggle the feature.

---

## Rollback

The feature is additive and gated off by default, so a rollback rarely needs the
database touched. To revert the code:

```bash
cd /opt/apps/nirvana
git revert <commit-sha>   # or: git reset --hard <previous-sha> && git push --force-with-lease
pm2 restart nirvana --update-env
```

The `trading_*` tables can be left in place (they're unused when the code is
absent). If you want them gone:

```sql
DROP TABLE IF EXISTS trading_review_events, trading_recommendations,
  trading_agent_runs, trading_watchlist_items, trading_desk_settings CASCADE;
DELETE FROM schema_migrations WHERE filename = '101_agentic_trading_desk.sql';
```

---

## Compliance note

Recommendations are decision-support only. The UI requires human review, never
auto-executes trades, and surfaces the configured financial disclaimer. This is
consistent with the rest of Nirvana's output framing.
