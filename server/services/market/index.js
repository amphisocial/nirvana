import { config } from '../../config.js';
import { getCached, setCached } from './cache.js';
import { getMockHistory, getMockQuote, getMockResearch, getMockNews } from './mock.js';
import {
  getAlphaVantageHistory,
  getAlphaVantageQuote,
  getAlphaVantageResearch,
  getAlphaVantageNews
} from './alphavantage.js';
import { calculateMarketAnalytics, calculateQuantDiagnostics, sliceHistoryForRange } from './analytics.js';

const providers = {
  mock: {
    history: getMockHistory,
    quote: getMockQuote,
    research: getMockResearch,
    news: getMockNews
  },
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
    console.warn('Market cache read failed; continuing without cache:', error.message);
  }
  const value = await callback();
  try {
    await setCached(key, value, ttl);
  } catch (error) {
    console.warn('Market cache write failed:', error.message);
  }
  return value;
}

export function getHistory(symbol, range = '3m') {
  const normalized = symbol.toUpperCase();
  return cachedCall(`history:${config.market.provider}:${normalized}:${range}`, () => provider().history(normalized, range), config.market.cacheMinutes);
}

export function getQuote(symbol) {
  const normalized = symbol.toUpperCase();
  return cachedCall(`quote:${config.market.provider}:${normalized}`, () => provider().quote(normalized), Math.min(config.market.cacheMinutes, 15));
}

export function getResearch(symbol) {
  const normalized = symbol.toUpperCase();
  return cachedCall(`research:${config.market.provider}:${normalized}`, () => provider().research(normalized), config.market.researchCacheMinutes);
}

export function getNews(symbol) {
  const normalized = symbol.toUpperCase();
  return cachedCall(`news:${config.market.provider}:${normalized}`, () => provider().news(normalized), config.market.newsCacheMinutes);
}

function settledValue(result, label, gaps) {
  if (result.status === 'fulfilled') return result.value;
  gaps.push(`${label}: ${result.reason?.message || 'unavailable'}`);
  return null;
}

export async function getResearchBundle(symbol, chartRange = '1y') {
  const normalized = symbol.toUpperCase();
  const [researchResult, historyResult, newsResult] = await Promise.allSettled([
    getResearch(normalized),
    getHistory(normalized, '1y'),
    getNews(normalized)
  ]);
  const dataGaps = [];
  const research = settledValue(researchResult, 'Company fundamentals and quote', dataGaps);
  const history = settledValue(historyResult, 'One-year price history', dataGaps);
  const news = settledValue(newsResult, 'Recent company news', dataGaps);

  if (!research && !history) {
    throw new Error(`No live research data could be retrieved for ${normalized}. ${dataGaps.join(' ')}`);
  }

  const analytics = history ? calculateMarketAnalytics(history, research || {}) : null;
  const chartHistory = history ? sliceHistoryForRange(history, chartRange) : null;
  let benchmark = null;
  let quant = null;
  if (history && normalized !== 'SPY') {
    try {
      const benchmarkHistory = await getHistory('SPY', '1y');
      const benchmarkAnalytics = calculateMarketAnalytics(benchmarkHistory, {});
      benchmark = { symbol: 'SPY', history: benchmarkHistory, analytics: benchmarkAnalytics };
      quant = calculateQuantDiagnostics(history, analytics, benchmarkHistory, benchmarkAnalytics, 'SPY');
    } catch (error) {
      dataGaps.push(`Benchmark-relative quant analysis: ${error.message}`);
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
    news,
    dataGaps
  };
}
