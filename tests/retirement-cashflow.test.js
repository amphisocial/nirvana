import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateRetirementPlan,
  expenseAtAge,
  summarizeInvestableAccounts
} from '../server/services/retirement-cashflow-engine.js';

test('primary residence is excluded from investable retirement assets', () => {
  const summary = summarizeInvestableAccounts([
    { id: '1', name: '401k', account_type: '401k', current_balance: 500_000, expected_return: .08, expected_volatility: .18 },
    { id: '2', name: 'Home', account_type: 'property', current_balance: 900_000, is_primary_residence: true },
    { id: '3', name: 'Cash', account_type: 'cash', current_balance: 50_000 }
  ], {});
  assert.equal(summary.startingPortfolio, 550_000);
  assert.equal(summary.accounts.length, 2);
});

test('expense behavior changes at retirement and respects payoff age', () => {
  const mortgage = {
    annual_amount: 48_000,
    retirement_behavior: 'same',
    start_age: 45,
    end_age: 68,
    inflation_rate: 0
  };
  const commuting = {
    annual_amount: 12_000,
    retirement_behavior: 'ends',
    inflation_rate: 0
  };
  const travel = {
    annual_amount: 10_000,
    post_retirement_annual_amount: 18_000,
    retirement_behavior: 'custom',
    inflation_rate: 0
  };
  assert.equal(expenseAtAge(mortgage, 67, 50, 65), 48_000);
  assert.equal(expenseAtAge(mortgage, 69, 50, 65), 0);
  assert.equal(expenseAtAge(commuting, 64, 50, 65), 12_000);
  assert.equal(expenseAtAge(commuting, 65, 50, 65), 0);
  assert.equal(expenseAtAge(travel, 65, 50, 65), 18_000);
});

test('retirement engine returns an age comparison and cash-flow timeline', () => {
  const result = evaluateRetirementPlan({
    currentAge: 55,
    retirementAge: 62,
    endAge: 92,
    maxSearchAge: 70,
    successThreshold: .85,
    effectiveTaxRate: .15,
    startingPortfolio: 1_200_000,
    annualContribution: 40_000,
    annualRetirementSpending: 90_000,
    expectedReturn: .065,
    volatility: .12,
    inflation: .025,
    simulationCount: 250,
    searchSimulationCount: 250,
    incomes: [
      { annual_amount: 180_000, income_type: 'employment', ends_at_retirement: true, taxable: true, inflation_rate: .02 },
      { annual_amount: 42_000, income_type: 'social_security', start_age: 67, taxable: true, inflation_rate: .02 }
    ],
    expenses: [
      { annual_amount: 84_000, retirement_behavior: 'same', inflation_rate: .025 },
      { annual_amount: 18_000, retirement_behavior: 'ends', inflation_rate: .02 }
    ],
    properties: [
      { is_primary_residence: true, retirement_treatment: 'keep', current_balance: 800_000 }
    ]
  });
  assert.equal(result.retirementAge, 62);
  assert.ok(result.ageResults.length > 1);
  assert.equal(result.cashflowTimeline[0].age, 55);
  assert.ok(result.monthlyExpensesAtRetirement > 0);
  assert.ok(result.successRatePct >= 0 && result.successRatePct <= 100);
});

test('annual contributions are added before retirement even without income rows', () => {
  const result = evaluateRetirementPlan({
    currentAge: 50,
    retirementAge: 52,
    endAge: 55,
    maxSearchAge: 52,
    successThreshold: 0.8,
    startingPortfolio: 100000,
    annualContribution: 10000,
    annualRetirementSpending: 0,
    expectedReturn: 0,
    volatility: 0,
    inflation: 0,
    effectiveTaxRate: 0,
    incomes: [],
    expenses: [],
    properties: [],
    simulationCount: 250,
    searchSimulationCount: 250
  });

  assert.equal(result.deterministic[0], 100000);
  assert.equal(result.deterministic[1], 110000);
  assert.equal(result.deterministic[2], 120000);
});
