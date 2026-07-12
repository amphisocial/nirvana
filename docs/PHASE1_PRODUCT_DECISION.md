# Nirvana product decision

## What to copy from Boldin now

1. A guided setup that gets users from incomplete data to a useful dashboard quickly.
2. A single financial snapshot: net worth, account mix, liabilities, investment allocation, and retirement readiness.
3. Scenario-first planning. Users should be able to compare a baseline with a proposed change.
4. Clean charts that explain the plan rather than merely displaying raw balances.
5. AI grounded in the user's plan and deterministic calculations.

## What not to copy in Phase 1

- Full federal and state tax modeling
- Roth conversion optimization
- Social Security optimization
- Medicare and long-term-care modeling
- Estate document vault
- Advisor collaboration workflows
- Full transaction categorization and budgeting automation
- Position-level sync across every institution

Those are expensive accuracy and support commitments. They are appropriate only after the core data model, scenario engine, and customer behavior are validated.

## Plaid recommendation

Plaid should be Phase 2. It improves onboarding and freshness but adds production approval, institution support issues, token security, webhook operations, recurring data reconciliation, and product-specific cost. Launching without it avoids turning a data-integration project into the critical path.

### Phase 1 backup

- Manual accounts and liabilities
- Holdings CSV import
- Saved account templates for brokerage, retirement, cash, property, mortgage, and credit cards
- “Last verified” timestamps and stale-data warnings
- One-click duplicate-and-update workflow for monthly refreshes

### Phase 2 Plaid order

1. Link + Investments for brokerage and retirement holdings
2. Liabilities for mortgages, student loans, and cards
3. Transactions only after Nirvana has a real cash-flow/budgeting experience

## AI stock research boundary

The assistant can summarize price trends, company fundamentals, catalysts, risks, concentration, and user-defined scenarios. It should not issue an unqualified “buy,” “sell,” or “hold” instruction. Use “research posture” and bull/base/bear cases, clearly identify data dates and sources, and always show the educational-use disclaimer.
