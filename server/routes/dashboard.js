import { Router } from 'express';
import { pool } from '../db.js';
import { estimatedPayoffDate, loanTermPosition, mortgagePaymentBreakdown } from '../services/loan-schedule.js';

export const dashboardRouter = Router();

const INVESTABLE_TYPES = new Set(['cash', 'brokerage', 'ira', '401k', 'retirement', 'hsa']);

dashboardRouter.get('/summary', async (req, res, next) => {
  try {
    const householdId = req.householdId;
    const [accountsResult, liabilitiesResult, holdingsResult, snapshotsResult, planResult] = await Promise.all([
      pool.query(`
        SELECT a.id, a.name, a.institution, a.account_type,
               a.current_balance::float8 AS current_balance,
               a.projection_method,
               a.investment_style,
               a.expected_return::float8 AS expected_return,
               a.expected_volatility::float8 AS expected_volatility,
               a.forecast_expected_return::float8 AS forecast_expected_return,
               a.forecast_volatility::float8 AS forecast_volatility,
               a.forecast_as_of, a.forecast_source,
               a.is_primary_residence,
               a.retirement_treatment,
               a.retirement_treatment_age,
               a.retirement_cash_release::float8 AS retirement_cash_release,
               a.property_growth_rate::float8 AS property_growth_rate,
               a.property_address, a.property_zip, a.property_bedrooms,
               a.property_bathrooms::float8 AS property_bathrooms,
               a.property_home_type, a.property_square_feet,
               a.is_rental_property, a.property_growth_source,
               a.property_growth_as_of,
               a.property_growth_confidence::float8 AS property_growth_confidence,
               a.property_market_summary,
               a.rental_monthly_income::float8 AS rental_monthly_income,
               a.rental_vacancy_rate::float8 AS rental_vacancy_rate,
               a.rental_management_rate::float8 AS rental_management_rate,
               a.rental_annual_property_tax::float8 AS rental_annual_property_tax,
               a.rental_annual_insurance::float8 AS rental_annual_insurance,
               a.rental_monthly_hoa::float8 AS rental_monthly_hoa,
               a.rental_monthly_maintenance::float8 AS rental_monthly_maintenance,
               a.rental_rent_growth_rate::float8 AS rental_rent_growth_rate,
               a.rental_deposit_account_id,
               a.is_manual, a.last_verified_at,
               COUNT(h.id)::int AS holding_count
        FROM accounts a
        LEFT JOIN holdings h ON h.account_id = a.id
        WHERE a.household_id = $1
        GROUP BY a.id
        ORDER BY a.current_balance DESC`, [householdId]),
      pool.query(`
        SELECT id, name, institution, liability_type,
               original_amount::float8 AS original_amount,
               current_balance::float8 AS current_balance,
               interest_rate::float8 AS interest_rate,
               minimum_payment::float8 AS minimum_payment,
               monthly_payment::float8 AS monthly_payment,
               payoff_age, linked_account_id,
               original_term_months, loan_start_date, current_term_month,
               principal_interest_payment::float8 AS principal_interest_payment,
               property_tax_payment::float8 AS property_tax_payment,
               home_insurance_payment::float8 AS home_insurance_payment,
               pmi_payment::float8 AS pmi_payment,
               hoa_payment::float8 AS hoa_payment,
               other_escrow_payment::float8 AS other_escrow_payment,
               last_verified_at
        FROM liabilities
        WHERE household_id = $1
        ORDER BY current_balance DESC`, [householdId]),
      pool.query(`
        SELECT h.symbol,
               COALESCE(MAX(h.name), h.symbol) AS name,
               COALESCE(MAX(h.asset_class), 'equity') AS asset_class,
               SUM(h.quantity)::float8 AS quantity,
               SUM(h.quantity * COALESCE(h.current_price, 0))::float8 AS current_value,
               CASE WHEN SUM(h.quantity) = 0 THEN 0
                    ELSE SUM(h.quantity * COALESCE(h.current_price, 0)) / SUM(h.quantity) END::float8 AS current_price,
               MAX(h.price_as_of) AS price_as_of
        FROM holdings h
        JOIN accounts a ON a.id = h.account_id
        WHERE a.household_id = $1
        GROUP BY h.symbol
        ORDER BY current_value DESC`, [householdId]),
      pool.query(`
        SELECT snapshot_date, assets::float8 AS assets, liabilities::float8 AS liabilities,
               net_worth::float8 AS net_worth
        FROM net_worth_snapshots
        WHERE household_id = $1
        ORDER BY snapshot_date`, [householdId]),
      pool.query('SELECT * FROM retirement_plans WHERE household_id = $1', [householdId])
    ]);

    const accounts = accountsResult.rows;
    const currentAge = planResult.rows[0]?.current_age == null
      ? null
      : Number(planResult.rows[0].current_age);
    const liabilities = liabilitiesResult.rows.map((row) => {
      const term = loanTermPosition(row);
      const breakdown = mortgagePaymentBreakdown(row);
      return {
        ...row,
        term_elapsed_months: term.elapsedMonths,
        term_current_year: term.currentYear,
        term_current_month_in_year: term.currentMonthInYear,
        remaining_term_months: term.remainingMonths,
        estimated_payoff_date: estimatedPayoffDate(row),
        computed_payoff_age: row.payoff_age
          ?? (term.remainingMonths == null || currentAge == null
            ? null
            : Math.ceil(currentAge + term.remainingMonths / 12)),
        payment_breakdown: breakdown
      };
    });
    const holdings = holdingsResult.rows;
    const assetsTotal = accounts.reduce((sum, row) => sum + Number(row.current_balance || 0), 0);
    const liabilitiesTotal = liabilities.reduce((sum, row) => sum + Number(row.current_balance || 0), 0);
    const netWorth = assetsTotal - liabilitiesTotal;
    const investableAssets = accounts
      .filter((row) => INVESTABLE_TYPES.has(row.account_type))
      .reduce((sum, row) => sum + Number(row.current_balance || 0), 0);
    const primaryResidences = accounts
      .filter((row) => row.account_type === 'property' && row.is_primary_residence);
    const primaryResidenceIds = new Set(primaryResidences.map((row) => row.id));
    const primaryResidenceValue = primaryResidences
      .reduce((sum, row) => sum + Number(row.current_balance || 0), 0);
    const mortgageBalance = liabilities
      .filter((row) => row.liability_type === 'mortgage')
      .filter((row) => primaryResidenceIds.has(row.linked_account_id)
        || (primaryResidences.length === 1 && !row.linked_account_id))
      .reduce((sum, row) => sum + Number(row.current_balance || 0), 0);
    const homeEquity = Math.max(0, primaryResidenceValue - mortgageBalance);

    const allocation = Object.entries(accounts.reduce((map, row) => {
      const label = row.account_type.replaceAll('_', ' ');
      map[label] = (map[label] || 0) + Number(row.current_balance || 0);
      return map;
    }, {})).map(([label, value]) => ({ label, value }));

    const snapshots = snapshotsResult.rows.length ? snapshotsResult.rows : [{
      snapshot_date: new Date().toISOString().slice(0, 10),
      assets: assetsTotal,
      liabilities: liabilitiesTotal,
      net_worth: netWorth
    }];

    res.json({
      metrics: {
        assetsTotal,
        liabilitiesTotal,
        netWorth,
        investableAssets,
        liquidPortfolio: investableAssets,
        primaryResidenceValue,
        mortgageBalance,
        homeEquity,
        accountCount: accounts.length,
        holdingsCount: holdings.length
      },
      accounts,
      liabilities,
      holdings,
      allocation,
      netWorthHistory: snapshots,
      retirementPlan: planResult.rows[0] || null
    });
  } catch (error) {
    next(error);
  }
});
