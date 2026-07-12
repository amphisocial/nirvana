function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round(value, digits = 2) {
  const multiplier = 10 ** digits;
  return Math.round((number(value) + Number.EPSILON) * multiplier) / multiplier;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, number(value)));
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function normalRandom(random) {
  let u = 0;
  let v = 0;
  while (u === 0) u = random();
  while (v === 0) v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function percentile(sortedValues, p) {
  if (!sortedValues.length) return 0;
  const index = (sortedValues.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sortedValues[lower];
  return sortedValues[lower] + (sortedValues[upper] - sortedValues[lower]) * (index - lower);
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function standardDeviation(values) {
  if (values.length < 2) return 0;
  const mean = average(values);
  const variance = values.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / (values.length - 1);
  return Math.sqrt(Math.max(0, variance));
}

function inferPeriodsPerYear(points = []) {
  if (points.length < 3) return 52;
  const gaps = [];
  for (let index = 1; index < points.length; index += 1) {
    const previous = new Date(`${points[index - 1].date}T00:00:00Z`);
    const current = new Date(`${points[index].date}T00:00:00Z`);
    const days = Math.abs(current - previous) / 86_400_000;
    if (Number.isFinite(days) && days > 0) gaps.push(days);
  }
  gaps.sort((a, b) => a - b);
  const medianDays = gaps[Math.floor(gaps.length / 2)] || 7;
  return medianDays <= 2 ? 252 : medianDays <= 10 ? 52 : 12;
}

export function returnsFromHistory(history) {
  const points = (history?.points || [])
    .filter((point) => Number.isFinite(Number(point.close)))
    .map((point) => ({ date: point.date, close: Number(point.close) }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const returns = [];
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1].close;
    const current = points[index].close;
    if (previous > 0 && current > 0) returns.push({ date: points[index].date, value: current / previous - 1 });
  }
  return { returns, periodsPerYear: inferPeriodsPerYear(points), latestPrice: points.at(-1)?.close ?? null };
}

export function estimatePortfolioMoments(positions, fallback = {}) {
  const valid = positions.filter((position) => position.value > 0);
  const totalValue = valid.reduce((sum, position) => sum + position.value, 0);
  const fallbackReturn = number(fallback.expectedReturn, 0.07);
  const fallbackVolatility = number(fallback.volatility, 0.17);
  if (!totalValue || !valid.length) {
    return {
      expectedReturn: fallbackReturn,
      volatility: fallbackVolatility,
      historicalReturn: null,
      historicalVolatility: null,
      observationCount: 0,
      source: 'Account investment-profile fallback'
    };
  }

  const dateMap = new Map();
  for (const position of valid) {
    const weight = position.value / totalValue;
    for (const row of position.returns || []) {
      const bucket = dateMap.get(row.date) || [];
      bucket.push({ weight, value: row.value });
      dateMap.set(row.date, bucket);
    }
  }

  const portfolioReturns = [...dateMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, rows]) => {
      const availableWeight = rows.reduce((sum, row) => sum + row.weight, 0);
      if (availableWeight <= 0) return null;
      return rows.reduce((sum, row) => sum + row.value * (row.weight / availableWeight), 0);
    })
    .filter((value) => Number.isFinite(value));

  const periodsPerYear = Math.round(average(valid.map((position) => position.periodsPerYear || 52))) || 52;
  if (portfolioReturns.length < 8) {
    return {
      expectedReturn: fallbackReturn,
      volatility: fallbackVolatility,
      historicalReturn: null,
      historicalVolatility: null,
      observationCount: portfolioReturns.length,
      source: 'Insufficient market history; account investment-profile fallback'
    };
  }

  const periodMean = average(portfolioReturns);
  const historicalReturn = ((1 + periodMean) ** periodsPerYear) - 1;
  const historicalVolatility = standardDeviation(portfolioReturns) * Math.sqrt(periodsPerYear);
  // One year of history is noisy. Preserve the signal while shrinking it toward a planning prior.
  const expectedReturn = clamp((historicalReturn * 0.65) + (fallbackReturn * 0.35), -0.15, 0.25);
  const volatility = clamp(historicalVolatility || fallbackVolatility, 0.04, 0.65);

  return {
    expectedReturn,
    volatility,
    historicalReturn,
    historicalVolatility,
    observationCount: portfolioReturns.length,
    source: 'History-informed holdings Monte Carlo with planning-prior shrinkage'
  };
}

export function simulateAccountForecast({
  startingValue,
  annualLinkedCashFlow = 0,
  annualLinkedCashFlows = null,
  expectedReturn,
  volatility,
  horizonYears = 30,
  simulationCount = 1000,
  seed = 20260712
}) {
  const start = Math.max(0, number(startingValue));
  const annualFlow = number(annualLinkedCashFlow);
  const flowTimeline = Array.isArray(annualLinkedCashFlows)
    ? annualLinkedCashFlows.map((value) => number(value))
    : [];
  const mean = clamp(expectedReturn, -0.5, 0.5);
  const sigma = clamp(volatility, 0, 1);
  const years = Math.min(60, Math.max(1, Math.floor(number(horizonYears, 30))));
  const simulations = Math.min(5000, Math.max(250, Math.floor(number(simulationCount, 1000))));
  const balancesByYear = Array.from({ length: years + 1 }, () => []);
  const random = seededRandom(seed);

  for (let run = 0; run < simulations; run += 1) {
    let balance = start;
    balancesByYear[0].push(balance);
    for (let year = 1; year <= years; year += 1) {
      const annualReturn = Math.max(-0.95, mean + sigma * normalRandom(random));
      const flow = flowTimeline[year - 1] ?? annualFlow;
      balance = Math.max(0, balance * (1 + annualReturn) + flow);
      balancesByYear[year].push(balance);
    }
  }

  const timeline = balancesByYear.map((values, year) => {
    values.sort((a, b) => a - b);
    return {
      year,
      p10: round(percentile(values, 0.10)),
      p50: round(percentile(values, 0.50)),
      p90: round(percentile(values, 0.90))
    };
  });

  return {
    startingValue: round(start),
    annualLinkedCashFlow: round(flowTimeline[0] ?? annualFlow),
    linkedCashFlowTimeline: Array.from({ length: years }, (_, index) => round(flowTimeline[index] ?? annualFlow)),
    expectedReturn: mean,
    volatility: sigma,
    horizonYears: years,
    simulationCount: simulations,
    timeline
  };
}

export async function researchHoldingsForForecast(holdings, fallback = {}, options = {}) {
  const { getHistory } = await import('./market/index.js');
  const maxSymbols = Math.min(20, Math.max(1, Number(options.maxSymbols || 12)));
  const dataGaps = [];
  const sorted = [...holdings]
    .map((holding) => ({
      ...holding,
      quantity: number(holding.quantity),
      current_price: number(holding.current_price),
      value: number(holding.quantity) * number(holding.current_price)
    }))
    .sort((a, b) => b.value - a.value);

  const researched = [];
  for (const holding of sorted.slice(0, maxSymbols)) {
    try {
      const history = await getHistory(holding.symbol, '1y');
      const derived = returnsFromHistory(history);
      const price = derived.latestPrice ?? holding.current_price;
      researched.push({
        symbol: holding.symbol,
        quantity: holding.quantity,
        currentPrice: price,
        value: holding.quantity * price,
        returns: derived.returns,
        periodsPerYear: derived.periodsPerYear,
        source: history.source,
        asOf: history.asOf || history.points?.at(-1)?.date || null
      });
    } catch (error) {
      dataGaps.push(`${holding.symbol}: ${error.message}`);
      researched.push({
        symbol: holding.symbol,
        quantity: holding.quantity,
        currentPrice: holding.current_price,
        value: holding.value,
        returns: [],
        periodsPerYear: 52,
        source: 'Saved holding price',
        asOf: holding.price_as_of || null
      });
    }
  }

  for (const holding of sorted.slice(maxSymbols)) {
    dataGaps.push(`${holding.symbol}: not researched because the account exceeds the ${maxSymbols}-symbol market-data limit`);
    researched.push({
      symbol: holding.symbol,
      quantity: holding.quantity,
      currentPrice: holding.current_price,
      value: holding.value,
      returns: [],
      periodsPerYear: 52,
      source: 'Saved holding price',
      asOf: holding.price_as_of || null
    });
  }

  const moments = estimatePortfolioMoments(researched, fallback);
  return { positions: researched, moments, dataGaps };
}
