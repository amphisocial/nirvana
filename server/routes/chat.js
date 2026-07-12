import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db.js';
import { answerChat } from '../services/chat-service.js';
import { calculateRetirementProjection } from '../services/retirement-service.js';

export const chatRouter = Router();
const chatSchema = z.object({
  message: z.string().min(2).max(6000),
  threadId: z.string().uuid().optional()
});

function sum(rows, key) {
  return rows.reduce((total, row) => total + (Number(row[key]) || 0), 0);
}

function buildHouseholdContext(accounts, liabilities, holdings, plan, incomes, expenses, projection) {
  const accountRows = accounts.map((row) => ({
    ...row,
    current_balance: Number(row.current_balance) || 0,
    expected_return: row.expected_return == null ? null : Number(row.expected_return),
    expected_volatility: row.expected_volatility == null ? null : Number(row.expected_volatility),
    forecast_expected_return: row.forecast_expected_return == null ? null : Number(row.forecast_expected_return),
    forecast_volatility: row.forecast_volatility == null ? null : Number(row.forecast_volatility),
    retirement_cash_release: row.retirement_cash_release == null ? null : Number(row.retirement_cash_release),
    property_growth_rate: row.property_growth_rate == null ? null : Number(row.property_growth_rate)
  }));
  const liabilityRows = liabilities.map((row) => ({
    ...row,
    current_balance: Number(row.current_balance) || 0,
    interest_rate: row.interest_rate == null ? null : Number(row.interest_rate),
    monthly_payment: row.monthly_payment == null ? null : Number(row.monthly_payment),
    principal_interest_payment: row.principal_interest_payment == null ? null : Number(row.principal_interest_payment),
    property_tax_payment: row.property_tax_payment == null ? null : Number(row.property_tax_payment),
    home_insurance_payment: row.home_insurance_payment == null ? null : Number(row.home_insurance_payment),
    pmi_payment: row.pmi_payment == null ? null : Number(row.pmi_payment),
    hoa_payment: row.hoa_payment == null ? null : Number(row.hoa_payment)
  }));
  const holdingRows = holdings.map((row) => ({
    ...row,
    quantity: Number(row.quantity) || 0,
    current_price: row.current_price == null ? null : Number(row.current_price),
    cost_basis_per_share: row.cost_basis_per_share == null ? null : Number(row.cost_basis_per_share),
    value: Number(row.value) || 0,
    cost_basis: row.cost_basis == null ? null : Number(row.cost_basis),
    unrealized_gain: row.unrealized_gain == null ? null : Number(row.unrealized_gain)
  }));

  const symbolMap = new Map();
  for (const holding of holdingRows) {
    const existing = symbolMap.get(holding.symbol) || {
      symbol: holding.symbol,
      quantity: 0,
      value: 0,
      cost_basis: 0,
      accounts: []
    };
    existing.quantity += holding.quantity;
    existing.value += holding.value;
    if (holding.cost_basis !== null) existing.cost_basis += holding.cost_basis;
    existing.accounts.push({
      account_id: holding.account_id,
      account_name: holding.account_name,
      account_type: holding.account_type,
      quantity: holding.quantity,
      value: holding.value
    });
    symbolMap.set(holding.symbol, existing);
  }

  const investableTypes = new Set(['cash', 'brokerage', 'ira', '401k', 'retirement', 'hsa']);
  const totalAssets = sum(accountRows, 'current_balance');
  const totalLiabilities = sum(liabilityRows, 'current_balance');
  const investableAccountBalances = accountRows
    .filter((row) => investableTypes.has(row.account_type))
    .reduce((total, row) => total + row.current_balance, 0);
  const modeledHoldingsValue = sum(holdingRows, 'value');
  const cashAccountBalances = accountRows
    .filter((row) => row.account_type === 'cash')
    .reduce((total, row) => total + row.current_balance, 0);
  const investmentAccountsOnly = accountRows
    .filter((row) => ['brokerage', 'ira', '401k', 'retirement', 'hsa'].includes(row.account_type))
    .reduce((total, row) => total + row.current_balance, 0);
  const unmodeledInvestmentAccountValue = investmentAccountsOnly - modeledHoldingsValue;

  const dataQualityNotes = [];
  if (Math.abs(unmodeledInvestmentAccountValue) > Math.max(500, investmentAccountsOnly * 0.02)) {
    dataQualityNotes.push(
      `Investment account balances exceed modeled holdings by ${unmodeledInvestmentAccountValue.toFixed(2)}. This may represent account cash, unimported positions, or different valuation timestamps; do not assign the difference to a specific account without evidence.`
    );
  }

  return {
    accounts: accountRows,
    liabilities: liabilityRows,
    holdingsByAccount: holdingRows,
    holdingsBySymbol: [...symbolMap.values()].sort((a, b) => b.value - a.value),
    portfolioSummary: {
      totalAssets,
      totalLiabilities,
      netWorth: totalAssets - totalLiabilities,
      investableAccountBalances,
      investmentAccountsOnly,
      cashAccountBalances,
      modeledHoldingsValue,
      unmodeledInvestmentAccountValue
    },
    dataQualityNotes,
    retirementPlan: plan || null,
    incomeStreams: incomes.map((row) => ({
      ...row,
      annual_amount: Number(row.annual_amount || 0),
      inflation_rate: Number(row.inflation_rate || 0)
    })),
    expenses: expenses.map((row) => ({
      ...row,
      annual_amount: Number(row.annual_amount || 0),
      post_retirement_annual_amount: row.post_retirement_annual_amount == null
        ? null
        : Number(row.post_retirement_annual_amount),
      inflation_rate: Number(row.inflation_rate || 0)
    })),
    retirementProjection: projection ? {
      selectedRetirementAge: projection.retirementAge,
      earliestFeasibleAge: projection.earliestFeasibleAge,
      successRatePct: projection.successRatePct,
      successThresholdPct: projection.successThresholdPct,
      readiness: projection.readiness,
      monthlyExpensesAtRetirement: projection.monthlyExpensesAtRetirement,
      monthlyIncomeAtRetirement: projection.monthlyIncomeAtRetirement,
      medianPortfolioAtPlanEnd: projection.p50?.at(-1) || 0,
      downsidePortfolioAtPlanEnd: projection.p10?.at(-1) || 0,
      usesFallbackSpending: projection.dataCompleteness?.usesFallbackSpending || false,
      assumptions: projection.assumptions
    } : null
  };
}

async function getHouseholdContext(householdId) {
  const [accounts, liabilities, holdings, plan, incomes, expenses, projection] = await Promise.all([
    pool.query(
      `SELECT id, name, institution, account_type, current_balance::float8 AS current_balance,
              projection_method, investment_style, expected_return::float8 AS expected_return,
              expected_volatility::float8 AS expected_volatility,
              forecast_expected_return::float8 AS forecast_expected_return,
              forecast_volatility::float8 AS forecast_volatility,
              forecast_as_of, forecast_source,
              is_primary_residence, retirement_treatment, retirement_treatment_age,
              retirement_cash_release::float8 AS retirement_cash_release,
              property_growth_rate::float8 AS property_growth_rate, last_verified_at
       FROM accounts WHERE household_id = $1 ORDER BY current_balance DESC`,
      [householdId]
    ),
    pool.query(
      `SELECT id, name, institution, liability_type, current_balance::float8 AS current_balance,
              interest_rate::float8 AS interest_rate, monthly_payment::float8 AS monthly_payment,
              original_amount::float8 AS original_amount, original_term_months,
              loan_start_date, current_term_month, payoff_age, linked_account_id,
              principal_interest_payment::float8 AS principal_interest_payment,
              property_tax_payment::float8 AS property_tax_payment,
              home_insurance_payment::float8 AS home_insurance_payment,
              pmi_payment::float8 AS pmi_payment,
              hoa_payment::float8 AS hoa_payment,
              other_escrow_payment::float8 AS other_escrow_payment,
              last_verified_at
       FROM liabilities WHERE household_id = $1 ORDER BY current_balance DESC`,
      [householdId]
    ),
    pool.query(
      `SELECT h.account_id, a.name AS account_name, a.account_type, a.institution,
              h.symbol, h.name, h.asset_class,
              h.quantity::float8 AS quantity,
              h.current_price::float8 AS current_price,
              h.cost_basis_per_share::float8 AS cost_basis_per_share,
              (h.quantity * COALESCE(h.current_price, 0))::float8 AS value,
              CASE WHEN h.cost_basis_per_share IS NULL THEN NULL
                   ELSE (h.quantity * h.cost_basis_per_share)::float8 END AS cost_basis,
              CASE WHEN h.cost_basis_per_share IS NULL OR h.current_price IS NULL THEN NULL
                   ELSE (h.quantity * (h.current_price - h.cost_basis_per_share))::float8 END AS unrealized_gain,
              h.price_as_of
       FROM holdings h
       JOIN accounts a ON a.id = h.account_id
       WHERE a.household_id = $1
       ORDER BY value DESC`,
      [householdId]
    ),
    pool.query('SELECT * FROM retirement_plans WHERE household_id = $1', [householdId]),
    pool.query('SELECT * FROM income_streams WHERE household_id = $1 ORDER BY annual_amount DESC', [householdId]),
    pool.query('SELECT * FROM expenses WHERE household_id = $1 ORDER BY annual_amount DESC', [householdId]),
    calculateRetirementProjection(householdId, { simulationCount: 350, searchSimulationCount: 250 })
  ]);
  return buildHouseholdContext(
    accounts.rows,
    liabilities.rows,
    holdings.rows,
    plan.rows[0] || null,
    incomes.rows,
    expenses.rows,
    projection
  );
}

chatRouter.post('/', async (req, res, next) => {
  try {
    const input = chatSchema.parse(req.body);
    let threadId = input.threadId;
    if (!threadId) {
      const thread = await pool.query(
        `INSERT INTO chat_threads (household_id, title) VALUES ($1, $2) RETURNING id`,
        [req.householdId, input.message.slice(0, 80)]
      );
      threadId = thread.rows[0].id;
    }

    await pool.query(
      `INSERT INTO chat_messages (thread_id, role, content) VALUES ($1, 'user', $2)`,
      [threadId, input.message]
    );

    const response = await answerChat({
      message: input.message,
      householdContext: await getHouseholdContext(req.householdId)
    });

    await pool.query(
      `INSERT INTO chat_messages (thread_id, role, content, structured_payload)
       VALUES ($1, 'assistant', $2, $3::jsonb)`,
      [threadId, response.message, JSON.stringify({ chart: response.chart, sources: response.sources, disclaimer: response.disclaimer })]
    );

    res.json({ threadId, ...response });
  } catch (error) { next(error); }
});

chatRouter.get('/threads', async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT id, title, created_at, updated_at FROM chat_threads
       WHERE household_id = $1 ORDER BY updated_at DESC LIMIT 50`, [req.householdId]
    );
    res.json(result.rows);
  } catch (error) { next(error); }
});
