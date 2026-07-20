# Deploy — Nirvana 1.1.0 (Trading Desk: per-symbol charts + scoped runs)

Two new capabilities on the Trading Desk. **This release includes a database
migration** (`102_trading_desk_charts.sql`), so `npm run db:migrate` is required.

## What's new

**1. Click a symbol to see charts + the full trade plan.**
- Every recommendation now stores a 1-year price snapshot and an analytics
  snapshot when the agent runs.
- Clicking a symbol (or "View charts & plan") opens a detail drawer with an SVG
  price chart showing the price line plus entry-zone band, target, stop, and
  "now" overlays, a signal-strength bar chart, a key-metrics grid (volatility,
  drawdown, beta, 52-week range, returns, momentum), the trade-plan table, and
  the thesis. Approve / Reject / Re-analyze are available right in the drawer.
- New endpoint: `GET /api/trading-desk/chart/:id`. If a recommendation predates
  this release (no stored snapshot), the endpoint fetches live history on open.

**2. Run the agent for one symbol or an ad-hoc set — not the whole book.**
- The console has a "Run these" row: type e.g. `AAPL, NVDA, LULU` to analyze
  only those. Each card also has a "↻ Re-analyze" button.
- Scoped runs still use the full portfolio for risk/concentration context, but
  only evaluate the requested symbols. Symbols you don't own / aren't watching
  are treated as fresh discovery ideas.
- Re-running a symbol supersedes its previous still-pending recommendation, so
  the inbox never accumulates duplicate pending memos (reviewed memos are kept
  as history). This uses a new `superseded` review status.

Files: `db/102_trading_desk_charts.sql` (new), `server/routes/trading-desk.js`,
`server/services/trading-desk-service.js`, `server/services/trading-desk-engine.js`,
`public/app.html`, `public/trading-desk.css`, `public/trading-desk-ui.js`,
`server/index.js`, `package.json`, plus a new test file.
No new npm dependencies.

## Local machine: push

```bash
git add -A
git commit -m "Trading Desk: per-symbol charts + scoped runs (1.1.0)"
git push origin main
```

## Server: pull, migrate, release

```bash
cd /opt/apps/nirvana
git pull --ff-only origin main
npm install --omit=dev          # no new deps; safe
node --check server/index.js
npm test                        # 68 tests should pass
npm run db:migrate              # applies 102 only; earlier migrations are skipped
pm2 restart nirvana --update-env
curl -s http://localhost:5015/api/health   # expect "version":"1.1.0"
```

## Notes

- **Existing recommendations** created before this upgrade have no stored chart
  snapshot; their charts fall back to a live market fetch on first open. New
  runs store the snapshot inline.
- The CSS/JS cache-bust was bumped to `v=1.1.0`, so users get the new UI right
  after deploy without clearing their browser cache.
- If `package-lock.json` blocks the pull (from a prior server `npm install`),
  run `git checkout -- package-lock.json` first, then pull. To avoid it
  recurring: `git update-index --skip-worktree package-lock.json`.
