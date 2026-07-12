import { config } from '../config.js';
import { loadSkills } from './skill-loader.js';
import { generateAiResponse } from './ai/index.js';
import { getResearchBundle } from './market/index.js';

import { detectRange, detectTicker, isTrendRequest, selectSkillNames } from './chat-routing.js';

export { detectRange, detectTicker, isTickerQuestion, selectSkillNames } from './chat-routing.js';

function addSource(sources, seen, source) {
  const key = source.url || `${source.name}:${source.type}:${source.dataAsOf || ''}`;
  if (seen.has(key)) return;
  seen.add(key);
  sources.push(source);
}

function sourcesFromBundle(bundle) {
  const sources = [];
  const seen = new Set();
  if (bundle.research) {
    addSource(sources, seen, {
      id: 'M1',
      name: bundle.research.source,
      type: 'quote, company profile, fundamentals and valuation metrics',
      dataAsOf: bundle.research.quote?.asOf || bundle.research.latestQuarter || null
    });
  }
  if (bundle.history) {
    addSource(sources, seen, {
      id: 'M2',
      name: bundle.history.source,
      type: 'one-year historical market data and calculated trend metrics',
      dataAsOf: bundle.history.asOf || null
    });
  }
  for (const article of bundle.news?.articles || []) {
    addSource(sources, seen, {
      id: article.id,
      name: article.source,
      title: article.title,
      url: article.url,
      type: 'recent company or sector news',
      dataAsOf: article.publishedAt || null
    });
  }
  return sources;
}

function chartFromHistory(ticker, range, history) {
  if (!history?.points?.length) return null;
  return {
    type: 'line',
    title: `${ticker} price trend — ${range.toUpperCase()}`,
    labels: history.points.map((point) => point.date),
    datasets: [{ label: `${ticker} close`, data: history.points.map((point) => point.close) }]
  };
}

export async function answerChat({ message, householdContext }) {
  const ticker = detectTicker(message);
  const explicitTrend = isTrendRequest(message);
  const chartRange = explicitTrend ? detectRange(message) : '1y';
  const context = { household: householdContext || null };
  let chart = null;
  const sources = [];
  const sourceKeys = new Set();

  if (ticker) {
    const bundle = await getResearchBundle(ticker, chartRange);
    context.marketResearch = bundle;
    chart = chartFromHistory(ticker, chartRange, bundle.chartHistory);
    for (const source of sourcesFromBundle(bundle)) addSource(sources, sourceKeys, source);
  }

  const selectedSkills = selectSkillNames(message);
  const skills = await loadSkills(selectedSkills);
  const systemPrompt = `You are Nirvana Research AI, an evidence-driven financial planning and equity-research system. Your quality standard is an investment-research briefing, not a generic chatbot answer.\n\n${skills}\n\nOperating policy:\n- Current date: ${new Date().toISOString().slice(0, 10)}.\n- Mode: ${config.ai.systemMode}.\n- Personalized recommendations allowed: ${config.ai.allowPersonalizedRecommendations}.\n- Trade execution allowed: ${config.ai.allowTradeExecution}.\n- Never claim to execute a trade or possess non-public information.\n- Use supplied structured market data for prices, returns, valuation metrics and portfolio calculations.
- When marketResearch.quant is present, incorporate its multi-horizon momentum, benchmark-relative returns, trend regime, volatility, drawdown, correlation and estimated beta. State when the quant signal confirms or conflicts with the fundamental thesis.\n- When marketResearch is present, answer the ticker question directly. Never start with “I can help,” a generic checklist, or a claim that current data is unavailable unless the packet itself records a failed source.\n- Distinguish company-specific performance from commodity, interest-rate, regulatory and sector-cycle exposure.\n- Use exact figures from the packet and identify their as-of dates. Do not invent figures.\n- Refer to supplied evidence with source IDs such as [M1], [M2], [N1]. Web-researched facts must be traceable to the web sources returned by the provider.\n- Treat analyst targets as third-party estimates, never as intrinsic value or guaranteed outcomes.
- Do not pretend that a single-stock trend diagnostic is a cross-sectional momentum backtest. Do not claim options mispricing without an options chain, pairs arbitrage without cointegration evidence, earnings-volatility edge without event/IV history, or order-book insight without Level II data.\n- Analyze available evidence before discussing missing data. Missing fields should not consume the answer unless they materially block a conclusion.\n- Use household.portfolioSummary and account-level holdings. Never compare aggregate holdings only with one brokerage account.\n- If the market provider is mock, explicitly state that the data is synthetic and do not form a real investment conclusion.\n- End with a research posture and the two or three facts that would change it.\n- Include a brief educational-use disclaimer, but do not bury the analysis beneath disclaimers.`;

  const aiResult = await generateAiResponse({
    systemPrompt,
    userMessage: message,
    context,
    enableWebSearch: Boolean(ticker)
  });

  for (const source of aiResult.sources || []) {
    addSource(sources, sourceKeys, { ...source, id: source.id || `W${sources.length + 1}` });
  }

  return {
    message: aiResult.text,
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
