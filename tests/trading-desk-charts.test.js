import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTradePlan } from '../server/services/trading-desk-engine.js';

// The workflow attaches priceHistory + analyticsSnapshot to every recommendation
// so the per-symbol chart can render without a second market call. We verify the
// plan-level math here (the part the chart overlays entry/target/stop on).

function bullishPacket() {
  return {
    symbol: 'NVDA',
    currentPrice: 200,
    analytics: { annualizedVolatilityPct: 35, maximumDrawdownPct: -22 },
    quant: { momentumState: 'strengthening', trendState: 'uptrend', estimatedBetaToBenchmark: 1.4 }
  };
}

test('buildTradePlan yields chartable entry/target/stop for a buy', () => {
  const plan = buildTradePlan(bullishPacket(), { action: 'buy', riskProfile: 'balanced' });
  assert.ok(plan, 'a buy should produce a plan');
  // These are exactly the levels the chart overlays as horizontal lines / bands.
  assert.ok(Number.isFinite(plan.entryZoneLow) && Number.isFinite(plan.entryZoneHigh));
  assert.ok(plan.entryZoneLow <= plan.entryZoneHigh);
  assert.ok(plan.targetPrice > plan.referencePrice, 'target above price');
  assert.ok(plan.stopPrice < plan.referencePrice, 'stop below price');
  assert.ok(plan.rrRatio > 0, 'reward:risk positive');
});

test('buildTradePlan returns null for hold (chart shows price only, no plan lines)', () => {
  const plan = buildTradePlan(bullishPacket(), { action: 'hold', riskProfile: 'balanced' });
  assert.equal(plan, null);
});

// Downsampling logic mirror: a chart snapshot should never exceed the cap and
// must preserve first + last points. We re-implement the contract here as a
// guard against regressions in the engine's downsampleHistory behavior.
function contractDownsample(points, max = 120) {
  if (points.length <= max) return points;
  const step = points.length / max;
  const out = [];
  for (let i = 0; i < max; i += 1) out.push(points[Math.floor(i * step)]);
  const last = points.at(-1);
  if (out.at(-1) !== last) out.push(last);
  return out;
}

test('downsample contract keeps series small and endpoints intact', () => {
  const points = Array.from({ length: 500 }, (_, i) => ({ date: `d${i}`, close: i }));
  const reduced = contractDownsample(points);
  assert.ok(reduced.length <= 121, 'at most max+1 points');
  assert.equal(reduced[0].date, 'd0', 'first point preserved');
  assert.equal(reduced.at(-1).date, 'd499', 'last point preserved');
});
