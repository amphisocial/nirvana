function hashSymbol(symbol) {
  return [...symbol].reduce((sum, char) => sum + char.charCodeAt(0), 0);
}

function rangeStart(range) {
  const now = new Date();
  const start = new Date(now);
  if (range === '3m') start.setMonth(start.getMonth() - 3);
  else if (range === '6m') start.setMonth(start.getMonth() - 6);
  else if (range === 'ytd') start.setMonth(0, 1);
  else start.setFullYear(start.getFullYear() - 1);
  return start;
}

export async function getMockHistory(symbol, range = '3m') {
  const normalized = symbol.toUpperCase();
  const seed = hashSymbol(normalized);
  const start = rangeStart(range);
  const end = new Date();
  const points = [];
  let price = 70 + (seed % 230);
  let index = 0;
  for (const date = new Date(start); date <= end; date.setDate(date.getDate() + (range === '3m' ? 2 : 7))) {
    const wave = Math.sin((index + seed) / 4) * 0.018;
    const drift = 0.0012 + ((seed % 7) - 3) * 0.00015;
    price = Math.max(2, price * (1 + drift + wave));
    points.push({ date: date.toISOString().slice(0, 10), close: Number(price.toFixed(2)) });
    index += 1;
  }
  return {
    symbol: normalized,
    range,
    points,
    source: 'Nirvana mock market data',
    delayed: true,
    asOf: points.at(-1)?.date
  };
}

export async function getMockQuote(symbol) {
  const history = await getMockHistory(symbol, '3m');
  const latest = history.points.at(-1)?.close || 100;
  return { symbol: symbol.toUpperCase(), price: latest, changePct: 0.62, asOf: history.asOf, source: history.source, delayed: true };
}

export async function getMockResearch(symbol) {
  const quote = await getMockQuote(symbol);
  return {
    symbol: symbol.toUpperCase(),
    companyName: `${symbol.toUpperCase()} Demo Company`,
    description: 'Synthetic company profile used only for local development. Do not show this as real investment research.',
    sector: 'Demonstration',
    industry: 'Synthetic Data',
    marketCapitalization: null,
    peRatio: null,
    revenueTtm: null,
    profitMargin: null,
    quote,
    source: 'Nirvana mock market data'
  };
}

export async function getMockNews(symbol) {
  return {
    symbol: symbol.toUpperCase(),
    articles: [],
    source: 'Nirvana mock market data',
    asOf: null
  };
}
