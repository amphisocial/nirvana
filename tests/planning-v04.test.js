import test from 'node:test';
import assert from 'node:assert/strict';
import {
  advanceLoanBalance,
  loanTermPosition,
  mortgagePaymentBreakdown
} from '../server/services/loan-schedule.js';
import {
  estimatePortfolioMoments,
  simulateAccountForecast
} from '../server/services/account-forecast.js';
import { projectHouseholdNetWorth } from '../server/services/net-worth-projection.js';

test('mortgage payment separates principal from continuing housing costs', () => {
  const breakdown = mortgagePaymentBreakdown({
    monthly_payment: 5500,
    principal_interest_payment: 3950,
    property_tax_payment: 1150,
    home_insurance_payment: 275,
    pmi_payment: 0,
    hoa_payment: 125,
    other_escrow_payment: 0
  });
  assert.equal(breakdown.principalInterest, 3950);
  assert.equal(breakdown.escrowTotal, 1550);
  assert.equal(breakdown.total, 5500);
});

test('loan term position reports current year and remaining months', () => {
  const position = loanTermPosition({ original_term_months: 360, current_term_month: 72 });
  assert.equal(position.currentYear, 7);
  assert.equal(position.currentMonthInYear, 1);
  assert.equal(position.remainingMonths, 288);
});

test('loan balance amortization uses principal and interest, not escrow', () => {
  const balance = advanceLoanBalance({
    liability_type: 'mortgage',
    current_balance: 400000,
    interest_rate: 0.06,
    monthly_payment: 4000,
    principal_interest_payment: 2500,
    property_tax_payment: 1000,
    home_insurance_payment: 500
  }, 12);
  assert.ok(balance < 400000);
  assert.ok(balance > 390000);
});

test('account forecast is deterministic and includes linked cash flow', () => {
  const input = {
    startingValue: 100000,
    annualLinkedCashFlow: 12000,
    annualLinkedCashFlows: [12000, 10000, 8000, 6000, 4000, 2000, 0, 0, 0, 0],
    expectedReturn: 0.07,
    volatility: 0.15,
    horizonYears: 10,
    simulationCount: 500,
    seed: 42
  };
  const first = simulateAccountForecast(input);
  const second = simulateAccountForecast(input);
  assert.deepEqual(first, second);
  assert.equal(first.timeline.length, 11);
  assert.equal(first.annualLinkedCashFlow, 12000);
  assert.equal(first.linkedCashFlowTimeline[6], 0);
  assert.ok(first.timeline.at(-1).p50 > first.startingValue);
});

test('portfolio moments fall back when history is insufficient', () => {
  const result = estimatePortfolioMoments([
    { value: 50000, returns: [{ date: '2026-01-01', value: 0.01 }], periodsPerYear: 52 }
  ], { expectedReturn: 0.06, volatility: 0.12 });
  assert.equal(result.expectedReturn, 0.06);
  assert.equal(result.volatility, 0.12);
  assert.match(result.source, /fallback/i);
});

test('net worth projection links income and expense to account growth', () => {
  const result = projectHouseholdNetWorth({
    currentAge: 50,
    retirementAge: 65,
    endAge: 52,
    effectiveTaxRate: 0,
    accounts: [
      { id: 'cash', account_type: 'cash', current_balance: 10000, expected_return: 0 },
      { id: 'home', account_type: 'property', current_balance: 500000, property_growth_rate: 0 }
    ],
    liabilities: [{
      id: 'mortgage', liability_type: 'mortgage', current_balance: 200000,
      interest_rate: 0, principal_interest_payment: 1000, monthly_payment: 1500,
      original_term_months: 360, current_term_month: 120
    }],
    incomes: [{ annual_amount: 120000, taxable: false, deposit_account_id: 'cash', inflation_rate: 0 }],
    expenses: [{ annual_amount: 60000, payment_account_id: 'cash', retirement_behavior: 'same', inflation_rate: 0 }]
  });
  assert.equal(result.timeline[0].netWorth, 310000);
  assert.equal(result.timeline[0].annualInflow, 120000);
  assert.equal(result.timeline[0].annualOutflow, 60000);
  assert.equal(result.timeline[0].annualNetCashFlow, 60000);
  assert.ok(result.timeline[1].savingsInvestments > result.timeline[0].savingsInvestments);
  assert.ok(Math.abs(result.timeline[1].debts) < Math.abs(result.timeline[0].debts));
});

test('selling a linked primary residence transfers net equity to savings', () => {
  const result = projectHouseholdNetWorth({
    currentAge: 64,
    retirementAge: 65,
    endAge: 66,
    effectiveTaxRate: 0,
    accounts: [
      { id: 'cash', account_type: 'cash', current_balance: 10000, expected_return: 0 },
      { id: 'home', name: 'Home', account_type: 'property', current_balance: 500000, property_growth_rate: 0, is_primary_residence: true, retirement_treatment: 'sell_at_retirement' }
    ],
    liabilities: [{ id: 'mortgage', linked_account_id: 'home', liability_type: 'mortgage', current_balance: 200000, interest_rate: 0, principal_interest_payment: 0 }],
    incomes: [],
    expenses: []
  });
  const atRetirement = result.timeline.find((row) => row.age === 65);
  assert.equal(atRetirement.realEstate, 0);
  assert.equal(atRetirement.debts, 0);
  assert.equal(atRetirement.savingsInvestments, 310000);
  assert.ok(atRetirement.events.some((event) => event.includes('sold')));
});
