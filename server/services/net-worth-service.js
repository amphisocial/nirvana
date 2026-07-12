import { pool } from '../db.js';
import { buildDerivedLiabilityExpenses } from './retirement-service.js';
import { projectHouseholdNetWorth } from './net-worth-projection.js';

export async function calculateNetWorthProjection(householdId) {
  const [planResult, accountsResult, liabilitiesResult, incomeResult, expenseResult, contributionResult] = await Promise.all([
    pool.query('SELECT * FROM retirement_plans WHERE household_id = $1', [householdId]),
    pool.query(`
      SELECT id, name, account_type, current_balance::float8 AS current_balance,
             expected_return::float8 AS expected_return,
             expected_volatility::float8 AS expected_volatility,
             forecast_expected_return::float8 AS forecast_expected_return,
             forecast_volatility::float8 AS forecast_volatility,
             forecast_as_of, projection_method,
             is_primary_residence, retirement_treatment, retirement_treatment_age,
             retirement_cash_release::float8 AS retirement_cash_release,
             property_growth_rate::float8 AS property_growth_rate
      FROM accounts WHERE household_id = $1 ORDER BY current_balance DESC`, [householdId]),
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
      FROM liabilities WHERE household_id = $1`, [householdId]),
    pool.query('SELECT * FROM income_streams WHERE household_id = $1 ORDER BY annual_amount DESC', [householdId]),
    pool.query('SELECT * FROM expenses WHERE household_id = $1 ORDER BY annual_amount DESC', [householdId]),
    pool.query(`
      SELECT id, household_id, name, contribution_type, source_account_id, target_account_id,
             amount::float8 AS amount, frequency, start_date, end_date,
             annual_increase_rate::float8 AS annual_increase_rate, notes
      FROM account_contribution_schedules
      WHERE household_id = $1
      ORDER BY start_date NULLS FIRST, created_at`, [householdId])
  ]);

  const plan = planResult.rows[0] || {
    current_age: 45,
    retirement_age: 65,
    plan_end_age: 95,
    annual_contribution: 0,
    effective_tax_rate: 0.15
  };
  const explicitExpenses = expenseResult.rows;
  const derivedExpenses = buildDerivedLiabilityExpenses(
    liabilitiesResult.rows,
    explicitExpenses,
    Number(plan.current_age || 45)
  );

  return projectHouseholdNetWorth({
    currentAge: plan.current_age,
    retirementAge: plan.retirement_age,
    endAge: plan.plan_end_age,
    annualContribution: plan.annual_contribution,
    effectiveTaxRate: plan.effective_tax_rate,
    accounts: accountsResult.rows,
    liabilities: liabilitiesResult.rows,
    incomes: incomeResult.rows,
    expenses: [...explicitExpenses, ...derivedExpenses],
    contributions: contributionResult.rows
  });
}
