import test from 'node:test';
import assert from 'node:assert/strict';
import {
  consensusFromRatings,
  compareFinancialSnapshots,
  calculatePortfolioDrift,
  monthlyPlannedExpense,
  calculateGoalProgress,
  tenYearForecastSlice
} from '../server/services/financial-intelligence-engine.js';

test('street rating counts produce a consensus label', () => {
  assert.equal(consensusFromRatings({ strongBuy: 8, buy: 10, hold: 3, sell: 1 }), 'Strong Buy');
  assert.equal(consensusFromRatings({ hold: 10 }), 'Hold');
  assert.equal(consensusFromRatings({}), 'Unrated');
});

test('weekly snapshot comparison explains assets and debt', () => {
  const prior = { snapshot_date: '2026-07-01', assets: 100000, liabilities: 40000, net_worth: 60000, account_breakdown: [{ id: 'a', name: 'Brokerage', balance: 100000 }], liability_breakdown: [{ id: 'm', name: 'Mortgage', balance: 40000 }] };
  const current = { snapshot_date: '2026-07-08', assets: 106000, liabilities: 39000, net_worth: 67000, account_breakdown: [{ id: 'a', name: 'Brokerage', balance: 106000 }], liability_breakdown: [{ id: 'm', name: 'Mortgage', balance: 39000 }] };
  const change = compareFinancialSnapshots(current, prior);
  assert.equal(change.netWorthChange, 7000);
  assert.equal(change.assetsChange, 6000);
  assert.equal(change.liabilitiesChange, -1000);
  assert.match(change.explanation, /rose/);
});

test('portfolio drift identifies positions outside threshold', () => {
  const drift = calculatePortfolioDrift([{ key: 'NVDA', value: 400 }, { key: 'SPY', value: 600 }], [{ key: 'NVDA', targetPercent: 0.25 }, { key: 'SPY', targetPercent: 0.75 }], 5);
  assert.equal(drift.length, 2);
  assert.equal(drift[0].key, 'NVDA');
});

test('planned monthly expense respects start and end dates', () => {
  const expense = { annual_amount: 12000, start_date: '2026-03-01', end_date: '2026-10-31' };
  assert.equal(monthlyPlannedExpense(expense, '2026-02-01'), 0);
  assert.equal(monthlyPlannedExpense(expense, '2026-07-01'), 1000);
  assert.equal(monthlyPlannedExpense(expense, '2026-11-01'), 0);
});

test('goal progress uses linked account balances', () => {
  const progress = calculateGoalProgress({ target_amount: 100000, manual_current_amount: 10, linked_account_ids: ['a', 'b'] }, [{ id: 'a', current_balance: 25000 }, { id: 'b', current_balance: 15000 }]);
  assert.equal(progress.current, 40000);
  assert.equal(progress.progressPct, 40);
});

test('ten year forecast slice limits projection horizon', () => {
  const projection = { currentAge: 50, timeline: Array.from({ length: 20 }, (_, index) => ({ age: 50 + index, netWorth: index * 1000, debt: 0 })) };
  const timeline = tenYearForecastSlice(projection, 10);
  assert.equal(timeline.length, 11);
  assert.equal(timeline.at(-1).age, 60);
});
