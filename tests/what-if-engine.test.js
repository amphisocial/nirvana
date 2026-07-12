import test from 'node:test';
import assert from 'node:assert/strict';
import { simulateHouseholdWhatIf, simulatePortfolioWhatIf } from '../server/services/what-if-engine.js';

function fixture() {
  return {
    plan: {
      current_age: 55,
      retirement_age: 65,
      plan_end_age: 70,
      effective_tax_rate: 0.15
    },
    accounts: [
      { id: 'cash', name: 'Checking', account_type: 'cash', current_balance: 50000, expected_return: 0 },
      { id: 'stocks', name: 'Taxable Stocks', account_type: 'brokerage', current_balance: 500000, expected_return: 0.07 },
      { id: 'home', name: 'Home', account_type: 'property', current_balance: 700000, property_growth_rate: 0.03 }
    ],
    liabilities: [
      {
        id: 'mortgage',
        name: 'Primary mortgage',
        liability_type: 'mortgage',
        current_balance: 250000,
        interest_rate: 0.04,
        principal_interest_payment: 1800,
        monthly_payment: 1800
      },
      {
        id: 'car',
        name: 'Car loan',
        liability_type: 'auto_loan',
        current_balance: 30000,
        interest_rate: 0.06,
        monthly_payment: 650
      }
    ],
    incomes: [
      {
        id: 'salary',
        name: 'Salary',
        annual_amount: 180000,
        taxable: true,
        inflation_rate: 0,
        ends_at_retirement: true,
        deposit_account_id: 'cash'
      }
    ],
    expenses: [
      {
        id: 'living',
        name: 'Living costs',
        category: 'other',
        annual_amount: 72000,
        inflation_rate: 0,
        retirement_behavior: 'same',
        payment_account_id: 'cash'
      },
      {
        id: 'mortgage-expense',
        name: 'Mortgage payment',
        category: 'mortgage',
        annual_amount: 21600,
        inflation_rate: 0,
        retirement_behavior: 'same',
        linked_liability_id: 'mortgage',
        payment_account_id: 'cash'
      },
      {
        id: 'car-expense',
        name: 'Car payment',
        category: 'debt_payment',
        annual_amount: 7800,
        inflation_rate: 0,
        retirement_behavior: 'same',
        linked_liability_id: 'car',
        payment_account_id: 'cash'
      }
    ],
    contributions: []
  };
}

test('paying a mortgage from stocks reduces future expenses without persisting state', () => {
  const data = fixture();
  const originalStockBalance = data.accounts[1].current_balance;
  const result = simulateHouseholdWhatIf(data, {
    title: 'Pay mortgage at 57',
    payoffActions: [{ sourceAccountId: 'stocks', liabilityIds: ['mortgage'], age: 57 }]
  });

  const baselineAt58 = result.baseline.timeline.find((row) => row.age === 58);
  const scenarioAt58 = result.alternative.timeline.find((row) => row.age === 58);
  assert.ok(scenarioAt58.monthlyExpenses < baselineAt58.monthlyExpenses);
  assert.ok(result.metrics.debtPaidFromAssets > 0);
  assert.equal(data.accounts[1].current_balance, originalStockBalance);
});

test('staged stock return assumptions change scenario net worth', () => {
  const result = simulateHouseholdWhatIf(fixture(), {
    returnPhases: [
      { scope: 'stocks', startOffset: 0, endOffset: 1, annualReturn: 0.20 },
      { scope: 'stocks', startOffset: 2, endOffset: 3, annualReturn: 0.02 },
      { scope: 'stocks', startOffset: 4, endOffset: null, annualReturn: 0.06 }
    ]
  });
  assert.notEqual(result.metrics.netWorthAtEndChange, 0);
  assert.equal(result.alternative.timeline.length, result.baseline.timeline.length);
});

test('portfolio symbol shocks produce a separate temporary value path', () => {
  const data = fixture();
  const holdings = [
    { id: 'h1', account_id: 'stocks', account_name: 'Taxable Stocks', symbol: 'NVDA', quantity: 100, current_price: 200, market_value: 20000 },
    { id: 'h2', account_id: 'stocks', account_name: 'Taxable Stocks', symbol: 'TSLA', quantity: 100, current_price: 100, market_value: 10000 }
  ];
  const result = simulatePortfolioWhatIf(data, holdings, {
    accountId: 'stocks',
    horizonYears: 5,
    symbolShocks: [
      { symbol: 'NVDA', startOffset: 0, endOffset: 0, annualReturn: 0.30 },
      { symbol: 'TSLA', startOffset: 0, endOffset: 0, annualReturn: -0.15 }
    ]
  });
  assert.equal(result.baselineTimeline.length, 6);
  assert.equal(result.alternativeTimeline.length, 6);
  assert.notEqual(result.metrics.endingPortfolioChange, 0);
});
