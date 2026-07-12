import { pool } from '../db.js';
import { evaluateRetirementPlan, summarizeInvestableAccounts } from './retirement-cashflow-engine.js';
import { estimatedPayoffAge, mortgagePaymentBreakdown } from './loan-schedule.js';

function derivedExpense(row, overrides) {
  return {
    id: `liability:${row.id}:${overrides.category}`,
    household_id: row.household_id,
    name: overrides.name,
    category: overrides.category,
    annual_amount: Number(overrides.monthlyAmount || 0) * 12,
    frequency: 'monthly',
    post_retirement_annual_amount: null,
    post_retirement_frequency: 'monthly',
    retirement_behavior: 'same',
    start_age: null,
    end_age: overrides.endAge ?? null,
    inflation_rate: overrides.inflationRate ?? 0,
    essential: true,
    linked_liability_id: row.id,
    payment_account_id: null,
    notes: overrides.notes,
    derived_from_liability: true
  };
}

export function buildDerivedLiabilityExpenses(liabilities = [], explicitExpenses = [], currentAge = null) {
  const explicitlyLinked = new Set(
    explicitExpenses.map((row) => row.linked_liability_id).filter(Boolean)
  );
  const hasUnlinkedMortgageExpense = explicitExpenses.some(
    (row) => row.category === 'mortgage' && !row.linked_liability_id
  );
  const result = [];

  for (const row of liabilities) {
    if (explicitlyLinked.has(row.id)) continue;
    if (row.liability_type === 'mortgage' && hasUnlinkedMortgageExpense) continue;
    const payoffAge = estimatedPayoffAge(row, currentAge);

    if (row.liability_type !== 'mortgage') {
      const monthly = Number(row.monthly_payment || row.minimum_payment || 0);
      if (monthly <= 0) continue;
      result.push(derivedExpense(row, {
        name: `${row.name} payment`,
        category: 'debt_payment',
        monthlyAmount: monthly,
        endAge: payoffAge,
        inflationRate: 0,
        notes: `Derived from ${row.liability_type.replaceAll('_', ' ')} payment`
      }));
      continue;
    }

    const breakdown = mortgagePaymentBreakdown(row);
    const hasDetailedBreakdown = [
      breakdown.propertyTax,
      breakdown.homeInsurance,
      breakdown.pmi,
      breakdown.hoa,
      breakdown.otherEscrow,
      Number(row.principal_interest_payment || 0)
    ].some((value) => value > 0);

    if (!hasDetailedBreakdown) {
      if (breakdown.total <= 0) continue;
      result.push(derivedExpense(row, {
        name: `${row.name} total payment`,
        category: 'mortgage',
        monthlyAmount: breakdown.total,
        endAge: payoffAge,
        inflationRate: 0,
        notes: 'Derived from total mortgage payment; split escrow fields for more accurate post-payoff planning'
      }));
      continue;
    }

    const components = [
      { amount: breakdown.principalInterest, category: 'mortgage', label: 'principal & interest', endAge: payoffAge, inflation: 0 },
      { amount: breakdown.propertyTax, category: 'property_tax', label: 'property tax', endAge: null, inflation: 0.025 },
      { amount: breakdown.homeInsurance, category: 'home_insurance', label: 'home insurance', endAge: null, inflation: 0.04 },
      { amount: breakdown.pmi, category: 'mortgage_insurance', label: 'mortgage insurance', endAge: payoffAge, inflation: 0 },
      { amount: breakdown.hoa, category: 'hoa', label: 'HOA', endAge: null, inflation: 0.025 },
      { amount: breakdown.otherEscrow, category: 'housing', label: 'other escrow', endAge: null, inflation: 0.025 }
    ];
    for (const component of components) {
      if (component.amount <= 0) continue;
      result.push(derivedExpense(row, {
        name: `${row.name} — ${component.label}`,
        category: component.category,
        monthlyAmount: component.amount,
        endAge: component.endAge,
        inflationRate: component.inflation,
        notes: `Derived from mortgage ${component.label}`
      }));
    }
  }
  return result;
}

export async function loadRetirementData(householdId) {
  const [planResult, accountsResult, incomeResult, expenseResult, liabilityResult] = await Promise.all([
    pool.query('SELECT * FROM retirement_plans WHERE household_id = $1', [householdId]),
    pool.query(`
      SELECT id, name, institution, account_type,
             current_balance::float8 AS current_balance,
             investment_style,
             expected_return::float8 AS expected_return,
             expected_volatility::float8 AS expected_volatility,
             projection_method,
             forecast_expected_return::float8 AS forecast_expected_return,
             forecast_volatility::float8 AS forecast_volatility,
             forecast_as_of, forecast_source,
             is_primary_residence,
             retirement_treatment,
             retirement_treatment_age,
             retirement_cash_release::float8 AS retirement_cash_release,
             property_growth_rate::float8 AS property_growth_rate
      FROM accounts
      WHERE household_id = $1
      ORDER BY current_balance DESC`, [householdId]),
    pool.query(`
      SELECT id, name, income_type, annual_amount::float8 AS annual_amount,
             frequency, start_age, end_age,
             inflation_rate::float8 AS inflation_rate,
             taxable, ends_at_retirement, deposit_account_id, notes
      FROM income_streams
      WHERE household_id = $1
      ORDER BY annual_amount DESC`, [householdId]),
    pool.query(`
      SELECT id, name, category, annual_amount::float8 AS annual_amount,
             frequency,
             post_retirement_annual_amount::float8 AS post_retirement_annual_amount,
             post_retirement_frequency, retirement_behavior,
             start_age, end_age, inflation_rate::float8 AS inflation_rate,
             essential, linked_liability_id, payment_account_id, notes
      FROM expenses
      WHERE household_id = $1
      ORDER BY annual_amount DESC`, [householdId]),
    pool.query(`
      SELECT id, household_id, name, liability_type,
             current_balance::float8 AS current_balance,
             interest_rate::float8 AS interest_rate,
             minimum_payment::float8 AS minimum_payment,
             monthly_payment::float8 AS monthly_payment,
             payoff_age, linked_account_id,
             original_amount::float8 AS original_amount,
             original_term_months, loan_start_date, current_term_month,
             principal_interest_payment::float8 AS principal_interest_payment,
             property_tax_payment::float8 AS property_tax_payment,
             home_insurance_payment::float8 AS home_insurance_payment,
             pmi_payment::float8 AS pmi_payment,
             hoa_payment::float8 AS hoa_payment,
             other_escrow_payment::float8 AS other_escrow_payment
      FROM liabilities
      WHERE household_id = $1`, [householdId])
  ]);

  const plan = planResult.rows[0] || null;
  const explicitExpenses = expenseResult.rows;
  const derivedExpenses = buildDerivedLiabilityExpenses(
    liabilityResult.rows,
    explicitExpenses,
    plan?.current_age == null ? null : Number(plan.current_age)
  );
  return {
    plan,
    accounts: accountsResult.rows,
    incomes: incomeResult.rows,
    expenses: [...explicitExpenses, ...derivedExpenses],
    explicitExpenses,
    derivedExpenses,
    liabilities: liabilityResult.rows
  };
}

export async function calculateRetirementProjection(householdId, options = {}) {
  const data = await loadRetirementData(householdId);
  if (!data.plan) return null;
  const portfolio = summarizeInvestableAccounts(data.accounts, data.plan);
  const properties = data.accounts.filter((row) => row.account_type === 'property');
  const plan = data.plan;
  const projection = evaluateRetirementPlan({
    currentAge: plan.current_age,
    retirementAge: plan.retirement_age,
    endAge: plan.plan_end_age,
    maxSearchAge: plan.max_search_age,
    successThreshold: plan.success_threshold,
    effectiveTaxRate: plan.effective_tax_rate,
    startingPortfolio: portfolio.startingPortfolio,
    annualContribution: plan.annual_contribution,
    annualRetirementSpending: plan.annual_retirement_spending,
    expectedReturn: portfolio.expectedReturn,
    volatility: portfolio.volatility,
    inflation: plan.inflation,
    incomes: data.incomes,
    expenses: data.expenses,
    properties,
    simulationCount: options.simulationCount || 1000,
    searchSimulationCount: options.searchSimulationCount || 350
  });

  projection.accountGrowthModel = {
    weightedExpectedReturn: portfolio.expectedReturn,
    weightedVolatility: portfolio.volatility,
    source: portfolio.accounts.length
      ? 'Balance-weighted investable account profiles and saved holdings forecasts'
      : 'Retirement plan default',
    accounts: portfolio.accounts
  };
  projection.dataCompleteness = {
    incomeCount: data.incomes.length,
    expenseCount: data.expenses.length,
    explicitExpenseCount: data.explicitExpenses.length,
    derivedLiabilityExpenseCount: data.derivedExpenses.length,
    hasPrimaryResidence: properties.some((row) => row.is_primary_residence),
    usesFallbackSpending: data.expenses.length === 0
  };
  return projection;
}
