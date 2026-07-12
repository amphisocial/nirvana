import { config } from '../../config.js';

const BASE_URL = 'https://www.alphavantage.co/query';

async function request(params) {
  if (!config.market.alphaVantageApiKey) throw new Error('ALPHAVANTAGE_API_KEY is not configured');
  const url = new URL(BASE_URL);
  Object.entries({ ...params, apikey: config.market.alphaVantageApiKey }).forEach(([key, value]) => url.searchParams.set(key, value));
  const response = await fetch(url, { headers: { 'User-Agent': 'Nirvana/0.1' } });
  if (!response.ok) throw new Error(`Alpha Vantage request failed with HTTP ${response.status}`);
  const data = await response.json();
  if (data.Note) throw new Error(`Alpha Vantage rate limit: ${data.Note}`);
  if (data.Information) throw new Error(data.Information);
  if (data['Error Message']) throw new Error(data['Error Message']);
  return data;
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
  const functionName = useDaily ? 'TIME_SERIES_DAILY' : 'TIME_SERIES_WEEKLY_ADJUSTED';
  const data = await request({ function: functionName, symbol: normalized, outputsize: 'compact' });
  const seriesKey = useDaily ? 'Time Series (Daily)' : 'Weekly Adjusted Time Series';
  const series = data[seriesKey];
  if (!series) throw new Error(`No historical data returned for ${normalized}`);
  const start = startForRange(range);
  const closeKey = useDaily ? '4. close' : '5. adjusted close';
  const points = Object.entries(series)
    .filter(([date]) => date >= start)
    .map(([date, values]) => ({ date, close: Number(values[closeKey]) }))
    .filter((point) => Number.isFinite(point.close))
    .sort((a, b) => a.date.localeCompare(b.date));
  return {
    symbol: normalized,
    range,
    points,
    source: 'Alpha Vantage',
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
    price: Number(quote['05. price']),
    changePct: Number(String(quote['10. change percent'] || '0').replace('%', '')),
    asOf: quote['07. latest trading day'] || null,
    source: 'Alpha Vantage',
    delayed: true
  };
}

export async function getAlphaVantageResearch(symbol) {
  const normalized = symbol.toUpperCase();
  const [overview, quote] = await Promise.all([
    request({ function: 'OVERVIEW', symbol: normalized }),
    getAlphaVantageQuote(normalized)
  ]);
  return {
    symbol: normalized,
    companyName: overview.Name || normalized,
    description: overview.Description || '',
    sector: overview.Sector || null,
    industry: overview.Industry || null,
    marketCapitalization: Number(overview.MarketCapitalization) || null,
    peRatio: Number(overview.PERatio) || null,
    forwardPe: Number(overview.ForwardPE) || null,
    priceToSales: Number(overview.PriceToSalesRatioTTM) || null,
    revenueTtm: Number(overview.RevenueTTM) || null,
    profitMargin: Number(overview.ProfitMargin) || null,
    quarterlyRevenueGrowthYoy: Number(overview.QuarterlyRevenueGrowthYOY) || null,
    quarterlyEarningsGrowthYoy: Number(overview.QuarterlyEarningsGrowthYOY) || null,
    analystTargetPrice: Number(overview.AnalystTargetPrice) || null,
    fiftyTwoWeekHigh: Number(overview['52WeekHigh']) || null,
    fiftyTwoWeekLow: Number(overview['52WeekLow']) || null,
    quote,
    source: 'Alpha Vantage'
  };
}
