# Nirvana 0.7.0 — Agentic Holdings Lab

## Purpose

The Holdings Lab combines brokerage, IRA, 401(k), and other retirement accounts into one planning view while preserving each account's own reported balance and growth assumption.

## Missing-price refresh

The Holdings page includes **Refresh missing prices**. The endpoint requests a quote only for holdings whose saved `current_price` is empty or non-positive, then saves the returned price and as-of timestamp. It does not overwrite quantities, average cost, account assumptions, or hypothetical scenarios.

When an agent can obtain a current quote during analysis but the user has not pressed Refresh, the page may use that quote in the temporary graph while labeling it as an **agent quote**. Average cost is used only as a clearly labeled estimate when neither a saved nor market-agent price is available.

## Partial holdings coverage

An account can contain a reported total larger than the sum of individually entered holdings. The difference is treated as an **unallocated account value** and grows using that account's saved or user-entered annual growth percentage.

Adding or editing a holding no longer silently replaces a larger reported account total with an incomplete holdings sum. If priced holdings exceed the reported total, the Holdings Lab uses the priced holdings value and surfaces the coverage difference.

## Symbol-agent workflow

Each unique symbol receives a symbol-agent result. The workflow:

1. loads the saved position and account context;
2. requests cached or live one-year market research for the highest-value symbols;
3. derives current price, momentum, volatility, maximum drawdown, and benchmark beta when available;
4. assigns a high-risk, low-risk, stable, or unclassified bucket;
5. creates a bounded planning return anchored to the account's saved fallback return;
6. combines all symbol paths with unallocated account value;
7. asks a portfolio insight agent to synthesize concentration, risk, coverage, and watch items.

Provider failures do not block the page. A failed or deferred market packet falls back to the account-level growth assumption and is labeled accordingly.

## Three-year projections

The main graph shows monthly points for the current month through month 36. Users can select one or more account types and change the fallback growth percentage for each selected account. These growth overrides are page-only and are not persisted.

Additional views include:

- current and year-one through year-three value by account;
- risk allocation by value;
- top-position concentration;
- holdings coverage and unallocated value;
- per-symbol quote source, modeled return, risk, and agent status.

## Temporary holdings what-if

The inline agent form can model requests such as:

- buy a dollar amount or share quantity of a symbol on a future date;
- sell a symbol on a future date and keep proceeds unallocated;
- use hypothetical external capital or reallocate assets inside the account;
- change a symbol's annual return for one or more years;
- apply a crash, recovery, or growth path across selected accounts.

Internal buys use unallocated value first, then proportionally reallocate other holdings in the same account. External hypothetical buys increase the scenario total. All scenario positions, trades, return overrides, and calculated paths exist only in memory for that request and are never written to the database.

## AI skills

The existing `portfolio-scenario-analyst` skill now includes rules for partial holdings coverage, account-type distinctions, risk evidence, internal versus external funding, and temporary future-dated trades. Chat routing recognizes holdings, brokerage, IRA, 401(k), concentration, and risk-mix requests as portfolio-scenario questions.

## Limitations

- Market packets depend on the configured market-data provider and may be delayed, cached, rate-limited, or unavailable.
- Symbol planning returns are bounded scenarios anchored to account assumptions, not price targets or investment recommendations.
- The model does not include taxes, commissions, spreads, slippage, wash-sale rules, tax-lot selection, or retirement-account withdrawal penalties.
- Live/cached market research is prioritized for up to 24 symbols per page run; remaining symbols still receive a fallback agent result using their account assumption.
