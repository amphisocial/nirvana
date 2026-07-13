import { generateAiResponse } from './ai/index.js';

function number(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function words(value) {
  return String(value || '').toLowerCase();
}

function fuzzyIncludes(text, value) {
  const needle = words(value).replace(/[^a-z0-9]+/g, ' ').trim();
  if (!needle) return false;
  const haystack = words(text).replace(/[^a-z0-9]+/g, ' ');
  return haystack.includes(needle);
}

function findAge(prompt, currentAge) {
  const patterns = [
    /(?:at|when i am|when i'm|when im)\s+(?:age\s*)?(\d{2,3})/i,
    /age\s*(\d{2,3})/i
  ];
  for (const pattern of patterns) {
    const match = prompt.match(pattern);
    if (!match) continue;
    const age = number(match[1]);
    if (age != null && age >= currentAge && age <= 100) return age;
  }
  return null;
}

function resolveSourceAccount(prompt, accounts) {
  for (const account of accounts) {
    if (fuzzyIncludes(prompt, account.name)) return account;
  }
  const text = words(prompt);
  if (/stock|brokerage|taxable/.test(text)) {
    return accounts.find((row) => row.account_type === 'brokerage') || null;
  }
  if (/ira|roth/.test(text)) {
    return accounts.find((row) => row.account_type === 'ira') || null;
  }
  if (/401\s*\(?k\)?|403\s*\(?b\)?|retirement account/.test(text)) {
    return accounts.find((row) => ['401k', 'retirement'].includes(row.account_type)) || null;
  }
  if (/529|college account/.test(text)) {
    return accounts.find((row) => row.account_type === '529') || null;
  }
  if (/cash|checking|savings/.test(text)) {
    return accounts.find((row) => row.account_type === 'cash') || null;
  }
  return null;
}

function defaultPayoffSource(accounts) {
  const preferredTypes = ['brokerage', 'cash', 'hsa', 'ira', '401k', 'retirement', '529'];
  const candidates = [...accounts].sort(
    (a, b) => number(b.current_balance, 0) - number(a.current_balance, 0)
  );

  for (const type of preferredTypes) {
    const match = candidates.find((row) => row.account_type === type);
    if (match) return match;
  }

  return candidates[0] || null;
}

function hasPayoffIntent(prompt) {
  return /pay\s*off|payoff|clear|eliminate|retire\s+(?:the\s+)?(?:loan|debt)|debt[- ]free/i.test(
    String(prompt || '')
  );
}

function liabilityMatchesPrompt(prompt, liability) {
  const text = words(prompt);
  if (fuzzyIncludes(text, liability.name)) return true;
  const type = words(liability.liability_type);
  if (/all (?:my )?(?:loans|debt|liabilities)/.test(text)) return true;
  if (/mortgage|home loan/.test(text) && (type === 'mortgage' || /mortgage/.test(words(liability.name)))) return true;
  if (/home equity|heloc/.test(text) && (/home_equity|heloc/.test(type) || /home equity|heloc/.test(words(liability.name)))) return true;
  if (/car loan|auto loan|vehicle loan/.test(text) && (/auto|car|vehicle/.test(type) || /car|auto|vehicle/.test(words(liability.name)))) return true;
  if (/student loan/.test(text) && (/student/.test(type) || /student/.test(words(liability.name)))) return true;
  if (/credit card/.test(text) && (/credit/.test(type) || /credit card/.test(words(liability.name)))) return true;
  return false;
}

function parseReturnPhases(prompt) {
  const text = String(prompt || '');
  const phases = [];
  const matches = [...text.matchAll(/(-?\d+(?:\.\d+)?)\s*%/g)];

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index];
    const percentage = Number(match[1]) / 100;
    const before = text.slice(Math.max(0, match.index - 60), match.index).toLowerCase();
    const after = text.slice(match.index + match[0].length, match.index + match[0].length + 90).toLowerCase();
    const window = `${before} ${after}`;
    let startOffset = 0;
    let endOffset = null;

    const nextYears = window.match(/next\s+(\d+)\s+years?/);
    const explicitRange = window.match(/years?\s*(\d+)\s*(?:-|to|through)\s*(\d+)/);
    const explicitYear = window.match(/years?\s*(\d+)(?!\s*(?:-|to|through))/);
    const thereafter = /thereafter|after that|then onward|from then on|going forward/.test(window);

    if (nextYears) {
      startOffset = 0;
      endOffset = Math.max(0, Number(nextYears[1]) - 1);
    } else if (explicitRange) {
      startOffset = Math.max(0, Number(explicitRange[1]) - 1);
      endOffset = Math.max(startOffset, Number(explicitRange[2]) - 1);
    } else if (explicitYear) {
      startOffset = Math.max(0, Number(explicitYear[1]) - 1);
      endOffset = thereafter ? null : startOffset;
    } else if (index > 0) {
      const prior = phases.at(-1);
      startOffset = prior?.endOffset == null ? index : prior.endOffset + 1;
      endOffset = null;
    }

    phases.push({
      scope: /529/.test(window) ? '529'
        : /ira|401|retirement/.test(window) ? 'retirement'
          : /property|home value|real estate/.test(window) ? 'property'
            : 'stocks',
      startOffset,
      endOffset,
      annualReturn: percentage
    });
  }

  return phases;
}

function parseSymbolShocks(prompt, holdings = []) {
  const symbols = new Set(holdings.map((row) => String(row.symbol || row.ticker || '').toUpperCase()).filter(Boolean));
  const shocks = [];
  const pattern = /\b([A-Z]{1,6})\b\s+(?:(?:goes?|moves?|rises?|grows?|increases?|jumps?)\s+)?(?:by\s+)?(up|down|drops?|falls?|gains?|loses?)?\s*(-?\d+(?:\.\d+)?)\s*%/gi;
  let match;
  while ((match = pattern.exec(String(prompt || ''))) !== null) {
    const symbol = match[1].toUpperCase();
    if (symbols.size && !symbols.has(symbol)) continue;
    const direction = words(match[2]);
    let value = Number(match[3]) / 100;
    if (/down|drop|fall|lose/.test(direction)) value = -Math.abs(value);
    shocks.push({ symbol, startOffset: 0, endOffset: 0, annualReturn: value });
  }
  return shocks;
}

function extractJson(text) {
  const raw = String(text || '').trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : raw;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch {
    return null;
  }
}

function normalizeAiScenario(raw, context) {
  if (!raw || typeof raw !== 'object') return null;
  const accounts = context.accounts || [];
  const liabilities = context.liabilities || [];
  const payoffActions = [];

  for (const action of raw.payoffActions || []) {
    const source = accounts.find((row) => row.id === action.sourceAccountId)
      || accounts.find((row) => fuzzyIncludes(action.sourceAccountName, row.name))
      || defaultPayoffSource(accounts);
    const targets = liabilities.filter((row) =>
      (action.liabilityIds || []).includes(row.id)
      || (action.liabilityNames || []).some((name) => fuzzyIncludes(name, row.name))
    );
    const age = number(action.age);
    if (!source || !targets.length || age == null) continue;
    payoffActions.push({
      sourceAccountId: source.id,
      sourceAccountName: source.name,
      liabilityIds: targets.map((row) => row.id),
      liabilityNames: targets.map((row) => row.name),
      age
    });
  }

  const returnPhases = (raw.returnPhases || []).map((phase) => ({
    scope: ['stocks', 'brokerage', 'all_investments', 'retirement', '529', 'cash', 'property'].includes(phase.scope)
      ? phase.scope
      : 'stocks',
    accountId: phase.accountId || null,
    startOffset: Math.max(0, Math.floor(number(phase.startOffset, 0))),
    endOffset: phase.endOffset == null ? null : Math.max(0, Math.floor(number(phase.endOffset, 0))),
    annualReturn: number(phase.annualReturn, 0)
  })).filter((phase) => phase.annualReturn != null);

  const symbolShocks = (raw.symbolShocks || []).map((shock) => ({
    symbol: String(shock.symbol || '').toUpperCase(),
    startOffset: Math.max(0, Math.floor(number(shock.startOffset, 0))),
    endOffset: shock.endOffset == null ? 0 : Math.max(0, Math.floor(number(shock.endOffset, 0))),
    annualReturn: number(shock.annualReturn, 0)
  })).filter((shock) => shock.symbol && shock.annualReturn != null);

  return {
    title: String(raw.title || 'AI-assisted what-if').slice(0, 160),
    summary: String(raw.summary || '').slice(0, 1000),
    payoffActions,
    returnPhases,
    symbolShocks,
    horizonYears: Math.max(1, Math.min(40, Math.floor(number(raw.horizonYears, 10)))),
    notes: Array.isArray(raw.notes) ? raw.notes.map((item) => String(item).slice(0, 300)).slice(0, 8) : []
  };
}

async function parseWithAi(prompt, context, mode) {
  const systemPrompt = `You translate a financial what-if request into structured assumptions. Return JSON only. Do not give financial advice and do not invent account or liability names. Use only the supplied context.

Schema:
{
  "title": "short scenario title",
  "summary": "plain-language description",
  "payoffActions": [{"sourceAccountId":"uuid","sourceAccountName":"name","liabilityIds":["uuid"],"liabilityNames":["name"],"age":57}],
  "returnPhases": [{"scope":"stocks|brokerage|all_investments|retirement|529|cash|property","accountId":null,"startOffset":0,"endOffset":1,"annualReturn":0.20}],
  "symbolShocks": [{"symbol":"NVDA","startOffset":0,"endOffset":0,"annualReturn":0.30}],
  "horizonYears": 10,
  "notes": ["important interpretation"]
}

Offset 0 means the first projected year. For “next two years,” use startOffset 0 and endOffset 1. For “years 3-4,” use 2 and 3. For “thereafter,” use endOffset null. Mode is ${mode}.`;

  try {
    const result = await generateAiResponse({
      systemPrompt,
      userMessage: prompt,
      context: {
        currentAge: context.currentAge,
        accounts: (context.accounts || []).map((row) => ({ id: row.id, name: row.name, type: row.account_type, balance: row.current_balance })),
        liabilities: (context.liabilities || []).map((row) => ({ id: row.id, name: row.name, type: row.liability_type, balance: row.current_balance })),
        holdings: (context.holdings || []).map((row) => ({ symbol: row.symbol || row.ticker, accountId: row.account_id }))
      },
      enableWebSearch: false
    });
    return normalizeAiScenario(extractJson(result.text), context);
  } catch (error) {
    console.warn('What-if AI parsing failed; using deterministic parser:', error.message);
    return null;
  }
}

function deterministicScenario(prompt, context, mode) {
  const accounts = context.accounts || [];
  const liabilities = context.liabilities || [];
  const currentAge = number(context.currentAge, 45);
  const age = findAge(prompt, currentAge);
  const targets = liabilities.filter((row) => liabilityMatchesPrompt(prompt, row));
  const explicitSource = resolveSourceAccount(prompt, accounts);
  const usedDefaultSource = !explicitSource
    && hasPayoffIntent(prompt)
    && age != null
    && targets.length > 0;
  const source = explicitSource || (usedDefaultSource ? defaultPayoffSource(accounts) : null);
  const payoffActions = source && age != null && targets.length
    ? [{
        sourceAccountId: source.id,
        sourceAccountName: source.name,
        liabilityIds: targets.map((row) => row.id),
        liabilityNames: targets.map((row) => row.name),
        age
      }]
    : [];
  const returnPhases = parseReturnPhases(prompt);
  const symbolShocks = parseSymbolShocks(prompt, context.holdings || []);
  const notes = usedDefaultSource && source
    ? [`No funding account was named, so ${source.name} was used for the temporary payoff analysis.`]
    : [];

  return {
    title: payoffActions.length ? `Pay debt at age ${age}`
      : returnPhases.length || symbolShocks.length ? 'Investment return what-if'
        : 'What-if scenario',
    summary: String(prompt || '').trim(),
    payoffActions,
    returnPhases,
    symbolShocks,
    horizonYears: 10,
    notes,
    mode
  };
}

function mergeScenarios(primary, fallback) {
  if (!primary) return fallback;
  return {
    ...fallback,
    ...primary,
    payoffActions: primary.payoffActions?.length ? primary.payoffActions : fallback.payoffActions,
    returnPhases: primary.returnPhases?.length ? primary.returnPhases : fallback.returnPhases,
    symbolShocks: primary.symbolShocks?.length ? primary.symbolShocks : fallback.symbolShocks,
    notes: [...new Set([...(fallback.notes || []), ...(primary.notes || [])])]
  };
}

export async function parseWhatIfPrompt(prompt, context, mode = 'household') {
  const deterministic = deterministicScenario(prompt, context, mode);
  const recognized = deterministic.payoffActions.length
    || deterministic.returnPhases.length
    || deterministic.symbolShocks.length;

  // Common payoff and return requests stay fast and deterministic. AI is the
  // fallback for more conversational or ambiguous requests, not a dependency.
  const ai = recognized ? null : await parseWithAi(prompt, context, mode);
  const scenario = mergeScenarios(ai, deterministic);

  if (!scenario.payoffActions.length && !scenario.returnPhases.length && !scenario.symbolShocks.length) {
    scenario.notes.push(
      'No specific payoff or return assumption was recognized. Use an example prompt or name the account, debt, age, or return period more explicitly.'
    );
  }

  return scenario;
}
