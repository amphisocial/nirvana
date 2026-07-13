import { annualize, expenseAtAge, incomeAtAge } from './retirement-cashflow-engine.js';
import { advanceLoanBalance, mortgagePaymentBreakdown } from './loan-schedule.js';

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

function normalizedWords(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function nameMatchesExpense(expense, liability) {
  const expenseText = normalizedWords(`${expense.name || ''} ${expense.category || ''}`);
  const liabilityName = normalizedWords(liability.name);
  if (!expenseText || !liabilityName) return false;
  return expenseText.includes(liabilityName) || liabilityName.includes(expenseText);
}

function inferLiabilityForExpense(expense, state) {
  if (expense.linked_liability_id) {
    return state.liabilities.get(expense.linked_liability_id) || null;
  }

  const liabilities = [...state.liabilities.values()];
  const direct = liabilities.find((liability) => nameMatchesExpense(expense, liability));
  if (direct) return direct;

  const text = normalizedWords(`${expense.name || ''} ${expense.category || ''}`);

  if (expense.category === 'mortgage' || expense.category === 'mortgage_insurance' || /mortgage|home loan/.test(text)) {
    const mortgages = liabilities.filter((row) => row.liability_type === 'mortgage');
    if (mortgages.length === 1) return mortgages[0];
  }

  if (expense.category === 'debt_payment') {
    const keywordGroups = [
      { pattern: /heloc|home equity/, match: (row) => /heloc|home equity/.test(normalizedWords(`${row.name} ${row.liability_type}`)) },
      { pattern: /car|auto|vehicle/, match: (row) => row.liability_type === 'auto_loan' || /car|auto|vehicle/.test(normalizedWords(row.name)) },
      { pattern: /student/, match: (row) => row.liability_type === 'student_loan' || /student/.test(normalizedWords(row.name)) },
      { pattern: /personal/, match: (row) => row.liability_type === 'personal_loan' || /personal/.test(normalizedWords(row.name)) },
      { pattern: /credit card/, match: (row) => row.liability_type === 'credit_card' || /credit card/.test(normalizedWords(row.name)) }
    ];

    for (const group of keywordGroups) {
      if (!group.pattern.test(text)) continue;
      const matches = liabilities.filter(group.match);
      if (matches.length === 1) return matches[0];
    }

    const nonMortgages = liabilities.filter((row) => row.liability_type !== 'mortgage');
    if (nonMortgages.length === 1) return nonMortgages[0];
  }

  return null;
}

function expenseAmountAfterPayoff(expense, amount, state, paidLiabilityIds) {
  if (!DEBT_SERVICE_CATEGORIES.has(expense.category)) return amount;

  const liability = inferLiabilityForExpense(expense, state);
  if (!liability || !paidLiabilityIds.has(liability.id)) return amount;

  if (expense.category === 'mortgage') {
    const breakdown = mortgagePaymentBreakdown({
      ...liability,
      current_balance: liability.balance
    });
    const paidOffMonthlyComponents = breakdown.principalInterest + breakdown.pmi;
    return Math.max(0, amount - paidOffMonthlyComponents * 12);
  }

  return 0;
}


export function calculateMonthlyMortgagePayment(principal, annualRate, termMonths) {
  const amount = Math.max(0, number(principal));
  const months = Math.max(1, Math.floor(number(termMonths, 360)));
  const monthlyRate = Math.max(0, number(annualRate)) / 12;
  if (amount <= 0) return 0;
  if (monthlyRate <= 0) return amount / months;
  return amount * monthlyRate / (1 - ((1 + monthlyRate) ** -months));
}

function scenarioPropertyId(index) {
  return `scenario-property-${index}`;
}

function scenarioMortgageId(index) {
  return `scenario-mortgage-${index}`;
}

function propertyPurchaseAtAge(state, propertyPurchases, age, events) {
  let cashInvested = 0;
  let fundingShortfall = 0;
  let propertyValueAdded = 0;
  let mortgageAdded = 0;

  (propertyPurchases || []).forEach((action, index) => {
    const purchaseAge = Math.floor(number(action.purchaseAge, -1));
    if (purchaseAge !== age) return;
    const propertyId = action.propertyId || scenarioPropertyId(index);
    if (state.accounts.has(propertyId)) return;

    const propertyValue = Math.max(0, number(action.propertyValue));
    const closingCosts = Math.max(0, number(action.closingCosts));
    const totalCost = propertyValue + closingCosts;
    const requestedMortgage = Math.max(0, number(action.mortgageAmount));
    const cashRequired = Math.max(0, totalCost - requestedMortgage);
    let remainingCash = cashRequired;

    for (const sourceAction of action.fundingSources || []) {
      if (remainingCash <= 0) break;
      const source = state.accounts.get(sourceAction.accountId);
      if (!source) {
        events.push(`Funding source unavailable: ${sourceAction.accountName || sourceAction.accountId}`);
        continue;
      }
      const requested = Math.max(0, number(sourceAction.amount));
      const applied = Math.min(requested, remainingCash);
      const availableBefore = Math.max(0, source.balance);
      source.balance -= applied;
      cashInvested += applied;
      fundingShortfall += Math.max(0, applied - availableBefore);
      remainingCash -= applied;
      events.push(`${round(applied)} liquidated from ${source.name} for the rental purchase`);
    }

    if (remainingCash > 0) {
      const fallback = findDefaultAccount(state);
      if (fallback) {
        const availableBefore = Math.max(0, fallback.balance);
        fallback.balance -= remainingCash;
        fundingShortfall += Math.max(0, remainingCash - availableBefore);
        cashInvested += remainingCash;
        events.push(`${round(remainingCash)} additional cash required from ${fallback.name}`);
      } else {
        fundingShortfall += remainingCash;
      }
      remainingCash = 0;
    }

    state.accounts.set(propertyId, {
      id: propertyId,
      name: action.name || 'Scenario rental property',
      account_type: 'property',
      current_balance: propertyValue,
      balance: propertyValue,
      property_growth_rate: clamp(number(action.annualAppreciationRate, 0.03), -0.2, 0.2),
      is_rental_property: true,
      scenario_property: true
    });
    propertyValueAdded += propertyValue;

    if (requestedMortgage > 0) {
      const mortgageId = action.mortgageId || scenarioMortgageId(index);
      const termMonths = Math.max(1, Math.floor(number(action.mortgageTermMonths, 360)));
      const interestRate = Math.max(0, number(action.mortgageInterestRate));
      const payment = Math.max(0, number(
        action.monthlyMortgagePayment,
        calculateMonthlyMortgagePayment(requestedMortgage, interestRate, termMonths)
      ));
      state.liabilities.set(mortgageId, {
        id: mortgageId,
        name: `${action.name || 'Scenario rental property'} mortgage`,
        liability_type: 'mortgage',
        original_amount: requestedMortgage,
        current_balance: requestedMortgage,
        balance: requestedMortgage,
        interest_rate: interestRate,
        original_term_months: termMonths,
        current_term_month: 0,
        principal_interest_payment: payment,
        monthly_payment: payment,
        linked_account_id: propertyId,
        scenario_property: true
      });
      mortgageAdded += requestedMortgage;
    }

    events.push(`${action.name || 'Rental property'} purchased for ${round(propertyValue)}${closingCosts ? ` plus ${round(closingCosts)} closing costs` : ''}`);
  });

  return { cashInvested, fundingShortfall, propertyValueAdded, mortgageAdded };
}

function scenarioRentalCashFlow(state, propertyPurchases, age, effectiveTaxRate) {
  let grossAnnual = 0;
  let afterTaxAnnual = 0;
  let operatingAnnual = 0;
  let mortgageAnnual = 0;
  const incomeItems = [];
  const expenseItems = [];

  (propertyPurchases || []).forEach((action, index) => {
    const purchaseAge = Math.floor(number(action.purchaseAge, -1));
    if (age < purchaseAge) return;
    const propertyId = action.propertyId || scenarioPropertyId(index);
    if (!state.accounts.has(propertyId)) return;
    const years = Math.max(0, age - purchaseAge);
    const rentGrowth = clamp(number(action.rentGrowthRate, 0.03), -0.1, 0.2);
    const expenseGrowth = clamp(number(action.expenseGrowthRate, 0.03), -0.1, 0.2);
    const annualRent = Math.max(0, number(action.monthlyRent)) * 12 * ((1 + rentGrowth) ** years);
    const vacancy = annualRent * clamp(number(action.vacancyRate, 0.05), 0, 0.5);
    const management = annualRent * clamp(number(action.managementRate, 0.08), 0, 0.5);
    const fixedAnnual = (
      Math.max(0, number(action.annualPropertyTax))
      + Math.max(0, number(action.annualInsurance))
      + Math.max(0, number(action.monthlyHoa)) * 12
      + Math.max(0, number(action.monthlyMaintenance)) * 12
    ) * ((1 + expenseGrowth) ** years);
    const annualOperating = vacancy + management + fixedAnnual;
    const mortgage = state.liabilities.get(action.mortgageId || scenarioMortgageId(index));
    const annualMortgage = mortgage && mortgage.balance > 0
      ? Math.max(0, number(mortgage.principal_interest_payment || mortgage.monthly_payment)) * 12
      : 0;
    const annualAfterTax = annualRent * (1 - clamp(number(effectiveTaxRate, 0.15), 0, 0.6));

    grossAnnual += annualRent;
    afterTaxAnnual += annualAfterTax;
    operatingAnnual += annualOperating;
    mortgageAnnual += annualMortgage;

    incomeItems.push({
      item: { deposit_account_id: action.depositAccountId || null, scenario_property: true },
      afterTax: annualAfterTax
    });
    if (annualOperating + annualMortgage > 0) {
      expenseItems.push({
        item: {
          payment_account_id: action.depositAccountId || null,
          funding_policy: 'linked_then_liquid',
          scenario_property: true
        },
        amount: annualOperating + annualMortgage
      });
    }
  });

  return {
    grossAnnual,
    afterTaxAnnual,
    operatingAnnual,
    mortgageAnnual,
    incomeItems,
    expenseItems
  };
}

function payoffTargetsAtAge(state, payoffActions, age, events, paidLiabilityIds) {
  let totalPaid = 0;
  let totalShortfall = 0;

  for (const action of payoffActions || []) {
    if (Math.floor(number(action.age, -1)) !== age) continue;
    const source = state.accounts.get(action.sourceAccountId);
    if (!source) {
      events.push('Payoff skipped: source account was unavailable');
      continue;
    }

    const targetIds = Array.isArray(action.liabilityIds) ? action.liabilityIds : [];
    for (const id of targetIds) {
      const liability = state.liabilities.get(id);
      if (!liability || liability.balance <= 0) continue;

      const payoffAmount = Math.max(0, liability.balance);
      const availableBeforePayoff = Math.max(0, source.balance);
      const shortfall = Math.max(0, payoffAmount - availableBeforePayoff);

      // Model the requested payoff in full. A negative account balance is a
      // visible funding gap, not a silent partial payoff.
      source.balance -= payoffAmount;
      liability.balance = 0;
      paidLiabilityIds.add(id);

      totalPaid += payoffAmount;
      totalShortfall += shortfall;

      if (shortfall > 0) {
        events.push(`${liability.name} paid off from ${source.name}; funding gap ${round(shortfall)}`);
      } else {
        events.push(`${liability.name} paid off from ${source.name}`);
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

function householdExpensesForAge(data, state, age, currentAge, retirementAge, currentYear, paidLiabilityIds) {
  return (data.expenses || []).reduce((total, item) => {
    const scheduledAmount = expenseAtAge(item, age, currentAge, retirementAge, currentYear);
    const amount = expenseAmountAfterPayoff(
      item,
      scheduledAmount,
      state,
      paidLiabilityIds
    );

    total.total += amount;
    if (item.payment_account_type === '529') total.from529 += amount;
    if (amount > 0) total.items.push({ item, amount });
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
    if (account.balance <= 0) continue;
    const rate = accountReturnForYear(account, yearOffset, returnPhases);
    account.balance *= 1 + rate;
  }
}

function applyDebtAmortization(state, paidLiabilityIds) {
  for (const liability of state.liabilities.values()) {
    if (liability.balance <= 0) {
      paidLiabilityIds.add(liability.id);
      continue;
    }

    let months = 12;
    const originalTermMonths = Math.max(0, Math.floor(number(liability.original_term_months)));
    const currentTermMonth = liability.current_term_month == null
      ? null
      : Math.max(0, Math.floor(number(liability.current_term_month)));

    if (originalTermMonths > 0 && currentTermMonth != null) {
      const remainingMonths = Math.max(0, originalTermMonths - currentTermMonth);
      months = Math.min(12, remainingMonths);
      if (months <= 0) continue;
    }

    liability.balance = advanceLoanBalance({
      ...liability,
      current_balance: liability.balance
    }, months);

    if (currentTermMonth != null) {
      liability.current_term_month = currentTermMonth + months;
    }

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
  const trackedAccountId = scenario.trackingAccountId
    || scenario.payoffActions?.[0]?.sourceAccountId
    || scenario.propertyPurchases?.[0]?.fundingSources?.[0]?.accountId
    || null;
  const state = cloneState(data);
  const paidLiabilityIds = new Set();
  const timeline = [];
  let cumulativeShortfall = 0;
  let cumulativePayoffShortfall = 0;
  let cumulativePayoff = 0;
  let cumulativePropertyFundingShortfall = 0;
  let cumulativePropertyCashInvested = 0;
  let propertyValueAdded = 0;
  let mortgageAdded = 0;

  for (let age = currentAge; age <= endAge; age += 1) {
    const yearOffset = age - currentAge;
    const projectionYear = currentYear + yearOffset;
    const events = [];

    const purchase = propertyPurchaseAtAge(
      state,
      scenario.propertyPurchases || [],
      age,
      events
    );
    cumulativePropertyFundingShortfall += purchase.fundingShortfall;
    cumulativePropertyCashInvested += purchase.cashInvested;
    propertyValueAdded += purchase.propertyValueAdded;
    mortgageAdded += purchase.mortgageAdded;
    cumulativeShortfall += purchase.fundingShortfall;

    const payoff = payoffTargetsAtAge(
      state,
      scenario.payoffActions || [],
      age,
      events,
      paidLiabilityIds
    );
    cumulativePayoff += payoff.totalPaid;
    cumulativePayoffShortfall += payoff.totalShortfall;
    cumulativeShortfall += payoff.totalShortfall;

    const income = householdIncomeForAge(data, age, currentAge, retirementAge, currentYear);
    const rental = scenarioRentalCashFlow(
      state,
      scenario.propertyPurchases || [],
      age,
      number(data.plan?.effective_tax_rate, 0.15)
    );
    income.gross += rental.grossAnnual;
    income.afterTax += rental.afterTaxAnnual;
    income.items.push(...rental.incomeItems);

    const expenses = householdExpensesForAge(
      data,
      state,
      age,
      currentAge,
      retirementAge,
      currentYear,
      paidLiabilityIds
    );
    expenses.total += rental.operatingAnnual + rental.mortgageAnnual;
    expenses.items.push(...rental.expenseItems);
    const summary = summarizeState(state);

    timeline.push({
      age,
      year: projectionYear,
      monthlyIncome: round(income.afterTax / 12),
      monthlyExpenses: round(expenses.total / 12),
      monthlyExpensesExcluding529: round((expenses.total - expenses.from529) / 12),
      monthly529Expenses: round(expenses.from529 / 12),
      monthlyNetCashFlow: round((income.afterTax - expenses.total) / 12),
      scenarioMonthlyRentalIncome: round(rental.afterTaxAnnual / 12),
      scenarioMonthlyGrossRent: round(rental.grossAnnual / 12),
      scenarioMonthlyPropertyExpenses: round(rental.operatingAnnual / 12),
      scenarioMonthlyMortgagePayment: round(rental.mortgageAnnual / 12),
      annualExternalContributions: 0,
      annualTransfers: 0,
      savingsInvestments: round(summary.savingsInvestments),
      stockAccounts: round(summary.stockAccounts),
      fundingAccountBalance: round(
        trackedAccountId
          ? state.accounts.get(trackedAccountId)?.balance
          : summary.stockAccounts
      ),
      realEstate: round(summary.realEstate),
      otherAssets: round(summary.otherAssets),
      debt: round(summary.debt),
      netWorth: round(summary.netWorth),
      events
    });

    if (age === endAge) break;

    applyReturns(state, yearOffset, scenario.returnPhases || []);
    applyIncome(state, income);

    const contribution = applyContributions(state, data.contributions || [], projectionYear, currentYear);
    cumulativeShortfall += contribution.shortfall;

    const expensePayment = applyExpenses(state, expenses);
    cumulativeShortfall += expensePayment.shortfall;

    applyDebtAmortization(state, paidLiabilityIds);

    const row = timeline.at(-1);
    row.monthlyNetCashFlow = round(
      (income.afterTax + contribution.external - expenses.total) / 12
    );
    row.annualExternalContributions = round(contribution.external);
    row.annualTransfers = round(contribution.transfers);
  }

  return {
    currentAge,
    retirementAge,
    endAge,
    timeline,
    cumulativeShortfall: round(cumulativeShortfall),
    cumulativePayoffShortfall: round(cumulativePayoffShortfall),
    cumulativePayoff: round(cumulativePayoff),
    cumulativePropertyFundingShortfall: round(cumulativePropertyFundingShortfall),
    cumulativePropertyCashInvested: round(cumulativePropertyCashInvested),
    propertyValueAdded: round(propertyValueAdded),
    mortgageAdded: round(mortgageAdded)
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
  const trackingAccountId = scenario.payoffActions?.[0]?.sourceAccountId || null;
  const baseline = simulate(data, { trackingAccountId });
  const alternative = simulate(data, { ...scenario, trackingAccountId });
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
      propertyPurchases: scenario.propertyPurchases || [],
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
      scenarioFundingShortfall: round(
        alternative.cumulativePayoffShortfall + alternative.cumulativePropertyFundingShortfall
      ),
      propertyFundingShortfall: alternative.cumulativePropertyFundingShortfall,
      propertyCashInvested: alternative.cumulativePropertyCashInvested,
      propertyValueAdded: alternative.propertyValueAdded,
      propertyMortgageAdded: alternative.mortgageAdded,
      scenarioOtherFundingShortfall: round(
        alternative.cumulativeShortfall
          - alternative.cumulativePayoffShortfall
          - alternative.cumulativePropertyFundingShortfall
      ),
      fundingAccountMinimumBalance: round(Math.min(
        ...alternative.timeline.map((row) => number(row.fundingAccountBalance))
      ))
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
