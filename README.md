# NIRVANA — the AI investment firm

An investment firm **run entirely by AI**. Five agent "employees" research, debate,
backtest and risk-check US equities, then build a portfolio around one number: yours.
Built with Next.js 14 (App Router), TypeScript, Tailwind, Recharts and the Anthropic SDK.

> Educational tool only. Not investment, tax, or legal advice.

## What it does

- **Build a portfolio** — an adaptive intake interview (questions branch on your answers,
  the way a real analyst probes) → the whole firm runs → a diversified NASDAQ/NYSE book with
  dollar amounts, share counts, an allocation donut, and a 5-year backtest vs the S&P 500.
- **Talk to one analyst at a time** — pick an employee, drop in a ticker, run *their* analysis
  on that single name, or just chat with them.
- **Save & follow** — save any recommendation and the operations analyst (Leo) re-prices it on
  demand, reporting total gain/loss from the day-one base value.
- **Homepage** — the night desk's daily "Analyst of the Day" post, top 3 headlines, and the
  day's top 5 gainers/losers.
- **About Us** — the five agents presented as a human leadership team.
- **Admin** — the only human in the loop; toggles + a manual nightly trigger.

## The five agents (+ ops)

| Agent | Employee | Job |
|------|----------|-----|
| `researcher` | Dr. Maya Chen | Thesis, catalysts, growth tier (high/med/low) |
| `risk` | Marcus Reed | Volatility, beta, drawdown, risk tier |
| `debater` | Sofia Alvarez | Bull vs bear, net conviction |
| `tester` | Ethan Brooks | Backtest vs S&P 500 |
| `optimizer` | Priya Nair | Weights, dollars, share counts |
| `updater` (ops) | Leo Whitfield | On-demand gain/loss refresh |

## Runs with zero keys

Out of the box it uses a **deterministic mock market feed** and a **rule-based "simulated analyst"
engine**, so everything works offline. Add keys to go live — the LLM handles judgment and
narrative, while all numbers (volatility, drawdown, Sharpe, share counts) are always computed in
code so they're never hallucinated.

## Setup

```bash
npm install
cp .env.example .env.local     # optional — app runs without it
npm run seed:blog              # optional — seeds a few homepage posts
npm run dev                    # http://localhost:3000
```

### Going live (all optional)

```
# Agents (pick one provider; AI_MODEL must match it)
AI_PROVIDER=anthropic          # anthropic | openai | gemini | mock
AI_MODEL=claude-sonnet-4-6     # openai -> gpt-4o-mini, gemini -> gemini-1.5-flash
ANTHROPIC_API_KEY=...          # or OPENAI_API_KEY / GEMINI_API_KEY
MARKET_DATA_PROVIDER=finnhub
FINNHUB_API_KEY=...            # live quotes + news (free tier)
MARKET_LISTING=both            # nasdaq | nyse | both
NIGHTLY_ENABLED=true           # admin toggle for the nightly blog run
CRON_SECRET=...                # protects POST /api/cron/nightly
```

Schedule the nightly post from any scheduler:

```
POST /api/cron/nightly
Authorization: Bearer <CRON_SECRET>
```


## Google Sign-In (gating Save)

Browsing, building a portfolio, and running the agents are all open. **Saving**
a recommendation requires signing in with Google — that's how the app remembers
you and ties saved portfolios to your account.

Set up once:

1. Google Cloud Console → APIs & Services → Credentials → create an OAuth 2.0
   Client ID (type: Web application).
2. Add an authorized redirect URI: `<NEXTAUTH_URL>/api/auth/callback/google`
   (e.g. `https://nirvana.athenabot.ai/api/auth/callback/google`).
3. Put the values in `.env.local`:

```
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
NEXTAUTH_URL=https://your-domain            # public URL, no trailing slash
NEXTAUTH_SECRET=...                          # openssl rand -base64 32
```

Sessions are JWT cookies (no extra DB tables), so sign-in persists across
restarts as long as `NEXTAUTH_SECRET` stays the same. Saved portfolios are
stored with the owner's email and appear under **My portfolios**.


## What "real" requires (honest note)

Out of the box the app runs a **deterministic simulation** — instant, offline,
and limited to a built-in list of names. That's a scaffold, not the product.
For genuine research it behaves very differently once configured:

- **A model provider** (`AI_PROVIDER` + key + matching `AI_MODEL`) makes the
  agents actually reason. Stages then take real seconds and the desk feed streams
  each analyst's output as it lands — no fake progress.
- **A market data provider** (`MARKET_DATA_PROVIDER=finnhub` + key) lets the desk
  resolve **any** US-listed ticker (not just the built-in list) with live
  fundamentals, quotes, and news.

Honest limits even when fully live: the desk screens a candidate set and then
deep-dives it — it does not scan all ~6,000 US tickers on every request, because
free data tiers rate-limit that. Broadening to a full live screen needs a paid
market-data feed. And backtests are hypothetical; past results never guarantee
future ones.

## Architecture

```
src/lib/agents/       personas, prompts, orchestrator (the firm), updater
src/lib/market/       provider facade, finnhub, deterministic mock, universe, analytics
src/lib/store.ts      file-based JSON store (data/*.json) — swap for a DB in prod
src/app/api/          portfolio, agents, market, cron routes
src/components/       Wizard, AgentConsole, PortfolioView, Charts, Avatars, ...
```

Data persists to `data/portfolios.json` and `data/blog.json`. For multi-instance
deploys, replace `src/lib/store.ts` with Postgres/Redis — the interface is tiny.

## Phase 2 (designed for, not yet built)

Each persona's `focus` (skills) and `method` (steps) are hardcoded from desk best-practice.
The types and prompt builder are structured so a per-user override — appended to an agent's
system prompt and saved per account — drops in without touching the orchestrator.
