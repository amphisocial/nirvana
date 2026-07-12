import { pool } from '../db.js';
import { evaluateRetirementPlan, summarizeInvestableAccounts } from './retirement-cashflow-engine.js';

export function buildDerivedLiabilityExpenses(liabilities = [], explicitExpenses = []) {
  const explicitlyLinked = new Set(
    explicitExpenses.map((row) => row.linked_liability_id).filter(Boolean)
  );
  const hasUnlinkedMortgageExpense = explicitExpenses.some(
    (row) => row.category === 'mortgage' && !row.linked_liability_id
  );
  return liabilities
    .filter((row) => Number(row.monthly_payment || 0) > 0)
    .filter((row) => !explicitlyLinked.has(row.id))
    .filter((row) => !(row.liability_type === 'mortgage' && hasUnlinkedMortgageExpense))
    .map((row) => ({
      id: `liability:${row.id}`,
      household_id: row.household_id,
      name: `${row.name} payment`,
      category: row.liability_type === 'mortgage' ? 'mortgage' : 'debt_payment',
      annual_amount: Number(row.monthly_payment) * 12,
      frequency: 'monthly',
      post_retirement_annual_amount: null,
      post_retirement_frequency: 'monthly',
      retirement_behavior: 'same',
      start_age: null,
      end_age: row.payoff_age,
      inflation_rate: 0,
      essential: true,
      linked_liability_id: row.id,
      notes: `Derived from ${row.liability_type.replaceAll('_', ' ')} payment`,
      derived_from_liability: true
    }));
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
             taxable, ends_at_retirement, notes
      FROM income_streams
      WHERE household_id = $1
      ORDER BY annual_amount DESC`, [householdId]),
    pool.query(`
      SELECT id, name, category, annual_amount::float8 AS annual_amount,
             frequency,
             post_retirement_annual_amount::float8 AS post_retirement_annual_amount,
             post_retirement_frequency, retirement_behavior,
             start_age, end_age, inflation_rate::float8 AS inflation_rate,
             essential, linked_liability_id, notes
      FROM expenses
      WHERE household_id = $1
      ORDER BY annual_amount DESC`, [householdId]),
    pool.query(`
      SELECT id, household_id, name, liability_type,
             monthly_payment::float8 AS monthly_payment,
             payoff_age, linked_account_id
      FROM liabilities
      WHERE household_id = $1`, [householdId])
  ]);

  const explicitExpenses = expenseResult.rows;
  const derivedExpenses = buildDerivedLiabilityExpenses(liabilityResult.rows, explicitExpenses);
  return {
    plan: planResult.rows[0] || null,
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
      ? 'Balance-weighted investable account profiles'
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
