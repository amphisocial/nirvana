import { config } from '../../config.js';
import { getCached, setCached } from './cache.js';
import { getMockHistory, getMockQuote, getMockResearch } from './mock.js';
import { getAlphaVantageHistory, getAlphaVantageQuote, getAlphaVantageResearch } from './alphavantage.js';

const providers = {
  mock: {
    history: getMockHistory,
    quote: getMockQuote,
    research: getMockResearch
  },
  alphavantage: {
    history: getAlphaVantageHistory,
    quote: getAlphaVantageQuote,
    research: getAlphaVantageResearch
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
  return cachedCall(`research:${config.market.provider}:${normalized}`, () => provider().research(normalized), 720);
}
