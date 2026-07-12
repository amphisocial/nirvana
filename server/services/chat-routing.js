const RANGE_PATTERNS = [
  { range: 'ytd', regex: /\b(ytd|year[ -]?to[ -]?date)\b/i },
  { range: '6m', regex: /\b(6\s*(m|mo|months?)|six\s+months?)\b/i },
  { range: '3m', regex: /\b(3\s*(m|mo|months?)|three\s+months?)\b/i },
  { range: '1y', regex: /\b(1\s*(y|yr|year)|one\s+year|12\s*months?)\b/i }
];

const COMMON_WORDS = new Set([
  'TELL', 'ABOUT', 'TREND', 'STOCK', 'PRICE', 'SHOW', 'OVER', 'LAST',
  'MONTH', 'MONTHS', 'YEAR', 'BUY', 'SELL', 'THE', 'TO', 'FOR', 'AND',
  'OR', 'WHAT', 'VIEW', 'YTD', 'ETF', 'AI', 'CEO', 'CFO', 'EPS', 'PE',
  'TTM', 'IV', 'EV', 'FCF', 'DCF', 'RSI', 'MACD'
]);

const COMPANY_ALIASES = new Map([
  ['tesla', 'TSLA'],
  ['nvidia', 'NVDA'],
  ['apple', 'AAPL'],
  ['microsoft', 'MSFT'],
  ['amazon', 'AMZN'],
  ['alphabet', 'GOOGL'],
  ['google', 'GOOGL'],
  ['meta', 'META'],
  ['cameco', 'CCJ']
]);

export function detectRange(message) {
  return RANGE_PATTERNS.find((item) => item.regex.test(message))?.range || '3m';
}

export function detectTicker(message) {
  const normalizedMessage = String(message).toLowerCase();
  for (const [company, ticker] of COMPANY_ALIASES) {
    if (new RegExp(`\\b${company}\\b`, 'i').test(normalizedMessage)) return ticker;
  }
  const dollar = String(message).match(/\$([A-Za-z]{1,6})\b/);
  if (dollar) return dollar[1].toUpperCase();
  const explicit = String(message).match(/\b(?:ticker|symbol|stock|trend of|research|about|on)\s*[:=-]?\s*([A-Za-z]{1,6})\b/i);
  if (explicit && !COMMON_WORDS.has(explicit[1].toUpperCase())) return explicit[1].toUpperCase();
  const uppercase = String(message).match(/\b[A-Z]{2,6}\b/g)?.find((candidate) => !COMMON_WORDS.has(candidate));
  return uppercase || null;
}

export function isTrendRequest(message) {
  return /(trend|chart|graph|price history|performance over|ytd|months?|one year|1y)/i.test(message);
}

export function isResearchRequest(message) {
  return /(research|analy[sz]e|fundamental|valuation|bull case|bear case|should i buy|should i sell|buy or sell|what about|thoughts? on|view on|tell me about|is .+ attractive|worth buying)/i.test(message);
}

export function isTickerQuestion(message) {
  return Boolean(detectTicker(message));
}

export function selectSkillNames(message) {
  const names = ['personal-finance-coach'];
  if (/(retire|retirement|monte carlo|success rate|social security|pension)/i.test(message)) names.push('retirement-planner');
  if (isTrendRequest(message) || isResearchRequest(message) || isTickerQuestion(message)) {
    names.push('stock-market-analyst');
    names.push('quant-equity-research');
  }
  if (/(what[- ]?if|scenario|target price|allocation|concentration|buy|sell)/i.test(message)) names.push('portfolio-scenario-analyst');
  return [...new Set(names)];
}
