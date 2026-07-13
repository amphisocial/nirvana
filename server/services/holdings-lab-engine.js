const SUPPORTED_TYPES = new Set(['brokerage', 'ira', '401k', 'retirement']);

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((number(value) + Number.EPSILON) * factor) / factor;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, number(value)));
}

function annualToMonthly(rate) {
  const safe = clamp(rate, -0.95, 3);
  return (1 + safe) ** (1 / 12) - 1;
}

function monthKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthOffset(value, currentDate) {
  if (!value) return 0;
  const date = value instanceof Date ? value : new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return 0;
  return Math.max(0, (date.getUTCFullYear() - currentDate.getUTCFullYear()) * 12
    + date.getUTCMonth() - currentDate.getUTCMonth());
}

function accountFallbackRate(account, overrides = {}) {
  const direct = overrides?.[account.id];
  if (direct != null && Number.isFinite(Number(direct))) return clamp(Number(direct), -0.5, 1);
  const saved = account.forecast_expected_return ?? account.expected_return;
  if (saved != null && Number.isFinite(Number(saved))) return clamp(Number(saved), -0.5, 1);
  return {
    brokerage: 0.07,
    ira: 0.06,
    '401k': 0.06,
    retirement: 0.06
  }[account.account_type] ?? 0.06;
}

export function classifyHoldingRisk({ analytics, quant, assetClass, symbol }) {
  const volatility = number(analytics?.annualizedVolatilityPct, NaN);
  const drawdown = number(analytics?.maximumDrawdownPct, NaN);
  const beta = number(quant?.estimatedBetaToBenchmark, NaN);
  const klass = String(assetClass || '').toLowerCase();
  const ticker = String(symbol || '').toUpperCase();

  if (Number.isFinite(volatility) || Number.isFinite(drawdown) || Number.isFinite(beta)) {
    if ((Number.isFinite(volatility) && volatility >= 38)
      || (Number.isFinite(drawdown) && drawdown <= -42)
      || (Number.isFinite(beta) && beta >= 1.55)) return 'high';
    if ((Number.isFinite(volatility) && volatility <= 17)
      && (!Number.isFinite(drawdown) || drawdown >= -24)
      && (!Number.isFinite(beta) || beta <= 1.10)) return 'stable';
    return 'low';
  }

  if (/bond|fixed|treasury|money|cash/.test(klass)) return 'stable';
  if (/etf|fund|index/.test(klass) || /^(SPY|VOO|VTI|QQQ|IWM|DIA|BND|AGG)$/.test(ticker)) return 'low';
  if (ticker) return 'high';
  return 'unclassified';
}

export function deriveSymbolPlanningReturn({ analytics, quant }, fallbackRate = 0.07) {
  const oneYear = number(analytics?.returnsPct?.oneYear, NaN);
  const sixMonth = number(analytics?.returnsPct?.sixMonth, NaN);
  const threeMonth = number(analytics?.returnsPct?.threeMonth, NaN);
  const candidates = [];

  if (Number.isFinite(oneYear)) candidates.push(clamp(oneYear / 100, -0.6, 0.8));
  if (Number.isFinite(sixMonth)) candidates.push(clamp((sixMonth / 100) * 2, -0.6, 0.8));
  if (Number.isFinite(threeMonth)) candidates.push(clamp((threeMonth / 100) * 4, -0.6, 0.8));

  if (!candidates.length) return clamp(fallbackRate, -0.25, 0.35);

  const momentumAverage = candidates.reduce((sum, value) => sum + value, 0) / candidates.length;
  let rate = fallbackRate * 0.68 + momentumAverage * 0.32;
  const momentum = quant?.momentumState;
  if (momentum === 'strengthening') rate += 0.01;
  if (momentum === 'weakening') rate -= 0.01;
  return clamp(rate, -0.25, 0.35);
}

function normalizeSelectedTypes(selectedTypes) {
  const requested = Array.isArray(selectedTypes) ? selectedTypes : [];
  const filtered = requested.filter((type) => SUPPORTED_TYPES.has(type));
  return filtered.length ? new Set(filtered) : new Set(SUPPORTED_TYPES);
}

function effectivePrice(holding, symbolAnalysis) {
  const saved = number(holding.current_price, 0);
  if (saved > 0) return { value: saved, source: 'saved quote' };
  const market = number(symbolAnalysis?.currentPrice, 0);
  if (market > 0) return { value: market, source: 'agent quote' };
  const cost = number(holding.cost_basis_per_share, 0);
  if (cost > 0) return { value: cost, source: 'average-cost estimate' };
  return { value: 0, source: 'missing' };
}

function symbolOverrideRate(scenario, symbol, month, fallback) {
  let rate = fallback;
  for (const item of scenario?.symbolReturnOverrides || []) {
    if (String(item.symbol || '').toUpperCase() !== symbol) continue;
    const start = Math.max(0, Math.floor(number(item.startMonth, 0)));
    const end = item.endMonth == null ? Number.POSITIVE_INFINITY : Math.max(start, Math.floor(number(item.endMonth, start)));
    if (month >= start && month <= end) rate = clamp(item.annualReturn, -0.95, 3);
  }
  return rate;
}

function accountOverrideRate(scenario, accountId, month, fallback) {
  let rate = fallback;
  for (const item of scenario?.accountReturnOverrides || []) {
    if (item.accountId && item.accountId !== accountId) continue;
    const start = Math.max(0, Math.floor(number(item.startMonth, 0)));
    const end = item.endMonth == null ? Number.POSITIVE_INFINITY : Math.max(start, Math.floor(number(item.endMonth, start)));
    if (month >= start && month <= end) rate = clamp(item.annualReturn, -0.95, 3);
  }
  return rate;
}

function normalizeAccounts(accounts, selectedTypes, growthOverrides) {
  return (accounts || [])
    .filter((account) => selectedTypes.has(account.account_type))
    .map((account) => ({
      ...account,
      reportedTotal: Math.max(0, number(account.current_balance)),
      fallbackRate: accountFallbackRate(account, growthOverrides)
    }));
}

function buildPositions(accounts, holdings, symbolAnalyses) {
  const accountById = new Map(accounts.map((row) => [row.id, row]));
  const positions = [];

  for (const holding of holdings || []) {
    const account = accountById.get(holding.account_id);
    if (!account) continue;
    const symbol = String(holding.symbol || '').toUpperCase();
    const analysis = symbolAnalyses?.[symbol] || null;
    const price = effectivePrice(holding, analysis);
    const quantity = Math.max(0, number(holding.quantity));
    const currentValue = quantity * price.value;
    const annualReturn = deriveSymbolPlanningReturn(analysis || {}, account.fallbackRate);
    const risk = classifyHoldingRisk({
      analytics: analysis?.analytics,
      quant: analysis?.quant,
      assetClass: holding.asset_class,
      symbol
    });

    positions.push({
      id: holding.id,
      accountId: account.id,
      accountName: account.name,
      accountType: account.account_type,
      symbol,
      name: holding.name || symbol,
      assetClass: holding.asset_class || 'equity',
      quantity,
      price: price.value,
      priceSource: price.source,
      priceAsOf: holding.price_as_of || analysis?.priceAsOf || null,
      currentValue,
      annualReturn,
      risk,
      analytics: analysis?.analytics || null,
      quant: analysis?.quant || null,
      dataGaps: analysis?.dataGaps || []
    });
  }

  return positions;
}

function initializeState(accounts, positions) {
  const byAccount = new Map(accounts.map((account) => [account.id, {
    account,
    positions: new Map(),
    unallocated: 0,
    reportedTotal: account.reportedTotal,
    effectiveTotal: account.reportedTotal,
    knownValue: 0
  }]));

  for (const position of positions) {
    const state = byAccount.get(position.accountId);
    if (!state) continue;
    state.positions.set(position.symbol, {
      ...position,
      quantity: position.quantity,
      price: position.price,
      value: position.currentValue
    });
    state.knownValue += position.currentValue;
  }

  for (const state of byAccount.values()) {
    state.effectiveTotal = Math.max(state.reportedTotal, state.knownValue);
    state.unallocated = Math.max(0, state.effectiveTotal - state.knownValue);
  }

  return byAccount;
}

function cloneState(source) {
  const result = new Map();
  for (const [id, state] of source.entries()) {
    result.set(id, {
      ...state,
      account: { ...state.account },
      positions: new Map([...state.positions.entries()].map(([symbol, position]) => [symbol, { ...position }]))
    });
  }
  return result;
}

function stateTotal(state) {
  return [...state.values()].reduce((total, account) => {
    const positions = [...account.positions.values()].reduce((sum, row) => sum + row.quantity * row.price, 0);
    return total + positions + account.unallocated;
  }, 0);
}

function accountTotal(accountState) {
  const positions = [...accountState.positions.values()].reduce((sum, row) => sum + row.quantity * row.price, 0);
  return positions + accountState.unallocated;
}

function applyGrowth(state, month, scenario = null) {
  for (const accountState of state.values()) {
    const accountRate = scenario
      ? accountOverrideRate(scenario, accountState.account.id, month, accountState.account.fallbackRate)
      : accountState.account.fallbackRate;
    if (accountState.unallocated > 0) {
      accountState.unallocated *= 1 + annualToMonthly(accountRate);
    }

    for (const position of accountState.positions.values()) {
      const annualRate = scenario
        ? symbolOverrideRate(scenario, position.symbol, month, position.annualReturn)
        : position.annualReturn;
      position.price *= 1 + annualToMonthly(annualRate);
    }
  }
}

function findTradeAccount(state, trade) {
  if (trade.accountId && state.has(trade.accountId)) return state.get(trade.accountId);
  const byName = [...state.values()].find((row) => String(row.account.name).toLowerCase() === String(trade.accountName || '').toLowerCase());
  if (byName) return byName;
  return [...state.values()].find((row) => row.account.account_type === 'brokerage') || [...state.values()][0] || null;
}

function fundInternalBuy(accountState, amount, excludeSymbol) {
  let remaining = Math.max(0, amount);
  const cashTake = Math.min(accountState.unallocated, remaining);
  accountState.unallocated -= cashTake;
  remaining -= cashTake;

  if (remaining > 0) {
    const donors = [...accountState.positions.values()]
      .filter((row) => row.symbol !== excludeSymbol && row.quantity * row.price > 0);
    const donorValue = donors.reduce((sum, row) => sum + row.quantity * row.price, 0);
    if (donorValue > 0) {
      const requested = Math.min(remaining, donorValue);
      for (const donor of donors) {
        const value = donor.quantity * donor.price;
        const sale = requested * (value / donorValue);
        donor.quantity = Math.max(0, donor.quantity - sale / Math.max(0.000001, donor.price));
      }
      remaining -= requested;
    }
  }

  if (remaining > 0) accountState.unallocated -= remaining;
  return remaining;
}

function applyTrade(state, trade, events) {
  const accountState = findTradeAccount(state, trade);
  if (!accountState) {
    events.push(`Skipped ${trade.action || 'trade'}: no selected investment account was available.`);
    return 0;
  }

  const symbol = String(trade.symbol || '').toUpperCase();
  if (!symbol) return 0;
  let position = accountState.positions.get(symbol);
  const referencePrice = Math.max(0.000001, number(position?.price, number(trade.referencePrice, 1)));
  const requestedAmount = trade.amount != null
    ? Math.max(0, number(trade.amount))
    : Math.max(0, number(trade.quantity)) * referencePrice;
  if (!(requestedAmount > 0)) return 0;

  if (String(trade.action).toLowerCase() === 'sell') {
    if (!position) {
      events.push(`Could not sell ${symbol}: the symbol was not in ${accountState.account.name}.`);
      return requestedAmount;
    }
    const available = position.quantity * position.price;
    const sold = Math.min(available, requestedAmount);
    position.quantity = Math.max(0, position.quantity - sold / Math.max(0.000001, position.price));
    accountState.unallocated += sold;
    const gap = Math.max(0, requestedAmount - sold);
    events.push(`${accountState.account.name}: sold ${symbol} for ${round(sold)}${gap ? `; unavailable amount ${round(gap)}` : ''}.`);
    return gap;
  }

  if (!position) {
    position = {
      id: `scenario:${accountState.account.id}:${symbol}`,
      accountId: accountState.account.id,
      accountName: accountState.account.name,
      accountType: accountState.account.account_type,
      symbol,
      name: symbol,
      assetClass: 'equity',
      quantity: 0,
      price: referencePrice,
      priceSource: 'scenario reference',
      currentValue: 0,
      annualReturn: number(trade.annualReturn, accountState.account.fallbackRate),
      risk: 'unclassified',
      analytics: null,
      quant: null,
      dataGaps: []
    };
    accountState.positions.set(symbol, position);
  }

  const funding = String(trade.funding || 'internal').toLowerCase();
  let gap = 0;
  if (funding === 'external') {
    // External hypothetical capital intentionally increases the portfolio total.
  } else {
    gap = fundInternalBuy(accountState, requestedAmount, symbol);
  }
  position.quantity += requestedAmount / Math.max(0.000001, position.price);
  events.push(`${accountState.account.name}: bought ${symbol} for ${round(requestedAmount)}${gap ? `; funding gap ${round(gap)}` : ''}.`);
  return gap;
}

function applyTrades(state, trades, month, events) {
  let fundingGap = 0;
  for (const trade of trades || []) {
    if (Math.floor(number(trade.monthOffset, 0)) !== month) continue;
    fundingGap += applyTrade(state, trade, events);
  }
  return fundingGap;
}

function accountSnapshot(state, month, currentDate) {
  const date = new Date(Date.UTC(currentDate.getUTCFullYear(), currentDate.getUTCMonth() + month, 1));
  const accounts = {};
  for (const [id, accountState] of state.entries()) accounts[id] = round(accountTotal(accountState));
  return {
    month,
    monthKey: monthKey(date),
    label: month === 0 ? 'Current' : date.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' }),
    total: round(stateTotal(state)),
    accounts
  };
}

function simulate(initialState, scenario, horizonMonths, currentDate) {
  const state = cloneState(initialState);
  const timeline = [];
  const events = [];
  let fundingGap = 0;

  for (let month = 0; month <= horizonMonths; month += 1) {
    const monthEvents = [];
    if (scenario) fundingGap += applyTrades(state, scenario.trades, month, monthEvents);
    const snapshot = accountSnapshot(state, month, currentDate);
    snapshot.events = [...monthEvents];
    if (monthEvents.length) events.push({ month, label: snapshot.label, items: monthEvents });
    timeline.push(snapshot);
    if (month < horizonMonths) applyGrowth(state, month, scenario);
  }

  return { timeline, events, fundingGap: round(fundingGap) };
}

function riskAllocation(positions, total, unallocated = 0) {
  const buckets = { high: 0, low: 0, stable: 0, unclassified: 0, unallocated: Math.max(0, number(unallocated)) };
  for (const position of positions) buckets[position.risk] = (buckets[position.risk] || 0) + position.currentValue;
  return Object.entries(buckets).map(([risk, value]) => ({
    risk,
    value: round(value),
    percent: total > 0 ? round(value / total * 100, 1) : 0
  }));
}

function concentration(positions, total) {
  return [...positions]
    .sort((a, b) => b.currentValue - a.currentValue)
    .slice(0, 10)
    .map((position) => ({
      symbol: position.symbol,
      accountName: position.accountName,
      value: round(position.currentValue),
      percent: total > 0 ? round(position.currentValue / total * 100, 1) : 0,
      risk: position.risk
    }));
}

function accountForecasts(accounts, baseline, alternative, initialState) {
  const points = [0, 12, 24, 36];
  return accounts.map((account) => {
    const state = initialState.get(account.id);
    return {
      id: account.id,
      name: account.name,
      accountType: account.account_type,
      reportedTotal: round(account.reportedTotal),
      knownHoldingsValue: round(state?.knownValue),
      unallocatedValue: round(state?.unallocated),
      coveragePct: state?.effectiveTotal > 0 ? round(state.knownValue / state.effectiveTotal * 100, 1) : 0,
      fallbackAnnualReturn: round(account.fallbackRate * 100, 2),
      baseline: points.map((month) => baseline.timeline[Math.min(month, baseline.timeline.length - 1)]?.accounts?.[account.id] || 0),
      scenario: points.map((month) => alternative.timeline[Math.min(month, alternative.timeline.length - 1)]?.accounts?.[account.id] || 0)
    };
  });
}

function deterministicInsights({ positions, risk, concentrationRows, accounts, total, unallocated }) {
  const insights = [];
  const top = concentrationRows[0];
  const highRisk = risk.find((row) => row.risk === 'high')?.percent || 0;
  const coverage = total > 0 ? ((total - unallocated) / total) * 100 : 0;

  if (top && top.percent >= 20) insights.push(`${top.symbol} is the largest modeled position at ${top.percent.toFixed(1)}% of the selected portfolio.`);
  if (highRisk >= 35) insights.push(`${highRisk.toFixed(1)}% of modeled holdings fall in the high-risk bucket based on volatility, drawdown, and beta diagnostics.`);
  if (coverage < 90) insights.push(`${coverage.toFixed(1)}% of the selected account value is represented by priced holdings; the remainder uses account-level growth assumptions.`);
  if (accounts.length > 1) insights.push(`The forecast combines ${accounts.length} selected investment accounts while preserving each account's own fallback return.`);
  if (!positions.length) insights.push('No priced holdings were available, so the forecast uses account-level growth assumptions only.');
  return insights.slice(0, 5);
}

export function buildHoldingsLabProjection({
  accounts = [],
  holdings = [],
  symbolAnalyses = {},
  selectedTypes = [],
  growthOverrides = {},
  scenario = null,
  horizonMonths = 36,
  currentDate = new Date()
}) {
  const selectedTypeSet = normalizeSelectedTypes(selectedTypes);
  const selectedAccounts = normalizeAccounts(accounts, selectedTypeSet, growthOverrides);
  const positions = buildPositions(selectedAccounts, holdings, symbolAnalyses);
  const initialState = initializeState(selectedAccounts, positions);
  const baseline = simulate(initialState, null, horizonMonths, currentDate);
  const alternative = simulate(initialState, scenario, horizonMonths, currentDate);
  const currentTotal = baseline.timeline[0]?.total || 0;
  const knownValue = [...initialState.values()].reduce((sum, row) => sum + row.knownValue, 0);
  const unallocated = [...initialState.values()].reduce((sum, row) => sum + row.unallocated, 0);
  const risk = riskAllocation(positions, currentTotal, unallocated);
  const concentrationRows = concentration(positions, currentTotal);
  const baselineEnd = baseline.timeline.at(-1)?.total || 0;
  const scenarioEnd = alternative.timeline.at(-1)?.total || 0;

  return {
    selectedTypes: [...selectedTypeSet],
    horizonMonths,
    accounts: accountForecasts(selectedAccounts, baseline, alternative, initialState),
    holdings: positions.map((position) => ({
      ...position,
      currentValue: round(position.currentValue),
      annualReturnPct: round(position.annualReturn * 100, 2)
    })),
    baseline,
    alternative,
    riskAllocation: risk,
    concentration: concentrationRows,
    insights: deterministicInsights({
      positions,
      risk,
      concentrationRows,
      accounts: selectedAccounts,
      total: currentTotal,
      unallocated
    }),
    metrics: {
      selectedAccountTotal: round(currentTotal),
      knownHoldingsValue: round(knownValue),
      unallocatedValue: round(unallocated),
      holdingsCoveragePct: currentTotal > 0 ? round(knownValue / currentTotal * 100, 1) : 0,
      baselineThreeYearValue: round(baselineEnd),
      scenarioThreeYearValue: round(scenarioEnd),
      scenarioThreeYearChange: round(scenarioEnd - baselineEnd),
      scenarioFundingGap: alternative.fundingGap,
      analyzedSymbols: Object.keys(symbolAnalyses || {}).length,
      holdingCount: positions.length
    },
    scenario: scenario || {
      title: 'Current plan',
      summary: 'No hypothetical trade or return change is applied.',
      trades: [],
      symbolReturnOverrides: [],
      accountReturnOverrides: [],
      notes: []
    }
  };
}

export function normalizeScenarioDates(scenario, currentDate = new Date()) {
  return {
    ...scenario,
    trades: (scenario?.trades || []).map((trade) => ({
      ...trade,
      monthOffset: trade.monthOffset == null ? monthOffset(trade.date, currentDate) : Math.max(0, Math.floor(number(trade.monthOffset)))
    }))
  };
}

export const holdingsLabInternals = {
  accountFallbackRate,
  annualToMonthly,
  effectivePrice,
  monthOffset
};
