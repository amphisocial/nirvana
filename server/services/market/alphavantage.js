import { config } from '../../config.js';

const BASE_URL = 'https://www.alphavantage.co/query';

function numberOrNull(value) {
  if (value === undefined || value === null || value === '' || value === 'None' || value === '-') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function request(params) {
  if (!config.market.alphaVantageApiKey) throw new Error('ALPHAVANTAGE_API_KEY is not configured');
  const url = new URL(BASE_URL);
  Object.entries({ ...params, apikey: config.market.alphaVantageApiKey }).forEach(([key, value]) => url.searchParams.set(key, value));
  const response = await fetch(url, { headers: { 'User-Agent': 'Nirvana/0.2' } });
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
    source: 'Alpha Vantage price history',
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
    open: numberOrNull(quote['02. open']),
    high: numberOrNull(quote['03. high']),
    low: numberOrNull(quote['04. low']),
    volume: numberOrNull(quote['06. volume']),
    previousClose: numberOrNull(quote['08. previous close']),
    change: numberOrNull(quote['09. change']),
    changePct: numberOrNull(String(quote['10. change percent'] || '0').replace('%', '')),
    asOf: quote['07. latest trading day'] || null,
    source: 'Alpha Vantage Global Quote',
    delayed: true
  };
}

export async function getAlphaVantageResearch(symbol) {
  const normalized = symbol.toUpperCase();
  const [overview, quote] = await Promise.all([
    request({ function: 'OVERVIEW', symbol: normalized }),
    getAlphaVantageQuote(normalized)
  ]);
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
    quote,
    source: 'Alpha Vantage Company Overview and Global Quote'
  };
}

export async function getAlphaVantageNews(symbol) {
  const normalized = symbol.toUpperCase();
  const data = await request({
    function: 'NEWS_SENTIMENT',
    tickers: normalized,
    sort: 'LATEST',
    limit: String(config.market.newsLimit)
  });
  const articles = (Array.isArray(data.feed) ? data.feed : []).slice(0, config.market.newsLimit).map((item, index) => {
    const tickerSentiment = Array.isArray(item.ticker_sentiment)
      ? item.ticker_sentiment.find((entry) => String(entry.ticker).toUpperCase() === normalized)
      : null;
    return {
      id: `N${index + 1}`,
      title: item.title || 'Untitled article',
      summary: item.summary || '',
      url: item.url || null,
      source: item.source || item.source_domain || 'Unknown publisher',
      sourceDomain: item.source_domain || null,
      publishedAt: item.time_published || null,
      overallSentimentLabel: item.overall_sentiment_label || null,
      tickerSentimentLabel: tickerSentiment?.ticker_sentiment_label || null,
      relevanceScore: numberOrNull(tickerSentiment?.relevance_score)
    };
  });
  return {
    symbol: normalized,
    articles,
    source: 'Alpha Vantage News & Sentiment',
    asOf: articles[0]?.publishedAt || null
  };
}
