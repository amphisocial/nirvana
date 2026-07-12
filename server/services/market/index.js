import { config } from '../../config.js';
import { getCached, getCachedStale, setCached } from './cache.js';
import { getMockHistory, getMockQuote, getMockResearch, getMockNews } from './mock.js';
import {
  getAlphaVantageHistory,
  getAlphaVantageQuote,
  getAlphaVantageResearch,
  getAlphaVantageNews
} from './alphavantage.js';
import { calculateMarketAnalytics, calculateQuantDiagnostics, sliceHistoryForRange } from './analytics.js';

const providers = {
  mock: { history: getMockHistory, quote: getMockQuote, research: getMockResearch, news: getMockNews },
  alphavantage: {
    history: getAlphaVantageHistory,
    quote: getAlphaVantageQuote,
    research: getAlphaVantageResearch,
    news: getAlphaVantageNews
  }
};

function provider() {
  const selected = providers[config.market.provider];
  if (!selected) throw new Error(`Unsupported MARKET_DATA_PROVIDER: ${config.market.provider}`);
  return selected;
}

async function cachedCall(key, callback, ttl) {
  try {
    const cached = await getCached(key);
    if (cached) return cached;
  } catch (error) {
    console.warn('Market cache read failed:', error.message);
  }

  try {
    const value = await callback();
    try { await setCached(key, value, ttl); }
    catch (error) { console.warn('Market cache write failed:', error.message); }
    return value;
  } catch (liveError) {
    try {
      const stale = await getCachedStale(key);
      if (stale?.payload) {
        console.warn(`Using stale cache for ${key}:`, liveError.message);
        return { ...stale.payload, stale: true, staleReason: liveError.message };
      }
    } catch (cacheError) {
      console.warn('Stale cache lookup failed:', cacheError.message);
    }
    throw liveError;
  }
}

export function getHistory(symbol, range = '3m') {
  const normalized = symbol.toUpperCase();
  return cachedCall(
    `history:${config.market.provider}:${normalized}:${range}`,
    () => provider().history(normalized, range),
    config.market.cacheMinutes
  );
}

export function getQuote(symbol) {
  const normalized = symbol.toUpperCase();
  return cachedCall(
    `quote:${config.market.provider}:${normalized}`,
    () => provider().quote(normalized),
    Math.min(config.market.cacheMinutes, 15)
  );
}

export function getResearch(symbol) {
  const normalized = symbol.toUpperCase();
  return cachedCall(
    `research:${config.market.provider}:${normalized}`,
    () => provider().research(normalized),
    config.market.researchCacheMinutes
  );
}

export function getNews(symbol) {
  const normalized = symbol.toUpperCase();
  return cachedCall(
    `news:${config.market.provider}:${normalized}`,
    () => provider().news(normalized),
    config.market.newsCacheMinutes
  );
}

async function safely(label, callback, gaps) {
  try { return await callback(); }
  catch (error) {
    gaps.push(`${label}: ${error.message}`);
    return null;
  }
}

export async function getResearchBundle(symbol, chartRange = '1y') {
  const normalized = symbol.toUpperCase();
  const dataGaps = [];

  const history = await safely('One-year price history', () => getHistory(normalized, '1y'), dataGaps);
  const research = await safely('Company fundamentals', () => getResearch(normalized), dataGaps);

  if (research && history?.points?.length) {
    const latest = history.points.at(-1);
    research.quote = {
      symbol: normalized,
      price: latest.close,
      asOf: latest.date,
      source: history.source,
      delayed: true
    };
  }

  const analytics = history ? calculateMarketAnalytics(history, research || {}) : null;
  const chartHistory = history ? sliceHistoryForRange(history, chartRange) : null;

  let benchmark = null;
  let quant = null;
  if (history && normalized !== 'SPY') {
    const benchmarkHistory = await safely(
      'Benchmark-relative quant analysis',
      () => getHistory('SPY', '1y'),
      dataGaps
    );
    if (benchmarkHistory) {
      const benchmarkAnalytics = calculateMarketAnalytics(benchmarkHistory, {});
      benchmark = { symbol: 'SPY', history: benchmarkHistory, analytics: benchmarkAnalytics };
      quant = calculateQuantDiagnostics(history, analytics, benchmarkHistory, benchmarkAnalytics, 'SPY');
    } else {
      quant = calculateQuantDiagnostics(history, analytics, null, null, 'SPY');
    }
  } else if (history) {
    quant = calculateQuantDiagnostics(history, analytics, history, analytics, 'SPY');
  }

  return {
    symbol: normalized,
    provider: config.market.provider,
    isMockData: config.market.provider === 'mock',
    chartRange,
    research,
    analytics,
    quant,
    benchmark,
    history,
    chartHistory,
    news: null,
    dataGaps,
    liveDataAvailable: Boolean(research || history),
    webResearchRequired: !research || !history
  };
}
