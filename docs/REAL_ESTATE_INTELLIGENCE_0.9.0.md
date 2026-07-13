# Nirvana 0.9.0 — Real Estate Intelligence

## Property assets

Selecting **Property** in Accounts opens a property profile. Every saved property requires a US ZIP code and can include an address, home type, bedrooms, bathrooms, and square footage.

Nirvana can research a bounded medium-term appreciation assumption using the configured AI provider with web search. The saved account records the estimate source, as-of date, confidence, summary, and supporting links. When research fails, Nirvana uses clearly labeled planning fallbacks rather than blocking the save.

A property cannot be both a primary residence and a current rental property.

## Rental property save workflow

Selecting **Rental property** adds operating assumptions to the property form:

- gross monthly rent;
- annual rent growth;
- vacancy allowance;
- management fee;
- annual property tax;
- annual insurance;
- monthly HOA;
- monthly maintenance reserve;
- rental cash account.

The account save runs in one database transaction. It creates or updates:

1. the property asset;
2. a linked gross-rental income stream; and
3. a linked rental-operating-cost expense.

The operating expense includes vacancy, management, property tax, insurance, HOA, and maintenance. A property mortgage remains a separate liability and is not duplicated in the linked operating expense.

Changing a rental property back to a non-rental property removes its automatically linked rental income and operating expense.

## Quick rental calculator

What-If Lab includes a **Rental Property** tab. The calculator accepts an address or ZIP code plus property characteristics and purchase value. The research agent estimates:

- monthly market rent;
- property appreciation;
- rent growth;
- vacancy;
- management costs;
- property tax;
- insurance;
- HOA and maintenance assumptions.

The calculator shows estimated operating costs and net operating income. Results remain planning estimates, not appraisals, rental guarantees, tax advice, or lending advice.

## Temporary rental-purchase scenario

The structured scenario can:

- liquidate selected amounts from up to two existing household accounts at a future age;
- add a temporary rental-property asset;
- finance the remaining purchase and closing costs with a temporary mortgage;
- calculate mortgage principal and interest when the payment is left blank;
- add temporary rental income and operating expenses;
- amortize the mortgage and grow the property over the selected horizon;
- compare baseline and scenario income, expenses, real estate, debt, and net worth.

The cash-flow chart uses light blue for baseline income, dark blue for scenario income, light red for baseline expenses, and dark red for scenario expenses.

Scenario accounts, liquidations, property, mortgage, income, and expenses exist only in memory and are never persisted.

## Important exclusions

The scenario does not model brokerage capital-gains taxes, tax lots, retirement-account withdrawal tax or penalties, depreciation, passive-loss rules, mortgage qualification, closing-cost tax treatment, sale costs, or property-management legal requirements.
