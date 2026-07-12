# Nirvana 0.6.0 — What-If Lab

## Purpose

The What-If page now supports temporary household and stock-portfolio scenarios without updating any saved balances, account settings, debt records, income, expenses, contribution schedules, or forecasts.

## Household plan scenarios

The AI-assisted prompt accepts requests such as:

- use a brokerage account at age 57 to pay off a mortgage
- pay off a home-equity loan and car loan from stocks at a chosen age
- pay off all debt from a selected investment account
- apply staged stock-return assumptions, such as 20% for two years, 2% for years three and four, and 6% thereafter

Each run produces:

- income versus baseline and scenario expenses
- baseline versus scenario net worth
- debt balance versus stock-account value
- modeled debt payoff amount
- monthly expense reduction
- net-worth impact at retirement and at the end of the plan
- warnings when the selected funding account cannot fully cover the payoff

529-funded expenses can be included or excluded from the What-If cash-flow chart. This display choice does not change the underlying scenario calculations.

## Stock portfolio scenarios

The Stock Portfolio tab shows:

- total saved brokerage-account value
- saved symbol-level holdings and weights
- an AI-assisted portfolio prompt
- baseline versus scenario stock-account value
- resulting household net-worth impact
- the existing single-trade target-price calculator in a separate section

Users can return to Accounts to break a manually entered brokerage total into saved stock symbols.

## Non-persistence boundary

The new `/api/what-if` endpoints perform read-only database queries. Scenario assumptions and calculated timelines exist only in the current request and browser session. No scenario rows, account balances, liabilities, expenses, income streams, holdings, or retirement settings are written.

## Deployment

This release adds new modular files and performs two narrow integration edits:

- replaces the existing `scenario` section in `public/app.html`
- registers `whatIfRouter` in `server/index.js`

There is no database migration and no new npm dependency.
