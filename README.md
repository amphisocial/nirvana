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
ANTHROPIC_API_KEY=...          # agents reason with Claude instead of the sim engine
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
