# Retirement Cash-Flow Planner v1

## Financial model

Nirvana now separates three concepts:

1. **Net worth**: all assets minus all liabilities.
2. **Investable assets**: cash, brokerage, IRA, 401(k), retirement, and HSA balances. Education-designated 529 assets remain in net worth but are excluded from retirement funding.
3. **Retirement funding**: investable assets plus modeled income and explicit home-equity releases, less expenses, taxes, and portfolio withdrawals.

A primary residence contributes to net worth but is excluded from retirement funding when its treatment is `keep`, `convert_to_rental`, or `undecided`.

## Income and expense planning

The new Income & Expenses workspace supports recurring income and expenses with:

- weekly, biweekly, monthly, quarterly, or annual frequency
- start and end ages
- inflation or COLA assumptions
- taxable versus non-taxable income
- employment income that ends at retirement
- expenses that continue, end, start, or change at retirement
- essential versus discretionary designation

A liability with a monthly payment and payoff age is automatically converted into a retirement cash-flow expense. The mortgage balance remains part of net-worth math; the payment belongs in cash-flow math.

## Retirement engine

For every candidate retirement age, the engine:

- projects investable accounts using balance-weighted return and volatility assumptions
- stops annual contributions at retirement
- applies saved income and expense timelines
- uses an effective tax-rate approximation
- adds an explicit property cash release only when configured
- performs seeded Monte Carlo simulations
- compares success probability with the user's selected threshold

The result includes an earliest feasible retirement age, selected-age success probability, monthly cash-flow timeline, and adjacent-age comparison.

## Known limitations

The current tax model is an effective-rate approximation. Detailed federal and state tax brackets, Social Security taxation, Medicare premiums, RMDs, account withdrawal sequencing, long-term care, and survivor scenarios remain future enhancements.
