import { expenseAtAge, incomeAtAge } from './retirement-cashflow-engine.js';
import { advanceLoanBalance, loanTermPosition } from './loan-schedule.js';

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round(value, digits = 2) {
  const multiplier = 10 ** digits;
  return Math.round((number(value) + Number.EPSILON) * multiplier) / multiplier;
}

function accountRate(account) {
  if (account.account_type === 'property') return number(account.property_growth_rate, 0.03);
  if (account.forecast_expected_return != null) return number(account.forecast_expected_return);
  if (account.expected_return != null) return number(account.expected_return);
  return {
    cash: 0.02,
    brokerage: 0.07,
    ira: 0.06,
    '401k': 0.06,
    retirement: 0.06,
    hsa: 0.06,
    '529': 0.055,
    other_asset: 0.01
  }[account.account_type] ?? 0.02;
}

function isLiquidAccount(account) {
  return ['cash', 'brokerage', 'ira', '401k', 'retirement', 'hsa', '529'].includes(account.account_type);
}

function preferredDefaultAccount(accounts) {
  return accounts.find((account) => account.account_type === 'cash')
    || accounts.find((account) => ['brokerage', 'ira', '401k', 'retirement', 'hsa'].includes(account.account_type))
    || null;
}

function applyFlow(accounts, requestedAccountId, amount, cashDeficitState) {
  if (!amount) return;
  const defaultAccount = preferredDefaultAccount(accounts);
  const requested = requestedAccountId
    ? accounts.find((account) => account.id === requestedAccountId)
    : null;
  const target = requested || defaultAccount;

  if (amount > 0) {
    if (target) target.balance += amount;
    else cashDeficitState.value += amount;
    return;
  }

  let remaining = Math.abs(amount);
  const drawOrder = [];
  if (target && isLiquidAccount(target)) drawOrder.push(target);
  if (defaultAccount && !drawOrder.includes(defaultAccount)) drawOrder.push(defaultAccount);
  for (const account of accounts) {
    if (isLiquidAccount(account) && !drawOrder.includes(account)) drawOrder.push(account);
  }

  for (const account of drawOrder) {
    const draw = Math.min(account.balance, remaining);
    account.balance -= draw;
    remaining -= draw;
    if (remaining <= 0) break;
  }
  if (remaining > 0) cashDeficitState.value -= remaining;
}


function linkedPropertyLiabilities(accounts, liabilities, property) {
  const directlyLinked = liabilities.filter((row) => row.linked_account_id === property.id && row.current_balance > 0);
  if (directlyLinked.length) return directlyLinked;
  const properties = accounts.filter((row) => row.account_type === 'property');
  const unlinkedMortgages = liabilities.filter((row) =>
    row.liability_type === 'mortgage' && !row.linked_account_id && row.current_balance > 0
  );
  if (property.is_primary_residence && properties.length === 1 && unlinkedMortgages.length === 1) {
    return unlinkedMortgages;
  }
  return [];
}

function applyPropertyEvents({ accounts, liabilities, age, currentAge, retirementAge, cashDeficit, appliedEvents }) {
  const events = [];
  for (const property of accounts.filter((row) => row.account_type === 'property')) {
    const treatment = property.retirement_treatment || 'keep';
    if (['keep', 'convert_to_rental', 'undecided'].includes(treatment)) continue;
    const eventAge = treatment === 'sell_at_retirement'
      ? retirementAge
      : number(property.retirement_treatment_age, retirementAge);
    const eventKey = `${property.id}:${treatment}`;
    if (age !== eventAge || appliedEvents.has(eventKey)) continue;

    const linkedDebts = linkedPropertyLiabilities(accounts, liabilities, property);
    const debtPayoff = linkedDebts.reduce((sum, row) => sum + number(row.current_balance), 0);
    const configuredRelease = number(property.retirement_cash_release);
    const inflationYears = Math.max(0, age - currentAge);
    const inflatedRelease = configuredRelease > 0
      ? configuredRelease * ((1 + number(property.property_growth_rate, 0.03)) ** inflationYears)
      : 0;

    if (treatment === 'equity_access') {
      if (inflatedRelease > 0) {
        applyFlow(accounts, null, inflatedRelease, cashDeficit);
        cashDeficit.value -= inflatedRelease;
      }
      events.push(`${property.name}: home-equity access`);
      appliedEvents.add(eventKey);
      continue;
    }

    if (treatment === 'downsize') {
      const release = inflatedRelease || Math.max(0, property.balance * 0.25);
      const newPropertyValue = Math.max(0, property.balance - debtPayoff - release);
      property.balance = newPropertyValue;
      linkedDebts.forEach((row) => { row.current_balance = 0; });
      applyFlow(accounts, null, release, cashDeficit);
      events.push(`${property.name}: downsized`);
      appliedEvents.add(eventKey);
      continue;
    }

    const netProceeds = inflatedRelease || Math.max(0, property.balance - debtPayoff);
    property.balance = 0;
    linkedDebts.forEach((row) => { row.current_balance = 0; });
    applyFlow(accounts, null, netProceeds, cashDeficit);
    events.push(`${property.name}: sold`);
    appliedEvents.add(eventKey);
  }
  return events;
}

function categories(accounts, liabilities, cashDeficit) {
  const savingsInvestments = accounts
    .filter((account) => ['cash', 'brokerage', 'ira', '401k', 'retirement', 'hsa', '529'].includes(account.account_type))
    .reduce((sum, account) => sum + account.balance, 0);
  const realEstate = accounts
    .filter((account) => account.account_type === 'property')
    .reduce((sum, account) => sum + account.balance, 0);
  const otherAssets = accounts
    .filter((account) => !['cash', 'brokerage', 'ira', '401k', 'retirement', 'hsa', '529', 'property'].includes(account.account_type))
    .reduce((sum, account) => sum + account.balance, 0);
  const debtBalance = liabilities.reduce((sum, liability) => sum + liability.current_balance, 0)
    + Math.max(0, -cashDeficit);
  const netWorth = savingsInvestments + realEstate + otherAssets - debtBalance + Math.max(0, cashDeficit);
  return { savingsInvestments, realEstate, otherAssets, debtBalance, netWorth };
}

function annualCashflow({ age, currentAge, retirementAge, incomes, expenses, taxRate }) {
  const income = incomes.reduce((total, item) => {
    const value = incomeAtAge(item, age, currentAge, retirementAge);
    total.gross += value.gross;
    total.taxable += value.taxable;
    total.nonTaxable += value.nonTaxable;
    return total;
  }, { gross: 0, taxable: 0, nonTaxable: 0 });
  const afterTax = income.nonTaxable + income.taxable * (1 - taxRate);
  const outflow = expenses.reduce(
    (sum, item) => sum + expenseAtAge(item, age, currentAge, retirementAge),
    0
  );
  return { grossIncome: income.gross, afterTaxIncome: afterTax, outflow, net: afterTax - outflow };
}

function updateLiabilities(liabilities) {
  for (const liability of liabilities) {
    if (liability.current_balance <= 0) continue;
    const term = loanTermPosition(liability);
    if (term.originalTermMonths && term.elapsedMonths >= term.originalTermMonths) {
      liability.current_balance = 0;
      continue;
    }
    liability.current_balance = advanceLoanBalance(liability, 12);
    if (liability.current_term_month != null) liability.current_term_month += 12;
  }
}

export function projectHouseholdNetWorth(input) {
  const currentAge = Math.max(18, Math.floor(number(input.currentAge, 45)));
  const retirementAge = Math.max(currentAge + 1, Math.floor(number(input.retirementAge, 65)));
  const endAge = Math.max(retirementAge + 1, Math.floor(number(input.endAge, 95)));
  const taxRate = Math.min(0.6, Math.max(0, number(input.effectiveTaxRate, 0.15)));
  const currentYear = Math.floor(number(input.currentYear, new Date().getUTCFullYear()));
  const detailedCashflow = (input.incomes?.length || 0) + (input.expenses?.length || 0) > 0;
  const annualContribution = Math.max(0, number(input.annualContribution));
  const accounts = (input.accounts || []).map((row) => ({
    ...row,
    balance: Math.max(0, number(row.current_balance)),
    growthRate: accountRate(row)
  }));
  // Always maintain a projected cash bucket so unlinked income, expenses, and
  // property proceeds remain visible even when the household has not entered a
  // manual cash account yet.
  if (!preferredDefaultAccount(accounts)) {
    accounts.push({
      id: '__projected_cash__',
      name: 'Projected cash',
      account_type: 'cash',
      balance: 0,
      growthRate: 0.02,
      synthetic: true
    });
  }
  const liabilities = (input.liabilities || []).map((row) => ({
    ...row,
    current_balance: Math.max(0, number(row.current_balance)),
    interest_rate: Math.max(0, number(row.interest_rate))
  }));
  const incomes = input.incomes || [];
  const expenses = input.expenses || [];
  const timeline = [];
  const cashDeficit = { value: 0 };
  const appliedPropertyEvents = new Set();

  for (let age = currentAge; age <= endAge; age += 1) {
    const events = applyPropertyEvents({
      accounts, liabilities, age, currentAge, retirementAge,
      cashDeficit, appliedEvents: appliedPropertyEvents
    });
    if (age === retirementAge) events.push('Retirement');
    const flow = annualCashflow({ age, currentAge, retirementAge, incomes, expenses, taxRate });
    const totals = categories(accounts, liabilities, cashDeficit.value);
    timeline.push({
      age,
      year: currentYear + (age - currentAge),
      savingsInvestments: round(totals.savingsInvestments),
      realEstate: round(totals.realEstate),
      otherAssets: round(totals.otherAssets),
      debts: round(-totals.debtBalance),
      netWorth: round(totals.netWorth),
      annualInflow: round(flow.afterTaxIncome),
      annualOutflow: round(flow.outflow),
      annualNetCashFlow: round(flow.net),
      events
    });
    if (age === endAge) break;

    for (const account of accounts) {
      account.balance = Math.max(0, account.balance * (1 + account.growthRate));
    }

    if (detailedCashflow) {
      for (const income of incomes) {
        const value = incomeAtAge(income, age, currentAge, retirementAge);
        const afterTax = value.nonTaxable + value.taxable * (1 - taxRate);
        applyFlow(accounts, income.deposit_account_id, afterTax, cashDeficit);
      }
      for (const expense of expenses) {
        const amount = expenseAtAge(expense, age, currentAge, retirementAge);
        applyFlow(accounts, expense.payment_account_id, -amount, cashDeficit);
      }
    } else if (age < retirementAge) {
      applyFlow(accounts, null, annualContribution, cashDeficit);
    }

    updateLiabilities(liabilities);
  }

  const retirementPoint = timeline.find((point) => point.age === retirementAge) || null;
  const longevityPoint = timeline.at(-1) || null;
  return {
    currentAge,
    retirementAge,
    longevityAge: endAge,
    timeline,
    atRetirement: retirementPoint,
    atLongevity: longevityPoint,
    assumptions: [
      'Income is added to its linked account after the effective tax-rate assumption; expenses are withdrawn from their linked account.',
      'Unlinked cash flows use the first cash account, then other liquid investment accounts.',
      'Investment accounts use their saved profile or latest holdings-based forecast return. Real estate uses its saved property-growth rate.',
      'Loan balances amortize using principal-and-interest payments. Escrow, insurance, tax, and HOA amounts affect cash flow but do not reduce principal.',
      'The primary residence remains in net worth when kept. Saved sale, downsizing, or equity-access events transfer or release equity at the selected age.'
    ]
  };
}
