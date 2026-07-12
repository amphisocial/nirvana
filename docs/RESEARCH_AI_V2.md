# Nirvana Research AI v2

## Problem corrected

The original chat router detected an uppercase ticker such as `CCJ`, but it only loaded market research when the prompt also contained trigger words such as `research`, `valuation`, or `buy/sell`. A natural prompt such as `What about CCJ?` therefore reached the model with household data but no company data.

The original household context also aggregated holdings without preserving their accounts. This allowed the model to compare all household holdings with one brokerage balance and incorrectly report a data inconsistency.

## New ticker workflow

Every detected ticker now launches the stock-market analyst and builds an evidence packet containing:

- quote and quote date
- company description and business classification
- market capitalization and available valuation ratios
- revenue, margin, growth, return, dividend, beta, moving-average, and analyst-consensus fields supplied by the configured market provider
- one year of price history
- calculated 1M, 3M, 6M, YTD, and 1Y returns
- calculated annualized volatility and maximum drawdown
- 52-week high, low, range position, and distance from the high
- recent company and sector news with source links
- a one-year chart by default, cropped to 3M, 6M, or YTD when requested
- account-level and symbol-level household holdings
- deterministic portfolio totals and reconciliation notes

## Research answer standard

The stock analyst skill requires a direct thesis, market-expectations analysis, business engine, financial pulse, catalysts, risks, valuation/entry framework, portfolio fit, and the facts that would change the view. It explicitly prohibits generic metric checklists and opening language such as `I can help you evaluate...`.

## Web research

With the OpenAI provider, set:

```env
AI_WEB_SEARCH_ENABLED=true
AI_WEB_SEARCH_CONTEXT_SIZE=medium
```

Ticker prompts can then use OpenAI web search to supplement the structured market packet. Returned web citations are exposed in the Research AI source panel. Other AI providers still receive the structured Alpha Vantage packet and Alpha Vantage News & Sentiment sources.

## Required production configuration

```env
AI_PROVIDER=openai
AI_MODEL=gpt-5-mini
OPENAI_API_KEY=...
AI_WEB_SEARCH_ENABLED=true
AI_WEB_SEARCH_CONTEXT_SIZE=medium

MARKET_DATA_PROVIDER=alphavantage
ALPHAVANTAGE_API_KEY=...
MARKET_CACHE_MINUTES=30
MARKET_RESEARCH_CACHE_MINUTES=720
MARKET_NEWS_CACHE_MINUTES=30
MARKET_NEWS_LIMIT=8
```

Do not use `MARKET_DATA_PROVIDER=mock` for user-facing investment research. Mock data is synthetic and the skill is instructed not to form a real conclusion from it.

## Deployment

No database migration and no new npm dependency are required for this update. Copy the changed files over the deployed application and restart PM2 with the updated environment:

```bash
cd /opt/apps/nirvana
pm2 restart nirvana --update-env
pm2 save
pm2 logs nirvana --lines 100
```
