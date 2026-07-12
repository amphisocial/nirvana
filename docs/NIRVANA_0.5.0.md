# Nirvana 0.5.0 — Scheduled Contributions and Future Account Uses

## Purpose

Point-in-time balances are not enough for a useful lifetime forecast. Nirvana 0.5.0 adds scheduled cash flows that change specific account balances over time.

## Planned contributions

Users can save recurring contributions to a 529, IRA, 401(k), retirement account, brokerage account, or HSA with:

- amount and frequency
- start and end date
- annual contribution increase
- target account
- source account for transfers
- external contribution or employer-match designation
- edit and delete actions

Transfers between two owned accounts are net-worth neutral: the source account decreases and the target account increases. External and employer contributions are new household inflows and increase net worth.

## Future income and expenses

Income and expense schedules now support actual start and end dates in addition to optional ages. A future college expense can be linked to a 529 account and configured to:

- use the 529 first, then other liquid assets; or
- use only the 529 and surface any remaining amount as a funding deficit.

This lets the 529 grow before college, receive scheduled contributions, and decline when tuition payments begin.

## Forecast integration

Scheduled contributions are incorporated into:

- household net-worth projections
- inflow, outflow, net-cash-flow, and contribution trends
- account-level Monte Carlo forecasts
- retirement projections for external and employer contributions to retirement-capable accounts

A 529 remains separate from retirement funding. Education expenses paid from a 529 are excluded from the retirement-spending pool so they are not double-counted.

## 529 and fund-based forecasts

The account forecast workbench now supports 529 accounts. A 529, 401(k), or other fund-based account can run a forecast without individual stock holdings by using its saved expected return and volatility. Self-directed accounts can still use holdings and market-history Monte Carlo analysis.

## Database migration

`db/005_scheduled_contributions_and_future_expenses.sql` adds:

- start and end dates for income
- start and end dates and funding policy for expenses
- `account_contribution_schedules`
