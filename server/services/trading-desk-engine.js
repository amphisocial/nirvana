import { config } from '../config.js';
import { generateAiResponse } from './ai/index.js';
import { getResearchBundle } from './market/index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function number(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round(value, digits = 2) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const factor = 10 ** digits;
  return Math.round(n * factor) / factor;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value)));
}

function extractJson(text) {
  const raw = String(text || '').trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : raw;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(candidate.slice(start, end + 1)); }
  catch { return null; }
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return results;
}

const RISK_PROFILE_BANDS = {
  conservative: { targetMult: 0.06, stopMult: 0.04, maxWeight: 6, minConfidence: 62 },
  balanced: { targetMult: 0.10, stopMult: 0.06, maxWeight: 10, minConfidence: 55 },
  aggressive: { targetMult: 0.16, stopMult: 0.09, maxWeight: 15, minConfidence: 48 }
};

// ---------------------------------------------------------------------------
// STAGE 1 — SCAN: pull a live research packet for every evaluated symbol.
// Reuses the same market research bundle the Holdings Lab already uses.
// ---------------------------------------------------------------------------
export async function scanSymbols(symbols, { maxLiveSymbols = 24 } = {}) {
  const unique = [...new Set(symbols.map((s) => String(s || '').toUpperCase()).filter(Boolean))];
  const live = new Set(unique.slice(0, maxLiveSymbols));

  const rows = await mapWithConcurrency(unique, 3, async (symbol) => {
    if (!live.has(symbol)) {
      return [symbol, { symbol, agentStatus: 'deferred', dataGaps: ['Live scan deferred for this run.'] }];
    }
    try {
      const bundle = await getResearchBundle(symbol, '1y');
      return [symbol, {
        symbol,
        currentPrice: number(bundle.analytics?.price, number(bundle.research?.quote?.price)),
        priceAsOf: bundle.analytics?.priceAsOf || bundle.research?.quote?.asOf || null,
        name: bundle.research?.name || bundle.research?.companyName || null,
        sector: bundle.research?.sector || null,
        analytics: bundle.analytics,
        quant: bundle.quant,
        chartHistory: downsampleHistory(bundle.chartHistory || bundle.history),
        dataGaps: bundle.dataGaps || [],
        agentStatus: bundle.liveDataAvailable ? 'scanned' : 'fallback'
      }];
    } catch (error) {
      return [symbol, { symbol, agentStatus: 'fallback', dataGaps: [error.message] }];
    }
  });
  return Object.fromEntries(rows);
}

// Reduce a price series to at most ~120 points to keep the stored snapshot small
// while preserving the visible shape for the chart.
function downsampleHistory(history) {
  const points = history?.points;
  if (!Array.isArray(points) || !points.length) return [];
  const max = 120;
  if (points.length <= max) {
    return points.map((p) => ({ date: p.date, close: round(p.close, 4) }));
  }
  const step = points.length / max;
  const out = [];
  for (let i = 0; i < max; i += 1) {
    const p = points[Math.floor(i * step)];
    if (p) out.push({ date: p.date, close: round(p.close, 4) });
  }
  // Always include the final point so the latest price is exact.
  const last = points.at(-1);
  if (last && out.at(-1)?.date !== last.date) out.push({ date: last.date, close: round(last.close, 4) });
  return out;
}

// ---------------------------------------------------------------------------
// STAGE 2 — SIGNALS: derive deterministic technical signals from the packet.
// This grounds the AI so recommendations aren't hallucinated from nothing.
// ---------------------------------------------------------------------------
export function deriveSignals(packet) {
  const signals = [];
  const q = packet.quant || {};
  const a = packet.analytics || {};

  const momentum = String(q.momentumState || '').toLowerCase();
  if (momentum.includes('up') || momentum.includes('strong')) {
    signals.push({ type: 'momentum', label: 'Positive momentum', detail: q.momentumState, bias: 'bullish' });
  } else if (momentum.includes('down') || momentum.includes('weak')) {
    signals.push({ type: 'momentum', label: 'Weak momentum', detail: q.momentumState, bias: 'bearish' });
  }

  const trend = String(q.trendState || a.trend || '').toLowerCase();
  if (trend.includes('up')) signals.push({ type: 'trend', label: 'Uptrend intact', detail: q.trendState || a.trend, bias: 'bullish' });
  else if (trend.includes('down')) signals.push({ type: 'trend', label: 'Downtrend', detail: q.trendState || a.trend, bias: 'bearish' });

  const beta = number(q.estimatedBetaToBenchmark);
  if (beta !== null) {
    signals.push({ type: 'beta', label: `Beta ${round(beta, 2)} vs SPY`, detail: beta > 1.2 ? 'High market sensitivity' : beta < 0.8 ? 'Defensive' : 'Market-like', bias: 'neutral' });
  }

  const vol = number(a.annualizedVolatilityPct);
  if (vol !== null) {
    signals.push({ type: 'volatility', label: `Volatility ${round(vol, 1)}%`, detail: vol > 40 ? 'Elevated' : vol < 18 ? 'Calm' : 'Moderate', bias: 'neutral' });
  }

  const drawdown = number(a.maximumDrawdownPct);
  if (drawdown !== null) {
    signals.push({ type: 'drawdown', label: `Max drawdown ${round(drawdown, 1)}%`, detail: '1-year window', bias: 'neutral' });
  }

  const bullish = signals.filter((s) => s.bias === 'bullish').length;
  const bearish = signals.filter((s) => s.bias === 'bearish').length;
  const netBias = bullish > bearish ? 'bullish' : bearish > bullish ? 'bearish' : 'neutral';
  return { signals, netBias, bullish, bearish };
}

// ---------------------------------------------------------------------------
// STAGE 3 — PLAN: build a deterministic trade plan (entry / target / stop)
// from price + volatility, scaled by risk profile. AI can refine the thesis
// but the numeric levels are computed here so they're always internally sane.
// ---------------------------------------------------------------------------
export function buildTradePlan(packet, { action, riskProfile }) {
  const band = RISK_PROFILE_BANDS[riskProfile] || RISK_PROFILE_BANDS.balanced;
  const price = number(packet.currentPrice);
  if (!price || !['buy', 'add'].includes(action)) return null;

  const volFactor = clamp((number(packet.analytics?.annualizedVolatilityPct, 25)) / 100, 0.12, 0.6);
  const targetPct = band.targetMult * (0.7 + volFactor);
  const stopPct = band.stopMult * (0.7 + volFactor);

  const entryLow = round(price * 0.985, 2);
  const entryHigh = round(price * 1.005, 2);
  const target = round(price * (1 + targetPct), 2);
  const stop = round(price * (1 - stopPct), 2);
  const reward = target - price;
  const risk = price - stop;
  const rr = risk > 0 ? round(reward / risk, 2) : null;

  return {
    referencePrice: round(price, 2),
    entryZoneLow: entryLow,
    entryZoneHigh: entryHigh,
    targetPrice: target,
    stopPrice: stop,
    rrRatio: rr,
    invalidation: `Thesis invalid if price closes below ${stop} on volume.`
  };
}

// ---------------------------------------------------------------------------
// STAGE 4 — RISK: portfolio-level checks (position sizing, concentration,
// cash reserve, volatility). Mirrors the "risk module" in the workflow.
// ---------------------------------------------------------------------------
export function runRiskChecks(candidate, { portfolio, settings }) {
  const checks = [];
  const totalValue = portfolio.totalValue || 0;
  const existing = portfolio.bySymbol[candidate.symbol];
  const existingPct = existing && totalValue ? (existing.value / totalValue) * 100 : 0;
  const suggestedWeight = candidate.suggestedWeightPct ?? 0;
  const band = RISK_PROFILE_BANDS[settings.riskProfile] || RISK_PROFILE_BANDS.balanced;
  const maxWeight = Math.min(settings.maxPositionPct ?? band.maxWeight, band.maxWeight);

  const projectedPct = ['buy', 'add'].includes(candidate.action)
    ? existingPct + suggestedWeight
    : existingPct;

  checks.push({
    name: 'Position size',
    ok: projectedPct <= maxWeight + 0.01,
    detail: `Projected weight ${round(projectedPct, 1)}% vs ${round(maxWeight, 1)}% cap`
  });

  checks.push({
    name: 'Concentration',
    ok: projectedPct <= 25,
    detail: projectedPct > 25 ? 'Single-name concentration is high' : 'Within diversification limits'
  });

  const vol = number(candidate.packet?.analytics?.annualizedVolatilityPct, 25);
  checks.push({
    name: 'Volatility',
    ok: vol <= (settings.riskProfile === 'aggressive' ? 70 : settings.riskProfile === 'balanced' ? 50 : 35),
    detail: `Annualized volatility ${round(vol, 1)}%`
  });

  const confidenceOk = (candidate.confidenceScore ?? 0) >= band.minConfidence;
  checks.push({
    name: 'Conviction floor',
    ok: confidenceOk,
    detail: `Confidence ${round(candidate.confidenceScore ?? 0, 0)} vs floor ${band.minConfidence}`
  });

  const cashReserve = portfolio.cashPct ?? 0;
  if (['buy', 'add'].includes(candidate.action)) {
    checks.push({
      name: 'Cash reserve',
      ok: true,
      detail: `Household cash ~${round(cashReserve, 1)}%; keep ${round(settings.cashReservePct ?? 5, 1)}% buffer`
    });
  }

  const passed = checks.every((c) => c.ok);
  return { checks, passed };
}

// ---------------------------------------------------------------------------
// STAGE 5 — DECISION: ask the configured AI provider to score and write the
// thesis for each candidate, grounded in the deterministic signals + plan.
// Falls back to a deterministic thesis if the provider is mock/unavailable.
// ---------------------------------------------------------------------------
async function generateRecommendationNarrative(candidate, { riskProfile }) {
  const systemPrompt = `You are Nirvana's Trading Desk analyst. You review ONE security using only the structured signals and trade plan provided and return a concise, grounded recommendation. This is decision-support for a human reviewer, never a guarantee or an order to execute. Never invent prices or facts not present in the data. Return JSON ONLY in this exact shape:
{"conviction":"low|medium|high","confidence":0-100,"timeHorizon":"short phrase","thesis":"2-3 sentences grounded in the signals","watchFor":["short risk to monitor"]}`;

  const userMessage = `Security: ${candidate.symbol}${candidate.companyName ? ` (${candidate.companyName})` : ''}
Proposed action: ${candidate.action}
Risk profile: ${riskProfile}
Net signal bias: ${candidate.signalSummary?.netBias}`;

  try {
    const result = await generateAiResponse({
      systemPrompt,
      userMessage,
      context: {
        signals: candidate.signalSummary?.signals || [],
        tradePlan: candidate.tradePlan || null,
        analytics: candidate.packet?.analytics || null,
        quant: candidate.packet?.quant || null,
        dataGaps: candidate.packet?.dataGaps || []
      },
      enableWebSearch: false
    });
    const parsed = extractJson(result.text);
    if (!parsed) throw new Error('Non-JSON analyst response');
    return {
      conviction: ['low', 'medium', 'high'].includes(parsed.conviction) ? parsed.conviction : 'medium',
      confidenceScore: clamp(number(parsed.confidence, 55), 0, 100),
      timeHorizon: String(parsed.timeHorizon || '3-6 months').slice(0, 40),
      thesis: String(parsed.thesis || '').slice(0, 900) || fallbackThesis(candidate),
      watchFor: Array.isArray(parsed.watchFor) ? parsed.watchFor.map(String).slice(0, 3) : [],
      aiGenerated: true
    };
  } catch (error) {
    return { ...deterministicNarrative(candidate), fallbackReason: error.message };
  }
}

function fallbackThesis(candidate) {
  const bias = candidate.signalSummary?.netBias || 'neutral';
  const n = candidate.signalSummary?.signals?.length || 0;
  return `${candidate.symbol} shows a ${bias} net read across ${n} derived signal${n === 1 ? '' : 's'}. Levels are computed from current price and volatility; review against your own conviction before acting.`;
}

function deterministicNarrative(candidate) {
  const bias = candidate.signalSummary?.netBias || 'neutral';
  const base = bias === 'bullish' ? 62 : bias === 'bearish' ? 45 : 52;
  return {
    conviction: bias === 'bullish' ? 'medium' : 'low',
    confidenceScore: base,
    timeHorizon: '3-6 months',
    thesis: fallbackThesis(candidate),
    watchFor: candidate.packet?.dataGaps?.slice(0, 2) || [],
    aiGenerated: false
  };
}

// ---------------------------------------------------------------------------
// Candidate selection: decide a preliminary action per symbol from signals.
// ---------------------------------------------------------------------------
function preliminaryAction({ origin, signalSummary, holdingContext }) {
  const bias = signalSummary.netBias;
  if (origin === 'holding') {
    if (bias === 'bearish') return holdingContext?.unrealizedGainPct > 15 ? 'trim' : 'sell';
    if (bias === 'bullish' && (holdingContext?.weightPct ?? 0) < 8) return 'add';
    return 'hold';
  }
  // watchlist / discovery
  if (bias === 'bullish') return 'buy';
  if (bias === 'bearish') return 'hold';
  return 'new_idea';
}

// ---------------------------------------------------------------------------
// Public entry point: run the full agentic workflow for a household.
// `portfolio` and `watchlist` are supplied by the route from the DB.
// ---------------------------------------------------------------------------
export async function runTradingWorkflow({
  holdings = [],
  watchlist = [],
  discoveryIdeas = [],
  portfolio,
  settings,
  maxLiveSymbols = 24,
  onStage = () => {}
}) {
  const stages = [];
  const record = (key, label, detail) => {
    const entry = { key, label, detail, at: new Date().toISOString() };
    stages.push(entry);
    onStage(entry);
  };

  const riskProfile = settings.riskProfile || 'balanced';

  // Assemble the symbol universe: owned holdings + watchlist + discovery ideas.
  const holdingSymbols = holdings.map((h) => String(h.symbol).toUpperCase());
  const watchSymbols = watchlist.map((w) => String(w.symbol).toUpperCase());
  const discoverySymbols = discoveryIdeas.map((d) => String(d.symbol).toUpperCase());
  const universe = [...new Set([...holdingSymbols, ...watchSymbols, ...discoverySymbols])];

  record('scan', 'Scanning market', `Pulling research packets for ${universe.length} symbol${universe.length === 1 ? '' : 's'}.`);
  const packets = await scanSymbols(universe, { maxLiveSymbols });

  record('signals', 'Deriving signals', 'Computing momentum, trend, beta, volatility and drawdown reads.');

  const originFor = (symbol) => {
    if (holdingSymbols.includes(symbol)) return 'holding';
    if (watchSymbols.includes(symbol)) return 'watchlist';
    return 'discovery';
  };

  const candidates = [];
  for (const symbol of universe) {
    const packet = packets[symbol] || { symbol, agentStatus: 'fallback', dataGaps: ['No packet'] };
    const signalSummary = deriveSignals(packet);
    const origin = originFor(symbol);
    const holdingContext = portfolio.bySymbol[symbol]
      ? {
          weightPct: portfolio.totalValue ? (portfolio.bySymbol[symbol].value / portfolio.totalValue) * 100 : 0,
          unrealizedGainPct: portfolio.bySymbol[symbol].unrealizedGainPct ?? null
        }
      : null;
    const action = preliminaryAction({ origin, signalSummary, holdingContext });

    candidates.push({
      symbol,
      companyName: packet.name || null,
      origin,
      action,
      packet,
      signalSummary,
      holdingContext
    });
  }

  record('plan', 'Building trade plans', 'Setting entry, target, stop and reward:risk for actionable ideas.');
  for (const candidate of candidates) {
    candidate.tradePlan = buildTradePlan(candidate.packet, { action: candidate.action, riskProfile });
    const band = RISK_PROFILE_BANDS[riskProfile] || RISK_PROFILE_BANDS.balanced;
    candidate.suggestedWeightPct = ['buy', 'add'].includes(candidate.action)
      ? round(Math.min(band.maxWeight, settings.maxPositionPct ?? band.maxWeight) / 2, 1)
      : 0;
  }

  record('decision', 'Scoring & writing theses', `Using ${config.ai.provider} to score each candidate.`);
  await mapWithConcurrency(candidates, 2, async (candidate) => {
    const narrative = await generateRecommendationNarrative(candidate, { riskProfile });
    Object.assign(candidate, narrative);
    const risk = runRiskChecks(candidate, { portfolio, settings });
    candidate.riskChecks = risk.checks;
    candidate.riskPassed = risk.passed;
  });

  record('risk', 'Risk gate', 'Applying position-size, concentration, volatility and conviction gates.');

  // Filter: keep holdings advice always; keep new ideas only if they pass risk
  // and clear the conviction floor. Cap new ideas by settings.maxNewIdeas.
  const holdingRecos = candidates.filter((c) => c.origin === 'holding');
  const ideaRecos = candidates
    .filter((c) => c.origin !== 'holding' && c.riskPassed && ['buy', 'add', 'new_idea'].includes(c.action))
    .sort((a, b) => (b.confidenceScore ?? 0) - (a.confidenceScore ?? 0))
    .slice(0, settings.maxNewIdeas ?? 3);

  const finalCandidates = [...holdingRecos, ...ideaRecos];

  record('complete', 'Decision memos ready', `${finalCandidates.length} recommendation${finalCandidates.length === 1 ? '' : 's'} routed to the AI Inbox for human review.`);

  const recommendations = finalCandidates.map((c) => ({
    symbol: c.symbol,
    companyName: c.companyName,
    action: c.action,
    origin: c.origin === 'discovery' ? 'discovery' : c.origin,
    conviction: c.conviction,
    confidenceScore: c.confidenceScore,
    timeHorizon: c.timeHorizon,
    referencePrice: c.tradePlan?.referencePrice ?? c.packet?.currentPrice ?? null,
    entryZoneLow: c.tradePlan?.entryZoneLow ?? null,
    entryZoneHigh: c.tradePlan?.entryZoneHigh ?? null,
    targetPrice: c.tradePlan?.targetPrice ?? null,
    stopPrice: c.tradePlan?.stopPrice ?? null,
    invalidation: c.tradePlan?.invalidation ?? null,
    rrRatio: c.tradePlan?.rrRatio ?? null,
    suggestedWeightPct: c.suggestedWeightPct ?? null,
    thesis: c.thesis,
    signals: c.signalSummary?.signals ?? [],
    riskChecks: c.riskChecks ?? [],
    dataGaps: [...(c.packet?.dataGaps ?? []), ...(c.watchFor ?? [])].slice(0, 4),
    priceHistory: c.packet?.chartHistory ?? [],
    analyticsSnapshot: {
      annualizedVolatilityPct: c.packet?.analytics?.annualizedVolatilityPct ?? null,
      maximumDrawdownPct: c.packet?.analytics?.maximumDrawdownPct ?? null,
      returnsPct: c.packet?.analytics?.returnsPct ?? null,
      fiftyTwoWeekHigh: c.packet?.analytics?.fiftyTwoWeekHigh ?? c.packet?.research?.fiftyTwoWeekHigh ?? null,
      fiftyTwoWeekLow: c.packet?.analytics?.fiftyTwoWeekLow ?? c.packet?.research?.fiftyTwoWeekLow ?? null,
      beta: c.packet?.quant?.estimatedBetaToBenchmark ?? null,
      momentumState: c.packet?.quant?.momentumState ?? null,
      trendState: c.packet?.quant?.trendState ?? null,
      priceAsOf: c.packet?.priceAsOf ?? null
    },
    aiGenerated: c.aiGenerated ?? false
  }));

  return {
    stages,
    symbolsEvaluated: universe.length,
    recommendations,
    riskProfile,
    provider: config.ai.provider,
    model: config.ai.model
  };
}
