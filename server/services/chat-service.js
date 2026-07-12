import { config } from '../config.js';
import { loadSkills } from './skill-loader.js';
import { generateAiResponse } from './ai/index.js';
import { getHistory, getResearch } from './market/index.js';

const RANGE_PATTERNS = [
  { range: 'ytd', regex: /\b(ytd|year[ -]?to[ -]?date)\b/i },
  { range: '6m', regex: /\b(6\s*(m|mo|months?)|six\s+months?)\b/i },
  { range: '3m', regex: /\b(3\s*(m|mo|months?)|three\s+months?)\b/i },
  { range: '1y', regex: /\b(1\s*(y|yr|year)|one\s+year|12\s*months?)\b/i }
];

const COMMON_WORDS = new Set(['TELL', 'ABOUT', 'TREND', 'STOCK', 'PRICE', 'SHOW', 'OVER', 'LAST', 'MONTH', 'MONTHS', 'YEAR', 'BUY', 'SELL', 'THE', 'TO', 'FOR', 'AND', 'OR']);

const COMPANY_ALIASES = new Map([
  ['tesla', 'TSLA'],
  ['nvidia', 'NVDA'],
  ['apple', 'AAPL'],
  ['microsoft', 'MSFT'],
  ['amazon', 'AMZN'],
  ['alphabet', 'GOOGL'],
  ['google', 'GOOGL'],
  ['meta', 'META']
]);

export function detectRange(message) {
  return RANGE_PATTERNS.find((item) => item.regex.test(message))?.range || '3m';
}

export function detectTicker(message) {
  const normalizedMessage = String(message).toLowerCase();
  for (const [company, ticker] of COMPANY_ALIASES) {
    if (new RegExp(`\\b${company}\\b`, 'i').test(normalizedMessage)) return ticker;
  }
  const dollar = message.match(/\$([A-Za-z]{1,6})\b/);
  if (dollar) return dollar[1].toUpperCase();
  const explicit = message.match(/\b(?:ticker|symbol|stock|trend of|research)\s*[:=-]?\s*([A-Za-z]{1,6})\b/i);
  if (explicit && !COMMON_WORDS.has(explicit[1].toUpperCase())) return explicit[1].toUpperCase();
  const uppercase = message.match(/\b[A-Z]{2,6}\b/g)?.find((candidate) => !COMMON_WORDS.has(candidate));
  return uppercase || null;
}

function isTrendRequest(message) {
  return /(trend|chart|graph|price history|performance over|ytd|months?)/i.test(message);
}

function isResearchRequest(message) {
  return /(research|analy[sz]e|fundamental|valuation|bull case|bear case|should i buy|should i sell|buy or sell)/i.test(message);
}

export function selectSkillNames(message) {
  const names = ['personal-finance-coach'];
  if (/(retire|retirement|monte carlo|success rate|social security|pension)/i.test(message)) names.push('retirement-planner');
  if (isTrendRequest(message) || isResearchRequest(message) || detectTicker(message)) names.push('stock-market-analyst');
  if (/(what[- ]?if|scenario|target price|allocation|concentration|buy|sell)/i.test(message)) names.push('portfolio-scenario-analyst');
  return [...new Set(names)];
}

export async function answerChat({ message, householdContext }) {
  const ticker = detectTicker(message);
  const range = detectRange(message);
  const context = { household: householdContext || null };
  let chart = null;
  const sources = [];

  if (ticker && isTrendRequest(message)) {
    const history = await getHistory(ticker, range);
    context.marketHistory = history;
    chart = {
      type: 'line',
      title: `${ticker} price trend — ${range.toUpperCase()}`,
      labels: history.points.map((point) => point.date),
      datasets: [{ label: `${ticker} close`, data: history.points.map((point) => point.close) }]
    };
    sources.push({ name: history.source, dataAsOf: history.asOf, type: 'historical market data' });
  }

  if (ticker && isResearchRequest(message)) {
    const research = await getResearch(ticker);
    context.companyResearch = research;
    sources.push({ name: research.source, dataAsOf: research.quote?.asOf, type: 'company profile and quote' });
  }

  const selectedSkills = selectSkillNames(message);
  const skills = await loadSkills(selectedSkills);
  const systemPrompt = `You are Nirvana, an educational financial planning and market research assistant.\n\n${skills}\n\nSystem policy:\n- Mode: ${config.ai.systemMode}.\n- Personalized recommendations allowed: ${config.ai.allowPersonalizedRecommendations}.\n- Trade execution allowed: ${config.ai.allowTradeExecution}.\n- Never claim to execute a trade.\n- Use only supplied structured data for current prices, portfolio values, and projections.\n- Include uncertainty and identify missing data.`;

  const text = await generateAiResponse({ systemPrompt, userMessage: message, context });
  return {
    message: text,
    chart,
    sources,
    agents: selectedSkills,
    disclaimer: {
      title: config.disclaimer.title,
      text: config.disclaimer.text,
      marketDataNotice: config.market.delayNotice
    }
  };
}
