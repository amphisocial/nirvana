function asNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round(value, digits = 2) {
  const multiplier = 10 ** digits;
  return Math.round((value + Number.EPSILON) * multiplier) / multiplier;
}

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function normalRandom(random) {
  let u = 0;
  let v = 0;
  while (u === 0) u = random();
  while (v === 0) v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function percentile(sortedValues, p) {
  if (!sortedValues.length) return 0;
  const index = (sortedValues.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sortedValues[lower];
  return sortedValues[lower] + (sortedValues[upper] - sortedValues[lower]) * (index - lower);
}

export function annualize(amount, frequency = 'annual') {
  const value = Math.max(0, asNumber(amount));
  const multipliers = {
    weekly: 52,
    biweekly: 26,
    monthly: 12,
    quarterly: 4,
    annual: 1
  };
  return value * (multipliers[frequency] || 1);
}

function isActive(item, age) {
  const startAge = item.start_age == null ? null : asNumber(item.start_age);
  const endAge = item.end_age == null ? null : asNumber(item.end_age);
  return (startAge == null || age >= startAge) && (endAge == null || age <= endAge);
}

function inflate(amount, rate, years) {
  return amount * ((1 + asNumber(rate)) ** Math.max(0, years));
}

export function incomeAtAge(item, age, currentAge, retirementAge) {
  if (!isActive(item, age)) return { gross: 0, taxable: 0, nonTaxable: 0 };
  if (item.ends_at_retirement && age >= retirementAge) return { gross: 0, taxable: 0, nonTaxable: 0 };
  const gross = inflate(asNumber(item.annual_amount), item.inflation_rate, age - currentAge);
  return {
    gross,
    taxable: item.taxable === false ? 0 : gross,
    nonTaxable: item.taxable === false ? gross : 0
  };
}

export function expenseAtAge(item, age, currentAge, retirementAge) {
  if (!isActive(item, age)) return 0;
  const isRetired = age >= retirementAge;
  let amount = asNumber(item.annual_amount);

  if (isRetired) {
    if (item.retirement_behavior === 'ends') return 0;
    if (item.retirement_behavior === 'starts' || item.retirement_behavior === 'custom') {
      amount = asNumber(item.post_retirement_annual_amount);
    }
  } else if (item.retirement_behavior === 'starts') {
    return 0;
  }

  return inflate(amount, item.inflation_rate, age - currentAge);
}

function accountDefaults(type) {
  const map = {
    cash: { expectedReturn: 0.02, volatility: 0.01 },
    brokerage: { expectedReturn: 0.07, volatility: 0.17 },
    ira: { expectedReturn: 0.06, volatility: 0.12 },
    '401k': { expectedReturn: 0.06, volatility: 0.12 },
    retirement: { expectedReturn: 0.06, volatility: 0.12 },
    hsa: { expectedReturn: 0.06, volatility: 0.12 },
    '529': { expectedReturn: 0.055, volatility: 0.11 }
  };
  return map[type] || { expectedReturn: 0.05, volatility: 0.10 };
}

export function summarizeInvestableAccounts(accounts = [], plan = {}) {
  const investableTypes = new Set(['cash', 'brokerage', 'ira', '401k', 'retirement', 'hsa']);
  const rows = accounts.filter((account) => investableTypes.has(account.account_type));
  const startingPortfolio = rows.reduce((sum, row) => sum + asNumber(row.current_balance), 0);

  if (!startingPortfolio) {
    return {
      startingPortfolio: 0,
      expectedReturn: asNumber(plan.expected_return, 0.065),
      volatility: asNumber(plan.volatility, 0.14),
      accounts: []
    };
  }

  let weightedReturn = 0;
  let weightedVolatility = 0;
  const normalized = rows.map((row) => {
    const balance = asNumber(row.current_balance);
    const defaults = accountDefaults(row.account_type);
    const expectedReturn = row.expected_return == null
      ? defaults.expectedReturn
      : asNumber(row.expected_return, defaults.expectedReturn);
    const volatility = row.expected_volatility == null
      ? defaults.volatility
      : asNumber(row.expected_volatility, defaults.volatility);
    weightedReturn += balance * expectedReturn;
    weightedVolatility += balance * volatility;
    return {
      id: row.id,
      name: row.name,
      accountType: row.account_type,
      balance: round(balance),
      investmentStyle: row.investment_style || null,
      expectedReturn,
      volatility
    };
  });

  return {
    startingPortfolio: round(startingPortfolio),
    expectedReturn: weightedReturn / startingPortfolio,
    volatility: weightedVolatility / startingPortfolio,
    accounts: normalized
  };
}

function homeReleaseAtAge(properties, age, currentAge, retirementAge) {
  let total = 0;
  for (const property of properties) {
    if (!property.is_primary_residence) continue;
    const treatment = property.retirement_treatment || 'keep';
    if (['keep', 'convert_to_rental', 'undecided'].includes(treatment)) continue;
    const eventAge = treatment === 'sell_at_retirement'
      ? retirementAge
      : asNumber(property.retirement_treatment_age, retirementAge);
    if (age !== eventAge) continue;
    const release = asNumber(property.retirement_cash_release);
    if (release <= 0) continue;
    total += inflate(release, property.property_growth_rate, age - currentAge);
  }
  return total;
}

function buildYearCashflow({
  age,
  currentAge,
  retirementAge,
  incomes,
  expenses,
  annualContribution,
  taxRate,
  fallbackRetirementSpending,
  fallbackInflation,
  hasDetailedExpenses
}) {
  const income = incomes.reduce((total, item) => {
    const result = incomeAtAge(item, age, currentAge, retirementAge);
    total.gross += result.gross;
    total.taxable += result.taxable;
    total.nonTaxable += result.nonTaxable;
    return total;
  }, { gross: 0, taxable: 0, nonTaxable: 0 });

  const expensesAnnual = hasDetailedExpenses
    ? expenses.reduce((sum, item) => sum + expenseAtAge(item, age, currentAge, retirementAge), 0)
    : (age >= retirementAge
      ? inflate(fallbackRetirementSpending, fallbackInflation, age - retirementAge)
      : 0);

  const afterTaxIncome = income.nonTaxable + income.taxable * (1 - taxRate);
  const contribution = age < retirementAge ? annualContribution : 0;
  const householdCashFlow = afterTaxIncome - expensesAnnual - contribution;
  const retirementCashFlow = afterTaxIncome - expensesAnnual;
  const portfolioWithdrawal = age >= retirementAge && retirementCashFlow < 0
    ? Math.abs(retirementCashFlow) / Math.max(0.01, 1 - taxRate)
    : 0;
  const portfolioInflow = age < retirementAge
    ? contribution
    : Math.max(0, retirementCashFlow);

  return {
    incomeGross: income.gross,
    incomeAfterTax: afterTaxIncome,
    expensesAnnual,
    contribution,
    portfolioWithdrawal,
    portfolioInflow,
    netCashFlow: householdCashFlow
  };
}

function simulateCandidate(input, retirementAge, simulationCount, seed) {
  const currentAge = Math.floor(asNumber(input.currentAge, 45));
  const endAge = Math.max(retirementAge + 1, Math.floor(asNumber(input.endAge, 95)));
  const taxRate = Math.min(0.6, Math.max(0, asNumber(input.effectiveTaxRate, 0.15)));
  const annualContribution = Math.max(0, asNumber(input.annualContribution));
  const expectedReturn = asNumber(input.expectedReturn, 0.065);
  const volatility = Math.max(0, asNumber(input.volatility, 0.14));
  const startingPortfolio = Math.max(0, asNumber(input.startingPortfolio));
  const incomes = input.incomes || [];
  const expenses = input.expenses || [];
  const properties = input.properties || [];
  const hasDetailedExpenses = expenses.length > 0;
  const fallbackRetirementSpending = Math.max(0, asNumber(input.annualRetirementSpending));
  const fallbackInflation = asNumber(input.inflation, 0.025);
  const ages = [];
  for (let age = currentAge; age <= endAge; age += 1) ages.push(age);

  const deterministic = [];
  const cashflowTimeline = [];
  let deterministicBalance = startingPortfolio;
  for (const age of ages) {
    const cashflow = buildYearCashflow({
      age,
      currentAge,
      retirementAge,
      incomes,
      expenses,
      annualContribution,
      taxRate,
      fallbackRetirementSpending,
      fallbackInflation,
      hasDetailedExpenses
    });
    const homeRelease = homeReleaseAtAge(properties, age, currentAge, retirementAge);
    deterministic.push(round(Math.max(0, deterministicBalance)));
    cashflowTimeline.push({
      age,
      monthlyIncome: round(cashflow.incomeAfterTax / 12),
      monthlyExpenses: round(cashflow.expensesAnnual / 12),
      monthlyContribution: round(cashflow.contribution / 12),
      monthlyPortfolioWithdrawal: round(cashflow.portfolioWithdrawal / 12),
      monthlyNetCashFlow: round(cashflow.netCashFlow / 12),
      homeEquityRelease: round(homeRelease)
    });
    deterministicBalance = deterministicBalance * (1 + expectedReturn)
      + cashflow.portfolioInflow
      + homeRelease
      - cashflow.portfolioWithdrawal;
    deterministicBalance = Math.max(0, deterministicBalance);
  }

  const balancesByYear = ages.map(() => []);
  let successes = 0;
  const random = seededRandom(seed);
  for (let run = 0; run < simulationCount; run += 1) {
    let balance = startingPortfolio;
    let depletedAfterRetirement = false;
    for (let index = 0; index < ages.length; index += 1) {
      const age = ages[index];
      balancesByYear[index].push(Math.max(0, balance));
      const cashflow = buildYearCashflow({
        age,
        currentAge,
        retirementAge,
        incomes,
        expenses,
        annualContribution,
        taxRate,
        fallbackRetirementSpending,
        fallbackInflation,
        hasDetailedExpenses
      });
      const annualReturn = Math.max(-0.95, expectedReturn + volatility * normalRandom(random));
      balance = balance * (1 + annualReturn)
        + cashflow.portfolioInflow
        + homeReleaseAtAge(properties, age, currentAge, retirementAge)
        - cashflow.portfolioWithdrawal;
      if (age >= retirementAge && balance <= 0) {
        balance = 0;
        depletedAfterRetirement = true;
      }
    }
    if (!depletedAfterRetirement && balance > 0) successes += 1;
  }

  const p10 = [];
  const p50 = [];
  const p90 = [];
  for (const values of balancesByYear) {
    values.sort((a, b) => a - b);
    p10.push(round(percentile(values, 0.10)));
    p50.push(round(percentile(values, 0.50)));
    p90.push(round(percentile(values, 0.90)));
  }

  return {
    retirementAge,
    successRatePct: round((successes / simulationCount) * 100, 1),
    ages,
    deterministic,
    p10,
    p50,
    p90,
    cashflowTimeline,
    monthlyExpensesAtRetirement: cashflowTimeline.find((row) => row.age === retirementAge)?.monthlyExpenses || 0,
    monthlyIncomeAtRetirement: cashflowTimeline.find((row) => row.age === retirementAge)?.monthlyIncome || 0
  };
}

export function evaluateRetirementPlan(input) {
  const currentAge = Math.max(18, Math.floor(asNumber(input.currentAge, 45)));
  const selectedRetirementAge = Math.max(currentAge + 1, Math.floor(asNumber(input.retirementAge, 65)));
  const endAge = Math.max(selectedRetirementAge + 1, Math.floor(asNumber(input.endAge, 95)));
  const maxSearchAge = Math.min(endAge - 1, Math.max(selectedRetirementAge, Math.floor(asNumber(input.maxSearchAge, 75))));
  const successThreshold = Math.min(0.99, Math.max(0.5, asNumber(input.successThreshold, 0.90)));
  const simulationCount = Math.min(5000, Math.max(250, Math.floor(asNumber(input.simulationCount, 1000))));
  const searchSimulationCount = Math.min(600, Math.max(250, Math.floor(asNumber(input.searchSimulationCount, 350))));

  const selected = simulateCandidate(input, selectedRetirementAge, simulationCount, 20260712 + selectedRetirementAge);
  const ageResults = [];
  let earliestFeasibleAge = null;
  for (let age = currentAge + 1; age <= maxSearchAge; age += 1) {
    const result = age === selectedRetirementAge
      ? selected
      : simulateCandidate(input, age, searchSimulationCount, 20260712 + age);
    ageResults.push({
      retirementAge: age,
      successRatePct: result.successRatePct,
      medianAtEnd: result.p50.at(-1),
      downsideAtEnd: result.p10.at(-1),
      monthlyExpensesAtRetirement: result.monthlyExpensesAtRetirement,
      monthlyIncomeAtRetirement: result.monthlyIncomeAtRetirement
    });
    if (earliestFeasibleAge == null && result.successRatePct >= successThreshold * 100) {
      earliestFeasibleAge = age;
    }
  }

  let readiness = 'Needs attention';
  if (selected.successRatePct >= successThreshold * 100) readiness = 'On track';
  else if (selected.successRatePct >= Math.max(65, successThreshold * 100 - 15)) readiness = 'Watch closely';

  return {
    ...selected,
    readiness,
    earliestFeasibleAge,
    successThresholdPct: round(successThreshold * 100, 1),
    ageResults,
    inputs: {
      currentAge,
      retirementAge: selectedRetirementAge,
      endAge,
      startingPortfolio: round(input.startingPortfolio),
      annualContribution: round(input.annualContribution),
      annualRetirementSpending: round(input.annualRetirementSpending),
      expectedReturn: input.expectedReturn,
      volatility: input.volatility,
      inflation: input.inflation,
      effectiveTaxRate: input.effectiveTaxRate,
      simulationCount
    },
    assumptions: [
      'Primary-residence value is included in net worth but excluded from retirement funding unless a cash-release scenario is explicitly entered.',
      'Detailed income and expense rows drive cash flow. The plan-level retirement spending amount is used only when no expenses have been saved.',
      'Portfolio returns are modeled using the balance-weighted expected return and volatility of investable accounts.',
      'Taxes are approximated using the effective tax rate. Detailed federal, state, Social Security, Medicare, and RMD tax rules are not yet modeled.',
      'Monte Carlo results are hypothetical and are not guarantees.'
    ]
  };
}
