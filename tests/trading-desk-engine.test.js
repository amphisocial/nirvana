import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveSignals,
  buildTradePlan,
  runRiskChecks
} from '../server/services/trading-desk-engine.js';

function bullishPacket() {
  return {
    symbol: 'NVDA',
    currentPrice: 200,
    analytics: { annualizedVolatilityPct: 35, maximumDrawdownPct: -22 },
    quant: { momentumState: 'strengthening', trendState: 'uptrend', estimatedBetaToBenchmark: 1.4 }
  };
}

function bearishPacket() {
  return {
    symbol: 'XYZ',
    currentPrice: 50,
    analytics: { annualizedVolatilityPct: 55, maximumDrawdownPct: -60 },
    quant: { momentumState: 'weakening', trendState: 'downtrend', estimatedBetaToBenchmark: 1.8 }
  };
}

test('deriveSignals reads a bullish packet as net bullish', () => {
  const { netBias, bullish, bearish, signals } = deriveSignals(bullishPacket());
  assert.equal(netBias, 'bullish');
  assert.ok(bullish > bearish);
  assert.ok(signals.length >= 3);
});

test('deriveSignals reads a bearish packet as net bearish', () => {
  const { netBias } = deriveSignals(bearishPacket());
  assert.equal(netBias, 'bearish');
});

test('buildTradePlan produces sane levels for a buy', () => {
  const plan = buildTradePlan(bullishPacket(), { action: 'buy', riskProfile: 'balanced' });
  assert.ok(plan, 'plan should exist for a buy');
  assert.ok(plan.targetPrice > plan.referencePrice, 'target above reference');
  assert.ok(plan.stopPrice < plan.referencePrice, 'stop below reference');
  assert.ok(plan.rrRatio > 0, 'positive reward:risk');
  assert.ok(plan.entryZoneLow <= plan.entryZoneHigh, 'entry zone ordered');
});

test('buildTradePlan returns null for a hold', () => {
  const plan = buildTradePlan(bullishPacket(), { action: 'hold', riskProfile: 'balanced' });
  assert.equal(plan, null);
});

test('aggressive profile targets further than conservative', () => {
  const aggressive = buildTradePlan(bullishPacket(), { action: 'buy', riskProfile: 'aggressive' });
  const conservative = buildTradePlan(bullishPacket(), { action: 'buy', riskProfile: 'conservative' });
  assert.ok(aggressive.targetPrice > conservative.targetPrice);
});

test('runRiskChecks fails when a buy would breach the position cap', () => {
  const portfolio = {
    totalValue: 100000,
    cashPct: 5,
    bySymbol: { NVDA: { value: 9000 } } // already 9% of portfolio
  };
  const candidate = {
    symbol: 'NVDA',
    action: 'buy',
    suggestedWeightPct: 5, // 9% + 5% = 14% > 10% cap
    confidenceScore: 80,
    packet: bullishPacket()
  };
  const { checks, passed } = runRiskChecks(candidate, {
    portfolio,
    settings: { riskProfile: 'balanced', maxPositionPct: 10, cashReservePct: 5 }
  });
  const posCheck = checks.find((c) => c.name === 'Position size');
  assert.equal(posCheck.ok, false);
  assert.equal(passed, false);
});

test('runRiskChecks passes a well-sized high-conviction buy', () => {
  const portfolio = { totalValue: 100000, cashPct: 8, bySymbol: {} };
  const candidate = {
    symbol: 'NVDA',
    action: 'buy',
    suggestedWeightPct: 5,
    confidenceScore: 75,
    packet: bullishPacket()
  };
  const { passed } = runRiskChecks(candidate, {
    portfolio,
    settings: { riskProfile: 'balanced', maxPositionPct: 10, cashReservePct: 5 }
  });
  assert.equal(passed, true);
});

test('runRiskChecks fails below the conviction floor', () => {
  const portfolio = { totalValue: 100000, cashPct: 8, bySymbol: {} };
  const candidate = {
    symbol: 'NVDA',
    action: 'buy',
    suggestedWeightPct: 3,
    confidenceScore: 40, // below balanced floor of 55
    packet: bullishPacket()
  };
  const { checks } = runRiskChecks(candidate, {
    portfolio,
    settings: { riskProfile: 'balanced', maxPositionPct: 10, cashReservePct: 5 }
  });
  const floor = checks.find((c) => c.name === 'Conviction floor');
  assert.equal(floor.ok, false);
});
