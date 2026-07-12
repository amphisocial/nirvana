# Nirvana 0.4.0 — Blue Planning Dashboard and Account Forecasts

## Product changes

### Blue and white application design

The application now uses a consistent blue-and-white design system across the dashboard, forms, charts, Research AI, and planner drawer. Desktop users can collapse the left navigation to an icon rail; the choice is retained in browser storage.

### Lifetime net-worth and cash-flow chart

The Overview page now projects annual:

- savings and investment accounts
- real estate
- other assets
- outstanding debt
- total net worth
- after-tax inflows
- outflows
- net cash flow

Income and expenses are applied to their linked accounts. Unlinked flows use the default cash account and then other liquid accounts. Saved property events such as sale, downsizing, or equity access are reflected at their configured ages.

### Loans and mortgages

Amortizing loans collect:

- original amount
- current balance
- interest rate
- original term
- start date or current loan year/month
- monthly payment
- expected payoff age

Mortgages also separate principal and interest, property-tax escrow, home insurance, PMI, HOA, and other escrow. Only principal and interest amortize mortgage debt. Property tax, insurance, and HOA remain expenses after payoff unless their own expense assumptions say otherwise.

### Income and expenses linked to accounts

Income can be deposited into a selected account and expenses can be paid from a selected account. Medical insurance, Medicare, dental and vision, long-term-care insurance, auto insurance, home insurance, life insurance, umbrella insurance, property tax, PMI, and HOA are explicit expense categories.

### Holdings-based account forecasts

Brokerage and IRA accounts default to a holdings-based planning option. Users can:

- add, edit, and delete stocks and ETFs
- fetch a price when one is not manually entered
- calculate a 30-year seeded Monte Carlo account forecast
- save the expected return, volatility, forecast date, source, and percentile timeline
- include linked income and expenses according to their age, retirement, inflation, and tax settings
- ask Nirvana AI to review the selected account

The account model uses up to 12 holdings with current one-year market history, calculates weighted portfolio returns, and shrinks the one-year return signal toward the saved planning prior. Additional holdings remain in the account value using their saved prices. Results are hypothetical planning simulations, not predictions.

## Database migration

`db/004_blue_dashboard_loans_portfolio_forecasts.sql` adds loan details, account-link fields, account forecast assumptions, and saved Monte Carlo forecast timelines.

## Validation

The build includes automated tests for:

- loan term position
- mortgage payment decomposition
- principal-only amortization
- deterministic account Monte Carlo forecasts
- historical-data fallback behavior
- account-linked cash flow in net-worth projections
- primary-home sale and equity transfer
- existing retirement, market, and scenario behavior
