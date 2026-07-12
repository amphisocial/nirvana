import test from 'node:test';
import assert from 'node:assert/strict';

import { contributionAtYear, linkedContributionForAccount } from '../server/services/account-contribution.js';
import { expenseAtAge } from '../server/services/retirement-cashflow-engine.js';
import { projectHouseholdNetWorth } from '../server/services/net-worth-projection.js';
import { simulateAccountForecast } from '../server/services/account-forecast.js';

test('monthly contribution schedule annualizes and grows from its start year', () => {
  const schedule = {
    amount: 100,
    frequency: 'monthly',
    start_date: '2027-01-01',
    end_date: '2030-12-31',
    annual_increase_rate: 0.05
  };
  assert.equal(contributionAtYear(schedule, 2026, 2026), 0);
  assert.equal(contributionAtYear(schedule, 2027, 2026), 1200);
  assert.equal(Math.round(contributionAtYear(schedule, 2028, 2026)), 1260);
  assert.equal(contributionAtYear(schedule, 2031, 2026), 0);
});

test('transfer contribution is positive for target and negative for source', () => {
  const schedule = {
    amount: 1200,
    frequency: 'annual',
    contribution_type: 'transfer',
    source_account_id: 'cash',
    target_account_id: '529'
  };
  assert.equal(linkedContributionForAccount(schedule, '529', 2026, 2026), 1200);
  assert.equal(linkedContributionForAccount(schedule, 'cash', 2026, 2026), -1200);
});

test('future dated expense is inactive before its start date', () => {
  const expense = {
    annual_amount: 24000,
    start_date: '2028-08-01',
    end_date: '2031-06-30',
    retirement_behavior: 'same',
    inflation_rate: 0
  };
  assert.equal(expenseAtAge(expense, 41, 40, 65, 2026), 0);
  assert.equal(expenseAtAge(expense, 42, 40, 65, 2026), 24000);
  assert.equal(expenseAtAge(expense, 46, 40, 65, 2026), 0);
});

test('owned-account transfer does not create household net worth', () => {
  const projection = projectHouseholdNetWorth({
    currentAge: 40,
    retirementAge: 65,
    endAge: 41,
    currentYear: 2026,
    effectiveTaxRate: 0,
    accounts: [
      { id: 'cash', account_type: 'cash', current_balance: 10000, expected_return: 0 },
      { id: '529', account_type: '529', current_balance: 0, expected_return: 0 }
    ],
    liabilities: [],
    incomes: [],
    expenses: [],
    contributions: [{
      contribution_type: 'transfer',
      source_account_id: 'cash',
      target_account_id: '529',
      amount: 1200,
      frequency: 'annual'
    }]
  });
  assert.equal(projection.timeline[0].netWorth, 10000);
  assert.equal(projection.timeline[1].netWorth, 10000);
  assert.equal(projection.timeline[0].annualContributions, 1200);
  assert.equal(projection.timeline[0].annualExternalContributions, 0);
});

test('external contribution increases household net worth', () => {
  const projection = projectHouseholdNetWorth({
    currentAge: 40,
    retirementAge: 65,
    endAge: 41,
    currentYear: 2026,
    effectiveTaxRate: 0,
    accounts: [{ id: 'ira', account_type: 'ira', current_balance: 10000, expected_return: 0 }],
    liabilities: [],
    incomes: [],
    expenses: [],
    contributions: [{
      contribution_type: 'external',
      target_account_id: 'ira',
      amount: 1200,
      frequency: 'annual'
    }]
  });
  assert.equal(projection.timeline[1].netWorth, 11200);
  assert.equal(projection.timeline[0].annualExternalContributions, 1200);
});

test('account forecast reflects scheduled deposits and later education withdrawals', () => {
  const forecast = simulateAccountForecast({
    startingValue: 10000,
    annualLinkedCashFlows: [1200, 1200, 1200, -6000, -6000],
    expectedReturn: 0,
    volatility: 0,
    horizonYears: 5,
    simulationCount: 250,
    seed: 1
  });
  assert.equal(forecast.timeline[3].p50, 13600);
  assert.equal(forecast.timeline[4].p50, 7600);
  assert.equal(forecast.timeline[5].p50, 1600);
});
