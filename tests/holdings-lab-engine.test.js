import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHoldingsLabProjection, normalizeScenarioDates } from '../server/services/holdings-lab-engine.js';

function fixture() {
  return {
    accounts: [
      { id: 'brokerage', name: 'Fidelity Brokerage', account_type: 'brokerage', current_balance: 500000, expected_return: 0.07 },
      { id: 'ira', name: 'Roth IRA', account_type: 'ira', current_balance: 200000, expected_return: 0.06 },
      { id: 'cash', name: 'Checking', account_type: 'cash', current_balance: 50000, expected_return: 0.02 }
    ],
    holdings: [
      { id: 'h1', account_id: 'brokerage', symbol: 'NVDA', name: 'NVIDIA', asset_class: 'equity', quantity: 1000, current_price: 200, cost_basis_per_share: 100 },
      { id: 'h2', account_id: 'brokerage', symbol: 'VOO', name: 'Vanguard S&P 500 ETF', asset_class: 'etf', quantity: 200, current_price: 500, cost_basis_per_share: 400 },
      { id: 'h3', account_id: 'ira', symbol: 'BND', name: 'Vanguard Bond ETF', asset_class: 'bond etf', quantity: 100, current_price: null, cost_basis_per_share: 75 }
    ],
    symbolAnalyses: {
      NVDA: {
        currentPrice: 200,
        analytics: { annualizedVolatilityPct: 48, maximumDrawdownPct: -46, returnsPct: { oneYear: 30, sixMonth: 12, threeMonth: 8 } },
        quant: { estimatedBetaToBenchmark: 1.7, momentumState: 'strengthening' }
      },
      VOO: {
        currentPrice: 500,
        analytics: { annualizedVolatilityPct: 16, maximumDrawdownPct: -18, returnsPct: { oneYear: 10, sixMonth: 5, threeMonth: 3 } },
        quant: { estimatedBetaToBenchmark: 1, momentumState: 'mixed' }
      },
      BND: {
        currentPrice: 80,
        analytics: { annualizedVolatilityPct: 7, maximumDrawdownPct: -9, returnsPct: { oneYear: 4, sixMonth: 2, threeMonth: 1 } },
        quant: { estimatedBetaToBenchmark: 0.15, momentumState: 'mixed' }
      }
    }
  };
}

test('partial holdings preserve the reported account total and model the remainder', () => {
  const data = fixture();
  const result = buildHoldingsLabProjection({
    ...data,
    selectedTypes: ['brokerage'],
    currentDate: new Date('2026-07-01T00:00:00Z')
  });

  assert.equal(result.metrics.selectedAccountTotal, 500000);
  assert.equal(result.metrics.knownHoldingsValue, 300000);
  assert.equal(result.metrics.unallocatedValue, 200000);
  assert.equal(result.metrics.holdingsCoveragePct, 60);
  assert.equal(result.accounts[0].coveragePct, 60);
});

test('agent price fills a missing saved price without mutating the holding', () => {
  const data = fixture();
  const original = data.holdings[2].current_price;
  const result = buildHoldingsLabProjection({
    ...data,
    selectedTypes: ['ira'],
    currentDate: new Date('2026-07-01T00:00:00Z')
  });

  const bnd = result.holdings.find((row) => row.symbol === 'BND');
  assert.equal(bnd.price, 80);
  assert.equal(bnd.priceSource, 'agent quote');
  assert.equal(bnd.currentValue, 8000);
  assert.equal(data.holdings[2].current_price, original);
});

test('risk allocation includes high-risk, stable, and unallocated values', () => {
  const result = buildHoldingsLabProjection({
    ...fixture(),
    selectedTypes: ['brokerage', 'ira'],
    currentDate: new Date('2026-07-01T00:00:00Z')
  });
  const risk = Object.fromEntries(result.riskAllocation.map((row) => [row.risk, row]));
  assert.ok(risk.high.value > 0);
  assert.ok(risk.stable.value > 0);
  assert.ok(risk.unallocated.value > 0);
  const totalPercent = result.riskAllocation.reduce((sum, row) => sum + row.percent, 0);
  assert.ok(Math.abs(totalPercent - 100) < 0.2);
});

test('an internal future buy reallocates the account without changing value immediately', () => {
  const data = fixture();
  const scenario = normalizeScenarioDates({
    title: 'Buy QQQ next year',
    trades: [{ action: 'buy', symbol: 'QQQ', amount: 50000, date: '2027-07-01', accountId: 'brokerage', referencePrice: 500, funding: 'internal' }],
    symbolReturnOverrides: [{ symbol: 'QQQ', startMonth: 12, endMonth: null, annualReturn: 0.15 }],
    accountReturnOverrides: []
  }, new Date('2026-07-01T00:00:00Z'));

  const result = buildHoldingsLabProjection({
    ...data,
    selectedTypes: ['brokerage'],
    scenario,
    currentDate: new Date('2026-07-01T00:00:00Z')
  });

  const baselineAt12 = result.baseline.timeline[12].total;
  const scenarioAt12 = result.alternative.timeline[12].total;
  assert.ok(Math.abs(baselineAt12 - scenarioAt12) < 1);
  assert.ok(result.alternative.events.some((event) => event.items.some((item) => item.includes('bought QQQ'))));
  assert.notEqual(result.metrics.scenarioThreeYearChange, 0);
});

test('an external hypothetical buy increases portfolio value but is not persisted', () => {
  const data = fixture();
  const originalCount = data.holdings.length;
  const scenario = normalizeScenarioDates({
    trades: [{ action: 'buy', symbol: 'MSFT', amount: 25000, date: '2026-07-01', accountId: 'brokerage', referencePrice: 500, funding: 'external' }]
  }, new Date('2026-07-01T00:00:00Z'));
  const result = buildHoldingsLabProjection({
    ...data,
    selectedTypes: ['brokerage'],
    scenario,
    currentDate: new Date('2026-07-01T00:00:00Z')
  });
  assert.equal(result.alternative.timeline[0].total - result.baseline.timeline[0].total, 25000);
  assert.equal(data.holdings.length, originalCount);
});

test('account type filters exclude cash and unselected retirement accounts', () => {
  const result = buildHoldingsLabProjection({
    ...fixture(),
    selectedTypes: ['ira'],
    currentDate: new Date('2026-07-01T00:00:00Z')
  });
  assert.equal(result.accounts.length, 1);
  assert.equal(result.accounts[0].accountType, 'ira');
  assert.equal(result.metrics.selectedAccountTotal, 200000);
});
