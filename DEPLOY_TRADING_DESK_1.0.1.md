# Deploy — Nirvana 1.0.1 (Trading Desk fixes + Finnhub provider)

A small patch on top of the Trading Desk 1.0 release. Two fixes and one new
capability. No new dependencies, one existing table is untouched, and there is
**no new database migration** — this is a code + config-only release.

## What changed

**1. Settings drawer could not be closed / feature could not be enabled.**
- The drawer had a CSS `display` rule that overrode the `hidden` attribute, so
  Cancel / X / Save never visually dismissed it. Fixed in `trading-desk.css`.
- The whole `/api/trading-desk` router sat behind the AI rate limiter, so once
  the limiter tripped you couldn't even open Settings to enable the feature.
  The limiter now applies only to the `/run` endpoint (the AI-heavy call).
  Browsing settings, watchlist, and the inbox is never rate-limited.

**2. New market-data provider: Finnhub, with automatic failover.**
- `server/services/market/finnhub.js` implements quote, research, news, history.
- Set `MARKET_DATA_PROVIDER=finnhub` and `FINNHUB_API_KEY=...` to use it.
- Or keep Alpha Vantage primary and set `MARKET_DATA_FALLBACK_PROVIDER=finnhub`
  so live calls automatically retry with Finnhub when Alpha Vantage is
  rate-limited, before falling back to stale cache.
- Note: Finnhub's free tier does not include historical candles (premium only).
  On the free tier the provider synthesizes a minimal price history from the
  live quote + 52-week metrics so the Trading Desk keeps working; quotes,
  fundamentals, company profile, and news all work on the free tier.

Files touched: `public/app.html` (cache-bust to v=1.0.1), `public/trading-desk.css`,
`server/index.js`, `server/config.js`, `server/routes/trading-desk.js`,
`server/services/market/index.js`, `server/services/market/finnhub.js` (new),
`.env.example`, `env.example.txt`, `package.json`, plus a new test file.

## Local machine: push

```bash
git add -A
git commit -m "Trading Desk fixes + Finnhub provider (1.0.1)"
git push origin main
```

## Server: pull and release

```bash
cd /opt/apps/nirvana
git pull --ff-only origin main
npm install --omit=dev        # no new deps; safe no-op
node --check server/index.js
npm test                      # 65 tests should pass
pm2 restart nirvana --update-env
curl -s http://localhost:5015/api/health   # expect "version":"1.0.1"
```

No `db:migrate` is required for this patch (no new SQL). Running it anyway is
harmless — every existing migration is already recorded and will be skipped.

## Configuration (optional)

Add to your server `.env` only if you want Finnhub:

```bash
# Option A — use Finnhub as the primary provider
MARKET_DATA_PROVIDER=finnhub
FINNHUB_API_KEY=your_finnhub_key

# Option B — keep Alpha Vantage primary, auto-fail-over to Finnhub on limits
MARKET_DATA_PROVIDER=alphavantage
ALPHAVANTAGE_API_KEY=your_av_key
MARKET_DATA_FALLBACK_PROVIDER=finnhub
FINNHUB_API_KEY=your_finnhub_key
```

Restart with `pm2 restart nirvana --update-env` after editing `.env`.

## Browser cache

The CSS/JS cache-bust was bumped to `v=1.0.1`, so users automatically get the
fixed Settings drawer after deploy — no manual cache clearing needed.
