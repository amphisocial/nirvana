import test from 'node:test';
import assert from 'node:assert/strict';
import { projectRetirement, simulateTrade } from '../server/services/financial-engine.js';

test('buy scenario preserves portfolio value at execution before fees', () => {
  const result = simulateTrade({
    action: 'BUY',
    symbol: 'TSLA',
    quantity: 10,
    executionPrice: 250,
    targetPrice: 300,
    cashBalance: 10_000,
    holdings: [{ symbol: 'TSLA', quantity: 20, currentPrice: 250 }, { symbol: 'VTI', quantity: 100, currentPrice: 200 }]
  });
  assert.equal(result.cashAfter, 7_500);
  assert.equal(result.quantityAfter, 30);
  assert.equal(result.portfolioBefore, result.portfolioAfterExecution);
  assert.equal(result.targetScenarioDelta, 1_500);
});

test('sell scenario rejects quantities above the holding', () => {
  assert.throws(() => simulateTrade({
    action: 'SELL', symbol: 'NVDA', quantity: 11, executionPrice: 150, targetPrice: 130,
    cashBalance: 1_000, holdings: [{ symbol: 'NVDA', quantity: 10, currentPrice: 150 }]
  }), /only 10 are available/);
});

test('retirement projection is deterministic for a fixed seed', () => {
  const input = {
    currentAge: 50,
    retirementAge: 65,
    endAge: 95,
    startingPortfolio: 600_000,
    annualContribution: 35_000,
    annualRetirementSpending: 90_000,
    expectedReturn: .065,
    volatility: .14,
    inflation: .025,
    simulationCount: 500,
    seed: 42
  };
  const first = projectRetirement(input);
  const second = projectRetirement(input);
  assert.deepEqual(first, second);
  assert.equal(first.ages[0], 50);
  assert.equal(first.ages.at(-1), 95);
  assert.ok(first.successRatePct >= 0 && first.successRatePct <= 100);
});
