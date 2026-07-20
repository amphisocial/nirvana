# Deploy — Nirvana 1.1.1 (scheduler crash fix + Finnhub history + scoped-run results)

Code-only patch. **No database migration.** Three fixes.

## What changed

**1. Scheduler crash: `RangeError: Invalid time value`.**
The nightly agent could crash in `refreshLargeExpenseAlerts` when a high-value
expense had an unparseable `start_date`: `dateOnly()` called `.toISOString()` on
an Invalid Date and threw, aborting the household's nightly run. `dateOnly()` and
`startOfWeek()` now return `null` for invalid input instead of throwing, and the
expense loop ignores unparseable start dates. (This bug is independent of the
market provider — the FINNHUB timing was coincidental.)

**2. Finnhub history now works on the free tier.**
Finnhub's date-range candle requests can return no data / 403 on some free
accounts. The provider now tries the `count`-based candle request first
(`/stock/candle?symbol=…&resolution=D&count=N`), which is the reliable free-tier
form, then falls back to a from/to range, then to a synthesized series. With real
candles the agent gets real momentum/trend/volatility signals instead of the flat
signals a 2-point synthesized series produced.

**3. Scoped runs always return a result for the symbols you asked about.**
Previously, analyzing a single new symbol (e.g. `NFLX`) could yield "0
recommendations" because a weak discovery idea gets gated out by the conviction
floor. Now any symbol you explicitly enter in "analyze specific symbols" always
produces a memo (even a low-conviction hold/pass), so you always see the
analysis you requested. Whole-book "Run all" behavior is unchanged — weak
discovery ideas are still filtered there.

Files: `server/services/agent-financial-center.js`,
`server/services/market/finnhub.js`, `server/services/trading-desk-engine.js`,
`server/services/trading-desk-service.js`, `public/app.html` (cache-bust),
`server/index.js`, `package.json`, plus new tests. No new npm dependencies.

## Local machine: push

```bash
git add -A
git commit -m "Fix scheduler date crash, Finnhub free-tier history, scoped-run results (1.1.1)"
git push origin main
```

## Server: pull and release

```bash
cd /opt/apps/nirvana
git pull --ff-only origin main
npm install --omit=dev          # no new deps
node --check server/index.js
npm test                        # 73 tests should pass
pm2 restart nirvana --update-env
curl -s http://localhost:5015/api/health   # expect "version":"1.1.1"
```

No `npm run db:migrate` needed (no new SQL). Running it is harmless.

## Notes

- If `package-lock.json` blocks the pull: `git checkout -- package-lock.json`
  then pull. To stop it recurring: `git update-index --skip-worktree package-lock.json`.
- CSS/JS cache-bust bumped to `v=1.1.1`.
- For fewer rate-limit surprises, consider Finnhub as the *primary* provider
  (`MARKET_DATA_PROVIDER=finnhub`, 60 req/min vs Alpha Vantage's 5/min); the
  count-based candle fetch means the agent gets real history on the free tier.
