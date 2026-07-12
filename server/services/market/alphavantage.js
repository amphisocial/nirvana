import { config } from '../../config.js';

const BASE_URL = 'https://www.alphavantage.co/query';
const MIN_REQUEST_GAP_MS = 1200;
const RATE_LIMIT_COOLDOWN_MS = 15 * 60 * 1000;
let requestChain = Promise.resolve();
let lastRequestAt = 0;
let blockedUntil = 0;

function numberOrNull(value) {
  if (value === undefined || value === null || value === '' || value === 'None' || value === '-') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function performRequest(params) {
  if (!config.market.alphaVantageApiKey) throw new Error('ALPHAVANTAGE_API_KEY is not configured');
  if (Date.now() < blockedUntil) throw new Error('Alpha Vantage is temporarily paused after a rate-limit response');

  const waitMs = Math.max(0, MIN_REQUEST_GAP_MS - (Date.now() - lastRequestAt));
  if (waitMs) await sleep(waitMs);

  const url = new URL(BASE_URL);
  Object.entries({ ...params, apikey: config.market.alphaVantageApiKey })
    .forEach(([key, value]) => url.searchParams.set(key, value));

  lastRequestAt = Date.now();
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Nirvana/0.4' },
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error(`Alpha Vantage request failed with HTTP ${response.status}`);

  const data = await response.json();
  const providerMessage = data.Note || data.Information || data['Error Message'];
  if (providerMessage) {
    if (/rate limit|spreading out|premium plans|frequency|call volume/i.test(providerMessage)) {
      blockedUntil = Date.now() + RATE_LIMIT_COOLDOWN_MS;
    }
    throw new Error(providerMessage);
  }
  return data;
}

function request(params) {
  const operation = requestChain.then(() => performRequest(params));
  requestChain = operation.catch(() => undefined);
  return operation;
}

function startForRange(range) {
  const start = new Date();
  if (range === '3m') start.setMonth(start.getMonth() - 3);
  else if (range === '6m') start.setMonth(start.getMonth() - 6);
  else if (range === 'ytd') start.setMonth(0, 1);
  else start.setFullYear(start.getFullYear() - 1);
  return start.toISOString().slice(0, 10);
}

export async function getAlphaVantageHistory(symbol, range = '3m') {
  const normalized = symbol.toUpperCase();
  const useDaily = range === '3m';
  const functionName = useDaily ? 'TIME_SERIES_DAILY' : 'TIME_SERIES_WEEKLY';
  const data = await request({ function: functionName, symbol: normalized, outputsize: 'compact' });
  const seriesKey = useDaily ? 'Time Series (Daily)' : 'Weekly Time Series';
  const series = data[seriesKey];
  if (!series) throw new Error(`No historical data returned for ${normalized}`);

  const start = startForRange(range);
  const points = Object.entries(series)
    .filter(([date]) => date >= start)
    .map(([date, values]) => ({ date, close: Number(values['4. close']) }))
    .filter((point) => Number.isFinite(point.close))
    .sort((a, b) => a.date.localeCompare(b.date));

  if (!points.length) throw new Error(`No usable historical points returned for ${normalized}`);
  return {
    symbol: normalized,
    range,
    points,
    source: `Alpha Vantage ${useDaily ? 'daily' : 'weekly'} price history`,
    delayed: true,
    asOf: points.at(-1)?.date || null
  };
}

export async function getAlphaVantageQuote(symbol) {
  const normalized = symbol.toUpperCase();
  const data = await request({ function: 'GLOBAL_QUOTE', symbol: normalized });
  const quote = data['Global Quote'];
  if (!quote || !quote['05. price']) throw new Error(`No quote returned for ${normalized}`);
  return {
    symbol: normalized,
    price: numberOrNull(quote['05. price']),
    asOf: quote['07. latest trading day'] || null,
    source: 'Alpha Vantage Global Quote',
    delayed: true
  };
}

export async function getAlphaVantageResearch(symbol) {
  const normalized = symbol.toUpperCase();
  const overview = await request({ function: 'OVERVIEW', symbol: normalized });
  if (!overview?.Symbol && !overview?.Name) throw new Error(`No company overview returned for ${normalized}`);
  return {
    symbol: normalized,
    companyName: overview.Name || normalized,
    description: overview.Description || '',
    exchange: overview.Exchange || null,
    currency: overview.Currency || null,
    country: overview.Country || null,
    sector: overview.Sector || null,
    industry: overview.Industry || null,
    fiscalYearEnd: overview.FiscalYearEnd || null,
    latestQuarter: overview.LatestQuarter || null,
    marketCapitalization: numberOrNull(overview.MarketCapitalization),
    ebitda: numberOrNull(overview.EBITDA),
    peRatio: numberOrNull(overview.PERatio),
    forwardPe: numberOrNull(overview.ForwardPE),
    pegRatio: numberOrNull(overview.PEGRatio),
    priceToSales: numberOrNull(overview.PriceToSalesRatioTTM),
    priceToBook: numberOrNull(overview.PriceToBookRatio),
    evToRevenue: numberOrNull(overview.EVToRevenue),
    evToEbitda: numberOrNull(overview.EVToEBITDA),
    eps: numberOrNull(overview.EPS),
    dilutedEpsTtm: numberOrNull(overview.DilutedEPSTTM),
    revenueTtm: numberOrNull(overview.RevenueTTM),
    grossProfitTtm: numberOrNull(overview.GrossProfitTTM),
    revenuePerShareTtm: numberOrNull(overview.RevenuePerShareTTM),
    profitMargin: numberOrNull(overview.ProfitMargin),
    operatingMarginTtm: numberOrNull(overview.OperatingMarginTTM),
    returnOnAssetsTtm: numberOrNull(overview.ReturnOnAssetsTTM),
    returnOnEquityTtm: numberOrNull(overview.ReturnOnEquityTTM),
    quarterlyRevenueGrowthYoy: numberOrNull(overview.QuarterlyRevenueGrowthYOY),
    quarterlyEarningsGrowthYoy: numberOrNull(overview.QuarterlyEarningsGrowthYOY),
    dividendPerShare: numberOrNull(overview.DividendPerShare),
    dividendYield: numberOrNull(overview.DividendYield),
    beta: numberOrNull(overview.Beta),
    sharesOutstanding: numberOrNull(overview.SharesOutstanding),
    analystTargetPrice: numberOrNull(overview.AnalystTargetPrice),
    analystRatings: {
      strongBuy: numberOrNull(overview.AnalystRatingStrongBuy),
      buy: numberOrNull(overview.AnalystRatingBuy),
      hold: numberOrNull(overview.AnalystRatingHold),
      sell: numberOrNull(overview.AnalystRatingSell),
      strongSell: numberOrNull(overview.AnalystRatingStrongSell)
    },
    fiftyTwoWeekHigh: numberOrNull(overview['52WeekHigh']),
    fiftyTwoWeekLow: numberOrNull(overview['52WeekLow']),
    fiftyDayMovingAverage: numberOrNull(overview['50DayMovingAverage']),
    twoHundredDayMovingAverage: numberOrNull(overview['200DayMovingAverage']),
    quote: null,
    source: 'Alpha Vantage Company Overview'
  };
}

export async function getAlphaVantageNews(symbol) {
  const normalized = symbol.toUpperCase();
  return { symbol: normalized, articles: [], source: 'OpenAI web search', asOf: null };
}
