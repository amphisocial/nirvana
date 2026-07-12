import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateMarketAnalytics, sliceHistoryForRange } from '../server/services/market/analytics.js';

const history = {
  asOf: '2026-07-10',
  points: [
    { date: '2025-07-11', close: 100 },
    { date: '2025-10-10', close: 120 },
    { date: '2026-01-02', close: 110 },
    { date: '2026-04-10', close: 132 },
    { date: '2026-07-10', close: 150 }
  ]
};

test('calculates decision-useful market analytics from history', () => {
  const analytics = calculateMarketAnalytics(history, { quote: { price: 150, asOf: '2026-07-10' } });
  assert.equal(analytics.price, 150);
  assert.equal(analytics.returnsPct.oneYear, 50);
  assert.equal(analytics.high52Week, 150);
  assert.equal(analytics.low52Week, 100);
  assert.equal(analytics.rangePositionPct, 100);
  assert.ok(analytics.annualizedVolatilityPct >= 0);
  assert.ok(analytics.maximumDrawdownPct < 0);
});

test('slices a one-year history into requested chart ranges', () => {
  const result = sliceHistoryForRange(history, '3m');
  assert.equal(result.range, '3m');
  assert.deepEqual(result.points.map((point) => point.date), ['2026-04-10', '2026-07-10']);
});
