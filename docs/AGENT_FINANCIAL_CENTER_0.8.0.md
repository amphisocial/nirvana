# Nirvana 0.8.0 — Agent Financial Center

## Navigation

- **Insights** contains four tabs: What changed this week, From Nirvana's Desk, Income Calendar, and Spending Actuals.
- **Goals** is a dedicated left-menu view.
- **Holdings → Research & Earnings** contains earnings summaries, street target prices, consensus ratings, and upcoming dates.
- **Accounts → Household Sharing** contains partner invitations, members, and household switching.
- The header alert bell opens drift, concentration, spending, and goal recommendations.

## Scheduled jobs

The in-process scheduler checks once per hour. Database run claims prevent duplicate nightly or weekly work when more than one app process is running. Catch-up logic runs the current day or week after a restart when the configured hour was missed, and stale or failed claims can be retried safely.

Nightly:

1. captures account, liability, and net-worth state;
2. updates the standard net-worth snapshot;
3. writes a new **From Nirvana's Desk** market article using web-enabled AI research;
4. refreshes large-expense and goal alerts.

Weekly:

1. refreshes stale or missing holding prices and moves each affected account total by the same known-holdings market-value change while preserving its unallocated value;
2. researches each configured holding symbol, up to `AGENT_MAX_SYMBOLS_PER_RUN` (250 by default);
3. saves the latest earnings summary, provider target price, and provider rating counts;
4. refreshes a saved ten-year net-worth forecast;
5. explains weekly net-worth movement;
6. scans portfolio drift and concentration;
7. refreshes spending and goal alerts;
8. writes a personalized weekly household briefing.

## Market and rating data

Street target price and rating counts use the configured market-data provider when available, with sourced AI web research as a fallback when provider fields are absent. Earnings summaries and upcoming dates use AI web research with saved source links. Missing data is preserved as a visible data gap rather than invented.

## Portfolio drift

The first weekly run saves the current priced-holdings mix as the reference target. Future runs alert when symbol weights move by at least `AGENT_DRIFT_THRESHOLD_PCT`. Users can deliberately reset the reference mix from Holdings or the alert drawer.

## Spending actuals

Planned monthly expense is the saved annual expense divided by twelve while the expense is active. Users enter actual values for each month. The trend graph compares saved plan totals with entered actual totals. No bank transaction is inferred. Each account can be linked to only one active goal so its full balance is not counted more than once.

## Income calendar

- Dividend and earnings dates come from saved holding-research snapshots.
- Estimated dividend amount equals saved shares multiplied by saved dividend per share.
- Estimated interest uses current account balance multiplied by the saved annual account return divided by twelve.

## Partner sharing

The primary owner enters the partner's Gmail address. If that email already belongs to a Nirvana user, access is added immediately. Otherwise, a pending invite is saved. On first Google sign-in with the invited address, the user is added to the shared household and that household becomes active.

Users who belong to multiple households can switch from Accounts → Household Sharing.

## Deployment

This release includes a database migration. Run `npm run db:migrate` after replacing files and before restarting the production app.

No new npm dependency is required.
