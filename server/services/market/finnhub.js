import { config } from '../../config.js';

// ---------------------------------------------------------------------------
// Finnhub provider (https://finnhub.io).
//
// Free tier (60 req/min): /quote, /stock/profile2, /stock/metric, /company-news.
// Historical candles (/stock/candle) are premium-only as of 2025; when they're
// unavailable we synthesize a minimal single-point history from the live quote
// and 52-week range in /stock/metric so downstream analytics still function and
// the Trading Desk keeps working when Alpha Vantage is rate-limited.
// ---------------------------------------------------------------------------

const BASE_URL = 'https://finnhub.io/api/v1';
const MIN_REQUEST_GAP_MS = 1100;             // ~55/min, safely under the 60/min cap
const RATE_LIMIT_COOLDOWN_MS = 60 * 1000;    // pause 60s after a 429
let requestChain = Promise.resolve();
let lastRequestAt = 0;
let blockedUntil = 0;

// Test-only: clear the rate-limit pause between unit tests.
export function __resetFinnhubRateLimitForTests() { blockedUntil = 0; lastRequestAt = 0; }

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function numberOrNull(value) {
  if (value === undefined || value === null || value === '' || value === 'None') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function performRequest(pathname, params = {}) {
  if (!config.market.finnhubApiKey) throw new Error('FINNHUB_API_KEY is not configured');
  if (Date.now() < blockedUntil) throw new Error('Finnhub is temporarily paused after a rate-limit response');

  const waitMs = Math.max(0, MIN_REQUEST_GAP_MS - (Date.now() - lastRequestAt));
  if (waitMs) await sleep(waitMs);

  const url = new URL(`${BASE_URL}${pathname}`);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) url.searchParams.set(key, value);
  });
  url.searchParams.set('token', config.market.finnhubApiKey);

  lastRequestAt = Date.now();
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Nirvana/1.0', 'X-Finnhub-Token': config.market.finnhubApiKey },
    signal: AbortSignal.timeout(15000)
  });

  if (response.status === 429) {
    blockedUntil = Date.now() + RATE_LIMIT_COOLDOWN_MS;
    throw new Error('Finnhub rate limit reached (HTTP 429)');
  }
  if (response.status === 401 || response.status === 403) {
    throw new Error('Finnhub rejected the API key (check FINNHUB_API_KEY and plan access)');
  }
  if (!response.ok) throw new Error(`Finnhub request failed with HTTP ${response.status}`);

  const data = await response.json();
  if (data && typeof data === 'object' && data.error) {
    if (/limit/i.test(data.error)) blockedUntil = Date.now() + RATE_LIMIT_COOLDOWN_MS;
    throw new Error(`Finnhub: ${data.error}`);
  }
  return data;
}

// Serialize requests so the min-gap spacing is honored across concurrent calls.
function request(pathname, params) {
  const operation = requestChain.then(() => performRequest(pathname, params));
  requestChain = operation.catch(() => undefined);
  return operation;
}

function resolutionForRange(range) {
  // Free-ish granularity choices; premium candle access respects these.
  if (range === '3m') return { resolution: 'D', months: 3 };
  if (range === '6m') return { resolution: 'D', months: 6 };
  if (range === 'ytd') return { resolution: 'D', months: null, ytd: true };
  return { resolution: 'W', months: 12 };
}

function rangeStartEpoch(range) {
  const start = new Date();
  if (range === '3m') start.setMonth(start.getMonth() - 3);
  else if (range === '6m') start.setMonth(start.getMonth() - 6);
  else if (range === 'ytd') start.setMonth(0, 1);
  else start.setFullYear(start.getFullYear() - 1);
  return Math.floor(start.getTime() / 1000);
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------
function candleCountForRange(range) {
  // Daily bars: enough to cover the window with headroom.
  if (range === '3m') return 70;
  if (range === '6m') return 130;
  if (range === 'ytd') return 260;
  return 260; // 1y of trading days
}

function parseCandles(data, normalized, range, resolution) {
  if (!data || data.s !== 'ok' || !Array.isArray(data.c) || !data.c.length || !Array.isArray(data.t)) {
    return null;
  }
  const points = data.t
    .map((epoch, i) => ({
      date: new Date(epoch * 1000).toISOString().slice(0, 10),
      close: Number(data.c[i])
    }))
    .filter((p) => Number.isFinite(p.close))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!points.length) return null;
  return {
    symbol: normalized,
    range,
    points,
    source: `Finnhub ${resolution === 'W' ? 'weekly' : resolution === 'M' ? 'monthly' : 'daily'} candles`,
    delayed: true,
    asOf: points.at(-1)?.date || null
  };
}

export async function getFinnhubHistory(symbol, range = '3m') {
  const normalized = symbol.toUpperCase();
  const { resolution } = resolutionForRange(range);
  const from = rangeStartEpoch(range);
  const to = Math.floor(Date.now() / 1000);

  let candleError = null;

  // Attempt 1: count-based daily candles. This form is the most reliable on the
  // free tier (works where from/to date ranges sometimes 403 or return no_data).
  try {
    const data = await request('/stock/candle', {
      symbol: normalized, resolution: 'D', count: candleCountForRange(range)
    });
    const parsed = parseCandles(data, normalized, range, 'D');
    if (parsed) return parsed;
    if (data && data.s === 'no_data') candleError = new Error('Finnhub returned no candle data');
  } catch (error) {
    candleError = error;
  }

  // Attempt 2: explicit from/to range at the range-appropriate resolution.
  try {
    const data = await request('/stock/candle', { symbol: normalized, resolution, from, to });
    const parsed = parseCandles(data, normalized, range, resolution);
    if (parsed) return parsed;
    if (data && data.s === 'no_data') candleError = new Error('Finnhub returned no candle data');
  } catch (error) {
    candleError = error;
  }

  // Attempt 3 (last resort): synthesize a minimal series from quote + 52-week
  // metrics so basic analytics can still run, clearly flagged as synthesized.
  const synthesized = await synthesizeHistoryFromMetrics(normalized, range);
  if (synthesized) return synthesized;

  throw candleError || new Error(`No historical data available for ${normalized} from Finnhub`);
}

async function synthesizeHistoryFromMetrics(symbol, range) {
  try {
    const [quote, metricResp] = await Promise.all([
      request('/quote', { symbol }),
      request('/stock/metric', { symbol, metric: 'all' }).catch(() => null)
    ]);
    const current = numberOrNull(quote?.c);
    if (!current) return null;

    const m = metricResp?.metric || {};
    const yearLow = numberOrNull(m['52WeekLow']);
    const yearHigh = numberOrNull(m['52WeekHigh']);
    // Estimate a start-of-window price from the 52-week return if present.
    const yearReturnPct = numberOrNull(m['52WeekPriceReturnDaily'] ?? m['52WeekPriceReturn']);
    let startClose = null;
    if (yearReturnPct !== null && (1 + yearReturnPct / 100) !== 0) {
      startClose = current / (1 + yearReturnPct / 100);
    } else if (yearLow && yearHigh) {
      startClose = (yearLow + yearHigh) / 2;
    }
    if (!startClose || !Number.isFinite(startClose)) startClose = current;

    const startDate = new Date(rangeStartEpoch(range) * 1000).toISOString().slice(0, 10);
    const today = new Date().toISOString().slice(0, 10);
    const points = [
      { date: startDate, close: Number(startClose.toFixed(4)) },
      { date: today, close: Number(current.toFixed(4)) }
    ];
    // Include 52-week extremes as interior points so volatility/drawdown have signal.
    if (yearLow && yearLow < Math.min(startClose, current)) {
      points.splice(1, 0, { date: startDate, close: yearLow });
    }
    if (yearHigh && yearHigh > Math.max(startClose, current)) {
      points.splice(1, 0, { date: today, close: yearHigh });
    }
    points.sort((a, b) => a.date.localeCompare(b.date));

    return {
      symbol,
      range,
      points,
      source: 'Finnhub quote + 52-week metrics (synthesized; candles require a premium plan)',
      delayed: true,
      synthesized: true,
      asOf: today
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Quote
// ---------------------------------------------------------------------------
export async function getFinnhubQuote(symbol) {
  const normalized = symbol.toUpperCase();
  const data = await request('/quote', { symbol: normalized });
  const price = numberOrNull(data?.c);
  if (!price) throw new Error(`No quote returned for ${normalized}`);
  return {
    symbol: normalized,
    price,
    asOf: data.t ? new Date(data.t * 1000).toISOString().slice(0, 10) : null,
    source: 'Finnhub quote',
    delayed: true
  };
}

// ---------------------------------------------------------------------------
// Research (company profile + fundamental metrics)
// ---------------------------------------------------------------------------
export async function getFinnhubResearch(symbol) {
  const normalized = symbol.toUpperCase();
  const [profile, metricResp] = await Promise.all([
    request('/stock/profile2', { symbol: normalized }),
    request('/stock/metric', { symbol: normalized, metric: 'all' }).catch(() => null)
  ]);

  if ((!profile || !profile.name) && !metricResp) {
    throw new Error(`No company profile returned for ${normalized}`);
  }
  const m = metricResp?.metric || {};

  return {
    symbol: normalized,
    companyName: profile?.name || normalized,
    description: profile?.finnhubIndustry ? `${profile.name} — ${profile.finnhubIndustry}` : (profile?.name || ''),
    exchange: profile?.exchange || null,
    currency: profile?.currency || null,
    country: profile?.country || null,
    sector: profile?.finnhubIndustry || null,
    industry: profile?.finnhubIndustry || null,
    fiscalYearEnd: null,
    latestQuarter: null,
    marketCapitalization: numberOrNull(profile?.marketCapitalization) !== null
      ? numberOrNull(profile.marketCapitalization) * 1_000_000  // Finnhub returns millions
      : null,
    ebitda: null,
    peRatio: numberOrNull(m.peBasicExclExtraTTM ?? m.peTTM ?? m.peInclExtraTTM),
    forwardPe: numberOrNull(m.forwardPE),
    pegRatio: numberOrNull(m.pegRatio ?? m.pegTTM),
    priceToSales: numberOrNull(m.psTTM ?? m.psAnnual),
    priceToBook: numberOrNull(m.pbQuarterly ?? m.pbAnnual),
    evToRevenue: numberOrNull(m['currentEv/freeCashFlowTTM']),
    evToEbitda: numberOrNull(m['ev/ebitdaTTM']),
    eps: numberOrNull(m.epsBasicExclExtraItemsTTM ?? m.epsTTM),
    dilutedEpsTtm: numberOrNull(m.epsInclExtraItemsTTM ?? m.epsTTM),
    revenueTtm: numberOrNull(m.revenueTTM),
    grossProfitTtm: numberOrNull(m.grossMarginTTM),
    revenuePerShareTtm: numberOrNull(m.revenuePerShareTTM),
    profitMargin: numberOrNull(m.netProfitMarginTTM),
    operatingMarginTtm: numberOrNull(m.operatingMarginTTM),
    returnOnAssetsTtm: numberOrNull(m.roaTTM),
    returnOnEquityTtm: numberOrNull(m.roeTTM),
    quarterlyRevenueGrowthYoy: numberOrNull(m.revenueGrowthTTMYoy),
    quarterlyEarningsGrowthYoy: numberOrNull(m.epsGrowthTTMYoy),
    dividendPerShare: numberOrNull(m.dividendPerShareTTM ?? m.dividendPerShareAnnual),
    dividendYield: numberOrNull(m.dividendYieldIndicatedAnnual ?? m.currentDividendYieldTTM),
    beta: numberOrNull(m.beta),
    sharesOutstanding: numberOrNull(profile?.shareOutstanding) !== null
      ? numberOrNull(profile.shareOutstanding) * 1_000_000
      : null,
    analystTargetPrice: null,
    analystRatings: { strongBuy: null, buy: null, hold: null, sell: null, strongSell: null },
    fiftyTwoWeekHigh: numberOrNull(m['52WeekHigh']),
    fiftyTwoWeekLow: numberOrNull(m['52WeekLow']),
    fiftyDayMovingAverage: numberOrNull(m['50DayAverage'] ?? m.priceRelativeToS_P50052Week),
    twoHundredDayMovingAverage: numberOrNull(m['200DayAverage']),
    quote: null,
    source: 'Finnhub company profile + metrics'
  };
}

// ---------------------------------------------------------------------------
// News
// ---------------------------------------------------------------------------
export async function getFinnhubNews(symbol) {
  const normalized = symbol.toUpperCase();
  try {
    const to = new Date().toISOString().slice(0, 10);
    const from = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);
    const data = await request('/company-news', { symbol: normalized, from, to });
    const articles = Array.isArray(data)
      ? data.slice(0, config.market.newsLimit).map((a) => ({
          title: a.headline,
          summary: a.summary,
          url: a.url,
          source: a.source,
          publishedAt: a.datetime ? new Date(a.datetime * 1000).toISOString() : null
        }))
      : [];
    return { symbol: normalized, articles, source: 'Finnhub company news', asOf: to };
  } catch {
    return { symbol: normalized, articles: [], source: 'Finnhub company news', asOf: null };
  }
}
