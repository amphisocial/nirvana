import { annualize, expenseAtAge, incomeAtAge } from './retirement-cashflow-engine.js';

const INVESTMENT_TYPES = new Set(['brokerage', 'ira', '401k', 'retirement', 'hsa', '529']);
const LIQUID_TYPES = ['cash', 'brokerage', 'hsa', 'ira', '401k', 'retirement', '529'];
const DEBT_SERVICE_CATEGORIES = new Set(['mortgage', 'debt_payment', 'mortgage_insurance']);

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((number(value) + Number.EPSILON) * factor) / factor;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function dateYear(value) {
  if (!value) return null;
  const date = value instanceof Date
    ? value
    : new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(date.getTime()) ? date.getUTCFullYear() : null;
}

function isScheduleActive(item, projectionYear, currentYear) {
  const start = dateYear(item.start_date);
  const end = dateYear(item.end_date);
  if (start != null && projectionYear < start) return false;
  if (end != null && projectionYear > end) return false;
  return true;
}

function defaultReturn(account) {
  const saved = account.forecast_expected_return ?? account.expected_return;
  if (saved != null && Number.isFinite(Number(saved))) return clamp(Number(saved), -0.95, 1.5);
  return {
    cash: 0.02,
    brokerage: 0.07,
    ira: 0.06,
    '401k': 0.06,
    retirement: 0.06,
    hsa: 0.06,
    '529': 0.055,
    property: number(account.property_growth_rate, 0.03),
    other_asset: 0.03
  }[account.account_type] ?? 0.04;
}

function phaseMatchesAccount(phase, account) {
  if (phase.accountId && phase.accountId !== account.id) return false;
  if (phase.scope === 'all_investments') return INVESTMENT_TYPES.has(account.account_type);
  if (phase.scope === 'stocks' || phase.scope === 'brokerage') return account.account_type === 'brokerage';
  if (phase.scope === 'retirement') return ['ira', '401k', 'retirement'].includes(account.account_type);
  if (phase.scope === '529') return account.account_type === '529';
  if (phase.scope === 'cash') return account.account_type === 'cash';
  if (phase.scope === 'property') return account.account_type === 'property';
  return !phase.scope;
}

function accountReturnForYear(account, yearOffset, phases = []) {
  let rate = defaultReturn(account);
  for (const phase of phases) {
    const start = Math.max(0, Math.floor(number(phase.startOffset, 0)));
    const end = phase.endOffset == null ? Number.POSITIVE_INFINITY : Math.max(start, Math.floor(number(phase.endOffset, start)));
    if (yearOffset < start || yearOffset > end) continue;
    if (!phaseMatchesAccount(phase, account)) continue;
    rate = clamp(number(phase.annualReturn, rate), -0.95, 1.5);
  }
  return rate;
}

function liabilityPayment(row) {
  if (row.liability_type === 'mortgage') {
    return Math.max(0, number(row.principal_interest_payment, row.monthly_payment ?? row.minimum_payment));
  }
  return Math.max(0, number(row.monthly_payment, row.minimum_payment));
}

function amortizeOneYear(balance, annualRate, monthlyPayment) {
  let remaining = Math.max(0, number(balance));
  const rate = Math.max(0, number(annualRate)) / 12;
  const payment = Math.max(0, number(monthlyPayment));
  if (remaining <= 0 || payment <= 0) return remaining;

  for (let month = 0; month < 12 && remaining > 0; month += 1) {
    const interest = remaining * rate;
    const principal = Math.max(0, payment - interest);
    if (principal <= 0) {
      remaining += interest - payment;
    } else {
      remaining = Math.max(0, remaining - principal);
    }
  }
  return remaining;
}

function cloneState(data) {
  return {
    accounts: new Map((data.accounts || []).map((row) => [row.id, {
      ...row,
      balance: Math.max(0, number(row.current_balance))
    }])),
    liabilities: new Map((data.liabilities || []).map((row) => [row.id, {
      ...row,
      balance: Math.max(0, number(row.current_balance))
    }]))
  };
}

function findDefaultAccount(state) {
  return [...state.accounts.values()].find((row) => row.account_type === 'cash')
    || [...state.accounts.values()].find((row) => LIQUID_TYPES.includes(row.account_type))
    || [...state.accounts.values()][0]
    || null;
}

function orderedLiquidAccounts(state, preferredId = null) {
  const rows = [...state.accounts.values()].filter((row) => LIQUID_TYPES.includes(row.account_type));
  rows.sort((a, b) => {
    if (a.id === preferredId) return -1;
    if (b.id === preferredId) return 1;
    return LIQUID_TYPES.indexOf(a.account_type) - LIQUID_TYPES.indexOf(b.account_type);
  });
  return rows;
}

function depositToAccount(state, amount, preferredId = null) {
  const value = Math.max(0, number(amount));
  if (!value) return;
  const account = state.accounts.get(preferredId) || findDefaultAccount(state);
  if (account) account.balance += value;
}

function withdrawFromAccounts(state, amount, preferredId = null, linkedOnly = false) {
  let remaining = Math.max(0, number(amount));
  let withdrawn = 0;
  const candidates = linkedOnly
    ? [state.accounts.get(preferredId)].filter(Boolean)
    : orderedLiquidAccounts(state, preferredId);

  for (const account of candidates) {
    if (remaining <= 0) break;
    const available = Math.max(0, account.balance);
    const take = Math.min(available, remaining);
    account.balance -= take;
    remaining -= take;
    withdrawn += take;
  }

  return { withdrawn, shortfall: remaining };
}

function contributionValue(item, projectionYear, currentYear) {
  if (!isScheduleActive(item, projectionYear, currentYear)) return 0;
  const annual = annualize(item.amount, item.frequency);
  const start = dateYear(item.start_date) ?? currentYear;
  const growthYears = Math.max(0, projectionYear - start);
  return annual * ((1 + number(item.annual_increase_rate)) ** growthYears);
}

function expenseShouldStop(expense, paidLiabilityIds) {
  if (!expense.linked_liability_id || !paidLiabilityIds.has(expense.linked_liability_id)) return false;
  return DEBT_SERVICE_CATEGORIES.has(expense.category);
}

function payoffTargetsAtAge(state, payoffActions, age, events, paidLiabilityIds) {
  let totalPaid = 0;
  let totalShortfall = 0;

  for (const action of payoffActions || []) {
    if (Math.floor(number(action.age, -1)) !== age) continue;
    const source = state.accounts.get(action.sourceAccountId);
    if (!source) {
      events.push(`Payoff skipped: source account was unavailable`);
      continue;
    }

    const targetIds = Array.isArray(action.liabilityIds) ? action.liabilityIds : [];
    for (const id of targetIds) {
      const liability = state.liabilities.get(id);
      if (!liability || liability.balance <= 0) continue;
      const available = Math.max(0, source.balance);
      const payment = Math.min(available, liability.balance);
      source.balance -= payment;
      liability.balance -= payment;
      totalPaid += payment;
      if (liability.balance <= 0.01) {
        liability.balance = 0;
        paidLiabilityIds.add(id);
        events.push(`${liability.name} paid off from ${source.name}`);
      } else {
        totalShortfall += liability.balance;
        events.push(`${liability.name} partially paid from ${source.name}`);
      }
    }
  }

  return { totalPaid, totalShortfall };
}

function householdIncomeForAge(data, age, currentAge, retirementAge, currentYear) {
  return (data.incomes || []).reduce((total, item) => {
    const result = incomeAtAge(item, age, currentAge, retirementAge, currentYear);
    const gross = number(result.gross);
    const afterTax = number(result.nonTaxable) + number(result.taxable) * (1 - number(data.plan?.effective_tax_rate, 0.15));
    total.gross += gross;
    total.afterTax += afterTax;
    total.items.push({ item, afterTax });
    return total;
  }, { gross: 0, afterTax: 0, items: [] });
}

function householdExpensesForAge(data, age, currentAge, retirementAge, currentYear, paidLiabilityIds) {
  return (data.expenses || []).reduce((total, item) => {
    if (expenseShouldStop(item, paidLiabilityIds)) return total;
    const amount = expenseAtAge(item, age, currentAge, retirementAge, currentYear);
    total.total += amount;
    if (item.payment_account_type === '529') total.from529 += amount;
    total.items.push({ item, amount });
    return total;
  }, { total: 0, from529: 0, items: [] });
}

function applyIncome(state, income) {
  for (const { item, afterTax } of income.items) {
    depositToAccount(state, afterTax, item.deposit_account_id || null);
  }
}

function applyContributions(state, contributions, projectionYear, currentYear) {
  let external = 0;
  let transfers = 0;
  let shortfall = 0;

  for (const item of contributions || []) {
    const value = contributionValue(item, projectionYear, currentYear);
    if (value <= 0) continue;
    const target = state.accounts.get(item.target_account_id);
    if (!target) continue;

    if (item.contribution_type === 'transfer') {
      const result = withdrawFromAccounts(state, value, item.source_account_id, true);
      target.balance += result.withdrawn;
      transfers += result.withdrawn;
      shortfall += result.shortfall;
    } else {
      target.balance += value;
      external += value;
    }
  }

  return { external, transfers, shortfall };
}

function applyExpenses(state, expenseSummary) {
  let paid = 0;
  let shortfall = 0;
  for (const { item, amount } of expenseSummary.items) {
    if (amount <= 0) continue;
    const linkedOnly = item.funding_policy === 'linked_only';
    const result = withdrawFromAccounts(state, amount, item.payment_account_id || null, linkedOnly);
    paid += result.withdrawn;
    shortfall += result.shortfall;
  }
  return { paid, shortfall };
}

function applyReturns(state, yearOffset, returnPhases) {
  for (const account of state.accounts.values()) {
    const rate = accountReturnForYear(account, yearOffset, returnPhases);
    account.balance = Math.max(0, account.balance * (1 + rate));
  }
}

function applyDebtAmortization(state, paidLiabilityIds) {
  for (const liability of state.liabilities.values()) {
    if (liability.balance <= 0) {
      paidLiabilityIds.add(liability.id);
      continue;
    }
    liability.balance = amortizeOneYear(
      liability.balance,
      liability.interest_rate,
      liabilityPayment(liability)
    );
    if (liability.balance <= 0.01) {
      liability.balance = 0;
      paidLiabilityIds.add(liability.id);
    }
  }
}

function summarizeState(state) {
  let savingsInvestments = 0;
  let realEstate = 0;
  let otherAssets = 0;
  let stockAccounts = 0;

  for (const account of state.accounts.values()) {
    if (account.account_type === 'property') realEstate += account.balance;
    else if (account.account_type === 'other_asset') otherAssets += account.balance;
    else savingsInvestments += account.balance;
    if (account.account_type === 'brokerage') stockAccounts += account.balance;
  }

  const debt = [...state.liabilities.values()].reduce((sum, row) => sum + Math.max(0, row.balance), 0);
  return {
    savingsInvestments,
    realEstate,
    otherAssets,
    stockAccounts,
    debt,
    netWorth: savingsInvestments + realEstate + otherAssets - debt
  };
}

function simulate(data, scenario = {}) {
  const plan = data.plan || {};
  const currentAge = Math.floor(number(plan.current_age, 45));
  const retirementAge = Math.max(currentAge + 1, Math.floor(number(plan.retirement_age, 65)));
  const endAge = Math.max(retirementAge + 1, Math.floor(number(plan.plan_end_age, 95)));
  const currentYear = Math.floor(number(scenario.currentYear, new Date().getUTCFullYear()));
  const state = cloneState(data);
  const paidLiabilityIds = new Set();
  const timeline = [];
  let cumulativeShortfall = 0;
  let cumulativePayoff = 0;

  for (let age = currentAge; age <= endAge; age += 1) {
    const yearOffset = age - currentAge;
    const projectionYear = currentYear + yearOffset;
    const events = [];

    const payoff = payoffTargetsAtAge(
      state,
      scenario.payoffActions || [],
      age,
      events,
      paidLiabilityIds
    );
    cumulativePayoff += payoff.totalPaid;
    cumulativeShortfall += payoff.totalShortfall;

    applyReturns(state, yearOffset, scenario.returnPhases || []);

    const income = householdIncomeForAge(data, age, currentAge, retirementAge, currentYear);
    applyIncome(state, income);

    const contribution = applyContributions(state, data.contributions || [], projectionYear, currentYear);
    cumulativeShortfall += contribution.shortfall;

    const expenses = householdExpensesForAge(
      data,
      age,
      currentAge,
      retirementAge,
      currentYear,
      paidLiabilityIds
    );
    const expensePayment = applyExpenses(state, expenses);
    cumulativeShortfall += expensePayment.shortfall;

    applyDebtAmortization(state, paidLiabilityIds);

    const summary = summarizeState(state);
    timeline.push({
      age,
      year: projectionYear,
      monthlyIncome: round(income.afterTax / 12),
      monthlyExpenses: round(expenses.total / 12),
      monthlyExpensesExcluding529: round((expenses.total - expenses.from529) / 12),
      monthly529Expenses: round(expenses.from529 / 12),
      monthlyNetCashFlow: round((income.afterTax + contribution.external - expenses.total) / 12),
      annualExternalContributions: round(contribution.external),
      annualTransfers: round(contribution.transfers),
      savingsInvestments: round(summary.savingsInvestments),
      stockAccounts: round(summary.stockAccounts),
      realEstate: round(summary.realEstate),
      otherAssets: round(summary.otherAssets),
      debt: round(summary.debt),
      netWorth: round(summary.netWorth),
      events
    });
  }

  return {
    currentAge,
    retirementAge,
    endAge,
    timeline,
    cumulativeShortfall: round(cumulativeShortfall),
    cumulativePayoff: round(cumulativePayoff)
  };
}

function atAge(timeline, age) {
  return timeline.find((row) => row.age === age) || timeline.at(-1) || null;
}

function largestExpenseChange(baseline, scenario) {
  let best = null;
  for (let i = 0; i < Math.min(baseline.length, scenario.length); i += 1) {
    const delta = baseline[i].monthlyExpenses - scenario[i].monthlyExpenses;
    if (!best || delta > best.delta) best = { age: scenario[i].age, delta };
  }
  return best || { age: null, delta: 0 };
}

export function simulateHouseholdWhatIf(data, scenario = {}) {
  const baseline = simulate(data, {});
  const alternative = simulate(data, scenario);
  const baselineRetirement = atAge(baseline.timeline, baseline.retirementAge);
  const scenarioRetirement = atAge(alternative.timeline, alternative.retirementAge);
  const baselineEnd = baseline.timeline.at(-1);
  const scenarioEnd = alternative.timeline.at(-1);
  const expenseChange = largestExpenseChange(baseline.timeline, alternative.timeline);

  return {
    scenario: {
      title: scenario.title || 'What-if scenario',
      summary: scenario.summary || 'Temporary assumptions applied to the current plan.',
      payoffActions: scenario.payoffActions || [],
      returnPhases: scenario.returnPhases || [],
      notes: scenario.notes || []
    },
    baseline,
    alternative,
    metrics: {
      debtPaidFromAssets: alternative.cumulativePayoff,
      monthlyExpenseReduction: round(expenseChange.delta),
      expenseReductionStartsAtAge: expenseChange.delta > 0 ? expenseChange.age : null,
      netWorthAtRetirementBaseline: round(baselineRetirement?.netWorth),
      netWorthAtRetirementScenario: round(scenarioRetirement?.netWorth),
      netWorthAtRetirementChange: round(number(scenarioRetirement?.netWorth) - number(baselineRetirement?.netWorth)),
      netWorthAtEndBaseline: round(baselineEnd?.netWorth),
      netWorthAtEndScenario: round(scenarioEnd?.netWorth),
      netWorthAtEndChange: round(number(scenarioEnd?.netWorth) - number(baselineEnd?.netWorth)),
      scenarioFundingShortfall: alternative.cumulativeShortfall
    }
  };
}

function normalizeHolding(row) {
  const quantity = Math.max(0, number(row.quantity));
  const directValue = number(row.market_value ?? row.current_value ?? row.value, NaN);
  const price = number(
    row.current_price ?? row.last_price ?? row.market_price ?? row.price ?? row.average_cost ?? row.cost_basis,
    0
  );
  const marketValue = Number.isFinite(directValue) && directValue >= 0
    ? directValue
    : quantity * price;
  return {
    id: row.id,
    accountId: row.account_id,
    accountName: row.account_name,
    symbol: String(row.symbol || row.ticker || 'OTHER').toUpperCase(),
    quantity,
    price,
    marketValue: Math.max(0, marketValue)
  };
}

function symbolShockForYear(symbol, yearOffset, scenario) {
  let rate = null;
  for (const shock of scenario.symbolShocks || []) {
    if (String(shock.symbol).toUpperCase() !== symbol) continue;
    const start = Math.max(0, Math.floor(number(shock.startOffset, 0)));
    const end = shock.endOffset == null ? start : Math.max(start, Math.floor(number(shock.endOffset, start)));
    if (yearOffset >= start && yearOffset <= end) rate = clamp(number(shock.annualReturn), -0.95, 3);
  }
  return rate;
}

export function simulatePortfolioWhatIf(data, holdingsRows = [], scenario = {}) {
  const accounts = (data.accounts || []).filter((row) => row.account_type === 'brokerage');
  const selectedAccount = accounts.find((row) => row.id === scenario.accountId) || accounts[0] || null;
  const holdings = holdingsRows.map(normalizeHolding).filter((row) => !selectedAccount || row.accountId === selectedAccount.id);
  const accountValue = selectedAccount ? Math.max(0, number(selectedAccount.current_balance)) : 0;
  const holdingValue = holdings.reduce((sum, row) => sum + row.marketValue, 0);
  const unallocated = Math.max(0, accountValue - holdingValue);
  const currentNetWorth = (data.accounts || []).reduce((sum, row) => sum + number(row.current_balance), 0)
    - (data.liabilities || []).reduce((sum, row) => sum + number(row.current_balance), 0);
  const horizonYears = clamp(Math.floor(number(scenario.horizonYears, 10)), 1, 40);
  const baselineRate = selectedAccount ? defaultReturn(selectedAccount) : 0.07;
  const baselineTimeline = [];
  const alternativeTimeline = [];
  let baselineTotal = accountValue;
  let alternativeBySymbol = new Map(holdings.map((row) => [row.symbol, row.marketValue]));
  let alternativeUnallocated = unallocated;

  for (let offset = 0; offset <= horizonYears; offset += 1) {
    if (offset > 0) {
      baselineTotal *= 1 + baselineRate;
      for (const [symbol, value] of alternativeBySymbol.entries()) {
        const shock = symbolShockForYear(symbol, offset - 1, scenario);
        const phaseRate = accountReturnForYear(
          selectedAccount || { account_type: 'brokerage' },
          offset - 1,
          scenario.returnPhases || []
        );
        alternativeBySymbol.set(symbol, value * (1 + (shock ?? phaseRate)));
      }
      const unallocatedRate = accountReturnForYear(
        selectedAccount || { account_type: 'brokerage' },
        offset - 1,
        scenario.returnPhases || []
      );
      alternativeUnallocated *= 1 + unallocatedRate;
    }

    const alternativeTotal = [...alternativeBySymbol.values()].reduce((sum, value) => sum + value, 0) + alternativeUnallocated;
    baselineTimeline.push({
      yearOffset: offset,
      portfolioValue: round(baselineTotal),
      netWorth: round(currentNetWorth - accountValue + baselineTotal)
    });
    alternativeTimeline.push({
      yearOffset: offset,
      portfolioValue: round(alternativeTotal),
      netWorth: round(currentNetWorth - accountValue + alternativeTotal)
    });
  }

  return {
    account: selectedAccount ? {
      id: selectedAccount.id,
      name: selectedAccount.name,
      currentBalance: round(accountValue),
      baselineReturn: baselineRate
    } : null,
    holdings,
    unallocated: round(unallocated),
    baselineTimeline,
    alternativeTimeline,
    metrics: {
      endingPortfolioBaseline: baselineTimeline.at(-1)?.portfolioValue || 0,
      endingPortfolioScenario: alternativeTimeline.at(-1)?.portfolioValue || 0,
      endingPortfolioChange: round(
        number(alternativeTimeline.at(-1)?.portfolioValue) - number(baselineTimeline.at(-1)?.portfolioValue)
      ),
      endingNetWorthChange: round(
        number(alternativeTimeline.at(-1)?.netWorth) - number(baselineTimeline.at(-1)?.netWorth)
      )
    }
  };
}
