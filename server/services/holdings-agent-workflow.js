import { generateAiResponse } from './ai/index.js';
import { getResearchBundle } from './market/index.js';
import {
  buildHoldingsLabProjection,
  normalizeScenarioDates
} from './holdings-lab-engine.js';

function number(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function words(value) {
  return String(value || '').toLowerCase();
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value)));
}

function extractJson(text) {
  const raw = String(text || '').trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : raw;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(candidate.slice(start, end + 1)); }
  catch { return null; }
}

function parseDate(prompt, currentDate) {
  const iso = String(prompt).match(/\b(20\d{2}-\d{2}-\d{2})\b/);
  if (iso) return iso[1];

  const monthName = String(prompt).match(/\b(?:on|at|by)\s+((?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\s+\d{1,2}(?:,?\s+20\d{2})?)/i);
  if (monthName) {
    const parsed = new Date(monthName[1]);
    if (!Number.isNaN(parsed.getTime())) {
      if (!/20\d{2}/.test(monthName[1])) {
        parsed.setFullYear(currentDate.getUTCFullYear());
        if (parsed < currentDate) parsed.setFullYear(parsed.getFullYear() + 1);
      }
      return parsed.toISOString().slice(0, 10);
    }
  }

  if (/next\s+month/i.test(prompt)) {
    const date = new Date(Date.UTC(currentDate.getUTCFullYear(), currentDate.getUTCMonth() + 1, 1));
    return date.toISOString().slice(0, 10);
  }
  const nextYear = String(prompt).match(/(?:in|after)\s+(\d+)\s+years?/i);
  if (nextYear) {
    const date = new Date(currentDate);
    date.setUTCFullYear(date.getUTCFullYear() + Number(nextYear[1]));
    return date.toISOString().slice(0, 10);
  }
  if (/next\s+year/i.test(prompt)) {
    const date = new Date(currentDate);
    date.setUTCFullYear(date.getUTCFullYear() + 1);
    return date.toISOString().slice(0, 10);
  }
  return currentDate.toISOString().slice(0, 10);
}

function resolveAccount(prompt, accounts) {
  const text = words(prompt);
  const exact = accounts.find((account) => text.includes(words(account.name)));
  if (exact) return exact;
  if (/401\s*\(?k\)?|403\s*\(?b\)?/.test(text)) return accounts.find((row) => row.account_type === '401k') || null;
  if (/ira|roth/.test(text)) return accounts.find((row) => row.account_type === 'ira') || null;
  if (/brokerage|taxable|stock account/.test(text)) return accounts.find((row) => row.account_type === 'brokerage') || null;
  return accounts.find((row) => row.account_type === 'brokerage') || accounts[0] || null;
}

function symbolReferencePrice(symbol, holdings, symbolAnalyses) {
  const saved = holdings.find((row) => String(row.symbol).toUpperCase() === symbol && Number(row.current_price) > 0);
  if (saved) return Number(saved.current_price);
  const agent = symbolAnalyses[symbol];
  if (Number(agent?.currentPrice) > 0) return Number(agent.currentPrice);
  const cost = holdings.find((row) => String(row.symbol).toUpperCase() === symbol && Number(row.cost_basis_per_share) > 0);
  return Number(cost?.cost_basis_per_share || 1);
}

function parseTrade(prompt, accounts, holdings, symbolAnalyses, currentDate) {
  const text = String(prompt || '');
  const actionMatch = text.match(/\b(buy|purchase|add|sell|reduce|liquidate)\b/i);
  if (!actionMatch) return [];
  const action = /sell|reduce|liquidate/i.test(actionMatch[1]) ? 'sell' : 'buy';

  const symbolMatch = text.match(/\$([A-Za-z]{1,6})\b/)
    || text.match(/\b(?:buy|purchase|add|sell|reduce|liquidate)(?:\s+\$?[\d,.]+|\s+[\d,.]+\s+shares?(?:\s+of)?)?\s+(?:of\s+)?([A-Za-z]{1,6})\b/i)
    || text.match(/\b([A-Z]{2,6})\b/);
  if (!symbolMatch) return [];
  const symbol = symbolMatch[1].toUpperCase();

  const dollarMatch = text.match(/\$\s*([\d,]+(?:\.\d+)?)/);
  const sharesMatch = text.match(/([\d,]+(?:\.\d+)?)\s+shares?/i);
  const amount = dollarMatch ? Number(dollarMatch[1].replaceAll(',', '')) : null;
  const quantity = sharesMatch ? Number(sharesMatch[1].replaceAll(',', '')) : null;
  if (!(amount > 0) && !(quantity > 0)) return [];

  const account = resolveAccount(text, accounts);
  const external = /new money|external|additional cash|outside cash|contribute/i.test(text);
  return [{
    action,
    symbol,
    amount: amount > 0 ? amount : null,
    quantity: quantity > 0 ? quantity : null,
    date: parseDate(text, currentDate),
    accountId: account?.id || null,
    accountName: account?.name || null,
    funding: external ? 'external' : 'internal',
    referencePrice: symbolReferencePrice(symbol, holdings, symbolAnalyses)
  }];
}

function parseReturnOverrides(prompt, accounts) {
  const text = String(prompt || '');
  const symbolReturnOverrides = [];
  const accountReturnOverrides = [];
  const percentageMatches = [...text.matchAll(/(-?\d+(?:\.\d+)?)\s*%/g)];

  for (const match of percentageMatches) {
    const before = text.slice(Math.max(0, match.index - 90), match.index);
    const after = text.slice(match.index + match[0].length, match.index + match[0].length + 100);
    const window = `${before} ${after}`;
    const directionPrefix = text.slice(Math.max(0, match.index - 45), match.index).toLowerCase();
    const negativeMatch = directionPrefix.match(/(?:falls?|fell|drops?|dropped|declines?|declined|loses?|lost|down)(?:\s+by)?\s*$/);
    const dropsTo = /(?:falls?|drops?|declines?)\s+to\s*$/.test(directionPrefix);
    const directionNegative = Boolean(negativeMatch) && !dropsTo;
    const rawRate = Math.abs(Number(match[1])) / 100;
    const rate = directionNegative ? -rawRate : Number(match[1]) / 100;
    const symbol = window.match(/\b([A-Z]{2,6})\b/)?.[1];
    const nextYears = window.match(/next\s+(\d+)\s+years?/i);
    const explicitRange = window.match(/years?\s*(\d+)\s*(?:-|to|through)\s*(\d+)/i);
    const explicitYear = window.match(/year\s*(\d+)(?!\s*(?:-|to|through))/i);
    const thereafter = /thereafter|after that|then onward|going forward/i.test(window);
    let startMonth = 0;
    let endMonth = null;
    if (nextYears) endMonth = Number(nextYears[1]) * 12 - 1;
    else if (explicitRange) {
      startMonth = (Number(explicitRange[1]) - 1) * 12;
      endMonth = Number(explicitRange[2]) * 12 - 1;
    } else if (explicitYear) {
      startMonth = (Number(explicitYear[1]) - 1) * 12;
      endMonth = thereafter ? null : Number(explicitYear[1]) * 12 - 1;
    } else if (!thereafter) endMonth = 11;

    if (symbol && !['BUY', 'SELL', 'ETF', 'IRA'].includes(symbol)) {
      symbolReturnOverrides.push({ symbol, startMonth, endMonth, annualReturn: rate });
      continue;
    }

    const account = resolveAccount(window, accounts);
    const appliesToAll = /all holdings|all accounts|all selected accounts|portfolio|stocks/i.test(window);
    accountReturnOverrides.push({
      accountId: appliesToAll ? null : account?.id || null,
      accountName: appliesToAll ? 'all selected accounts' : account?.name || 'selected accounts',
      startMonth,
      endMonth,
      annualReturn: rate
    });
  }

  return { symbolReturnOverrides, accountReturnOverrides };
}

function deterministicScenario(prompt, context, symbolAnalyses, currentDate) {
  const trades = parseTrade(prompt, context.accounts, context.holdings, symbolAnalyses, currentDate);
  const overrides = parseReturnOverrides(prompt, context.accounts);
  return {
    title: trades.length ? 'Temporary portfolio trade' : overrides.symbolReturnOverrides.length || overrides.accountReturnOverrides.length ? 'Temporary return scenario' : 'Holdings what-if',
    summary: String(prompt || '').trim(),
    trades,
    symbolReturnOverrides: overrides.symbolReturnOverrides,
    accountReturnOverrides: overrides.accountReturnOverrides,
    notes: []
  };
}

function normalizeAiScenario(raw, context, symbolAnalyses, currentDate) {
  if (!raw || typeof raw !== 'object') return null;
  const accounts = context.accounts || [];
  const holdings = context.holdings || [];
  const trades = [];

  for (const item of raw.trades || []) {
    const account = accounts.find((row) => row.id === item.accountId)
      || accounts.find((row) => words(item.accountName).includes(words(row.name)))
      || resolveAccount(item.accountName || '', accounts);
    const symbol = String(item.symbol || '').toUpperCase();
    const action = String(item.action || '').toLowerCase();
    if (!symbol || !['buy', 'sell'].includes(action)) continue;
    const amount = number(item.amount);
    const quantity = number(item.quantity);
    if (!(amount > 0) && !(quantity > 0)) continue;
    trades.push({
      action,
      symbol,
      amount: amount > 0 ? amount : null,
      quantity: quantity > 0 ? quantity : null,
      date: item.date || currentDate.toISOString().slice(0, 10),
      accountId: account?.id || null,
      accountName: account?.name || null,
      funding: item.funding === 'external' ? 'external' : 'internal',
      referencePrice: symbolReferencePrice(symbol, holdings, symbolAnalyses)
    });
  }

  const symbolReturnOverrides = (raw.symbolReturnOverrides || []).map((item) => ({
    symbol: String(item.symbol || '').toUpperCase(),
    startMonth: Math.max(0, Math.floor(number(item.startMonth, 0))),
    endMonth: item.endMonth == null ? null : Math.max(0, Math.floor(number(item.endMonth, 0))),
    annualReturn: clamp(number(item.annualReturn, 0), -0.95, 3)
  })).filter((item) => item.symbol);

  const accountReturnOverrides = (raw.accountReturnOverrides || []).map((item) => {
    const account = accounts.find((row) => row.id === item.accountId)
      || accounts.find((row) => words(item.accountName).includes(words(row.name)));
    return {
      accountId: item.applyToAll ? null : account?.id || null,
      accountName: item.applyToAll ? 'all selected accounts' : account?.name || 'selected accounts',
      startMonth: Math.max(0, Math.floor(number(item.startMonth, 0))),
      endMonth: item.endMonth == null ? null : Math.max(0, Math.floor(number(item.endMonth, 0))),
      annualReturn: clamp(number(item.annualReturn, 0), -0.95, 3)
    };
  });

  return {
    title: String(raw.title || 'AI-assisted holdings scenario').slice(0, 160),
    summary: String(raw.summary || '').slice(0, 1000),
    trades,
    symbolReturnOverrides,
    accountReturnOverrides,
    notes: Array.isArray(raw.notes) ? raw.notes.map((item) => String(item).slice(0, 300)).slice(0, 8) : []
  };
}

async function parseScenario(prompt, context, symbolAnalyses, currentDate) {
  if (!String(prompt || '').trim()) return null;
  const deterministic = deterministicScenario(prompt, context, symbolAnalyses, currentDate);
  const recognized = deterministic.trades.length
    || deterministic.symbolReturnOverrides.length
    || deterministic.accountReturnOverrides.length;
  if (recognized) return normalizeScenarioDates(deterministic, currentDate);

  const systemPrompt = `You are the Holdings Scenario Agent for Nirvana. Convert a temporary portfolio what-if request into JSON only. Do not execute trades, do not persist changes, and use only supplied account names and symbols.

Schema:
{
  "title":"short title",
  "summary":"plain-language interpretation",
  "trades":[{"action":"buy|sell","symbol":"NVDA","amount":50000,"quantity":null,"date":"2027-01-15","accountId":"uuid or null","accountName":"name","funding":"internal|external"}],
  "symbolReturnOverrides":[{"symbol":"NVDA","startMonth":0,"endMonth":11,"annualReturn":0.20}],
  "accountReturnOverrides":[{"accountId":"uuid or null","accountName":"name","applyToAll":false,"startMonth":0,"endMonth":35,"annualReturn":0.08}],
  "notes":[]
}

Internal funding means the buy reallocates cash or other positions inside that account and does not increase total portfolio value immediately. External funding means new hypothetical money is added. Use exact ISO dates when a date is stated. Return JSON only.`;

  try {
    const result = await generateAiResponse({
      systemPrompt,
      userMessage: prompt,
      context: {
        currentDate: currentDate.toISOString().slice(0, 10),
        accounts: context.accounts.map((row) => ({ id: row.id, name: row.name, type: row.account_type, balance: row.current_balance })),
        holdings: context.holdings.map((row) => ({ symbol: row.symbol, accountId: row.account_id, quantity: row.quantity }))
      },
      enableWebSearch: false
    });
    const normalized = normalizeAiScenario(extractJson(result.text), context, symbolAnalyses, currentDate);
    return normalizeScenarioDates(normalized || deterministic, currentDate);
  } catch (error) {
    console.warn('Holdings scenario AI parsing failed:', error.message);
    deterministic.notes.push('The request was not fully recognized; no temporary trade or return override was applied.');
    return normalizeScenarioDates(deterministic, currentDate);
  }
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let index = 0;
  async function run() {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await worker(items[current], current);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return results;
}

function symbolPriority(holding) {
  const price = Number(holding.current_price || holding.cost_basis_per_share || 0);
  return Number(holding.quantity || 0) * price;
}

export async function runSymbolAgents(holdings, options = {}) {
  const maxLiveSymbols = Math.max(1, Math.min(40, Number(options.maxLiveSymbols || 24)));
  const unique = [...new Map(
    [...holdings]
      .sort((a, b) => symbolPriority(b) - symbolPriority(a))
      .map((row) => [String(row.symbol || '').toUpperCase(), row])
  ).values()].filter((row) => row.symbol);
  const liveSymbols = new Set(unique.slice(0, maxLiveSymbols).map((row) => String(row.symbol).toUpperCase()));

  const rows = await mapWithConcurrency(unique, 3, async (holding) => {
    const symbol = String(holding.symbol).toUpperCase();
    if (!liveSymbols.has(symbol)) {
      return [symbol, {
        symbol,
        currentPrice: Number(holding.current_price || 0) || null,
        priceAsOf: holding.price_as_of || null,
        analytics: null,
        quant: null,
        dataGaps: ['Live market packet deferred; account-level fallback growth is used.'],
        agentStatus: 'fallback'
      }];
    }
    try {
      const bundle = await getResearchBundle(symbol, '1y');
      return [symbol, {
        symbol,
        currentPrice: number(bundle.analytics?.price, number(bundle.research?.quote?.price, null)),
        priceAsOf: bundle.analytics?.priceAsOf || bundle.research?.quote?.asOf || null,
        analytics: bundle.analytics,
        quant: bundle.quant,
        research: bundle.research ? {
          name: bundle.research.name || bundle.research.companyName || null,
          sector: bundle.research.sector || null,
          industry: bundle.research.industry || null
        } : null,
        dataGaps: bundle.dataGaps || [],
        agentStatus: bundle.liveDataAvailable ? 'market-analyzed' : 'fallback'
      }];
    } catch (error) {
      return [symbol, {
        symbol,
        currentPrice: Number(holding.current_price || 0) || null,
        priceAsOf: holding.price_as_of || null,
        analytics: null,
        quant: null,
        dataGaps: [error.message],
        agentStatus: 'fallback'
      }];
    }
  });

  return Object.fromEntries(rows);
}

async function generatePortfolioNarrative(projection) {
  const fallback = projection.insights || [];
  const topHoldings = projection.holdings.slice().sort((a, b) => b.currentValue - a.currentValue).slice(0, 15);
  const systemPrompt = `You are Nirvana's Holdings Insight Agent. Produce a concise portfolio diagnostic grounded only in the supplied structured analysis. Do not recommend a trade or claim a forecast is certain. Explain coverage gaps, concentration, risk mix, account differences, and the temporary scenario. Return JSON only with {"headline":"...","insights":["..."],"watchItems":["..."]}. Use no more than 5 insights and 3 watch items.`;

  try {
    const result = await generateAiResponse({
      systemPrompt,
      userMessage: projection.scenario?.summary || 'Analyze the current selected holdings portfolio.',
      context: {
        metrics: projection.metrics,
        accounts: projection.accounts,
        riskAllocation: projection.riskAllocation,
        concentration: projection.concentration,
        topHoldings: topHoldings.map((row) => ({
          symbol: row.symbol,
          value: row.currentValue,
          risk: row.risk,
          modeledAnnualReturnPct: row.annualReturnPct,
          volatilityPct: row.analytics?.annualizedVolatilityPct,
          drawdownPct: row.analytics?.maximumDrawdownPct,
          beta: row.quant?.estimatedBetaToBenchmark,
          momentum: row.quant?.momentumState
        })),
        scenarioEvents: projection.alternative.events
      },
      enableWebSearch: false
    });
    const parsed = extractJson(result.text);
    if (!parsed) throw new Error('AI insight response was not valid JSON');
    return {
      headline: String(parsed.headline || 'Holdings diagnostic').slice(0, 180),
      insights: Array.isArray(parsed.insights) ? parsed.insights.map(String).slice(0, 5) : fallback,
      watchItems: Array.isArray(parsed.watchItems) ? parsed.watchItems.map(String).slice(0, 3) : []
    };
  } catch (error) {
    return {
      headline: 'Holdings diagnostic',
      insights: fallback,
      watchItems: ['Market data and model outputs can be delayed, incomplete, or sensitive to the selected growth assumptions.'],
      fallbackReason: error.message
    };
  }
}

export async function analyzeHoldingsLab({
  accounts,
  holdings,
  selectedTypes,
  growthOverrides,
  prompt,
  horizonMonths = 36,
  maxLiveSymbols = 24,
  includeNarrative = true,
  currentDate = new Date()
}) {
  const selected = new Set(selectedTypes?.length ? selectedTypes : ['brokerage', 'ira', '401k', 'retirement']);
  const selectedAccounts = accounts.filter((row) => selected.has(row.account_type));
  const accountIds = new Set(selectedAccounts.map((row) => row.id));
  const selectedHoldings = holdings.filter((row) => accountIds.has(row.account_id));
  const symbolAnalyses = await runSymbolAgents(selectedHoldings, { maxLiveSymbols });
  const context = { accounts: selectedAccounts, holdings: selectedHoldings };
  const scenario = await parseScenario(prompt, context, symbolAnalyses, currentDate);
  const projection = buildHoldingsLabProjection({
    accounts: selectedAccounts,
    holdings: selectedHoldings,
    symbolAnalyses,
    selectedTypes,
    growthOverrides,
    scenario,
    horizonMonths,
    currentDate
  });
  projection.agentSummary = {
    totalSymbols: Object.keys(symbolAnalyses).length,
    marketAnalyzed: Object.values(symbolAnalyses).filter((row) => row.agentStatus === 'market-analyzed').length,
    fallbackSymbols: Object.values(symbolAnalyses).filter((row) => row.agentStatus !== 'market-analyzed').length,
    maxLiveSymbols
  };
  projection.aiInsights = includeNarrative
    ? await generatePortfolioNarrative(projection)
    : { headline: 'Holdings diagnostic', insights: projection.insights, watchItems: [] };
  projection.persisted = false;
  return projection;
}
