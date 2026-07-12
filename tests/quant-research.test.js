import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateMarketAnalytics, calculateQuantDiagnostics } from '../server/services/market/analytics.js';
import { selectSkillNames } from '../server/services/chat-routing.js';

function history(symbol, start, step) {
  const points = [];
  const date = new Date('2025-07-01T00:00:00Z');
  for (let i = 0; i < 53; i += 1) {
    points.push({ date: date.toISOString().slice(0, 10), close: start + (step * i) });
    date.setUTCDate(date.getUTCDate() + 7);
  }
  return { symbol, points, asOf: points.at(-1).date };
}

test('ticker research loads quant research skill', () => {
  const skills = selectSkillNames('What about CCJ?');
  assert.ok(skills.includes('stock-market-analyst'));
  assert.ok(skills.includes('quant-equity-research'));
});

test('quant diagnostics calculate benchmark-relative momentum', () => {
  const asset = history('CCJ', 40, 1.2);
  const benchmark = history('SPY', 500, 1.0);
  const assetAnalytics = calculateMarketAnalytics(asset, {});
  const benchmarkAnalytics = calculateMarketAnalytics(benchmark, {});
  const quant = calculateQuantDiagnostics(asset, assetAnalytics, benchmark, benchmarkAnalytics);
  assert.equal(quant.benchmark, 'SPY');
  assert.ok(Number.isFinite(quant.relativeReturnsPct.oneYearPct));
  assert.ok(['strengthening', 'mixed', 'weakening'].includes(quant.momentumState));
  assert.match(quant.methodology, /diagnostic/i);
});
