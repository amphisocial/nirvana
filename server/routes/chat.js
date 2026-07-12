import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db.js';
import { answerChat } from '../services/chat-service.js';

export const chatRouter = Router();
const chatSchema = z.object({
  message: z.string().min(2).max(6000),
  threadId: z.string().uuid().optional()
});

function sum(rows, key) {
  return rows.reduce((total, row) => total + (Number(row[key]) || 0), 0);
}

function buildHouseholdContext(accounts, liabilities, holdings, plan) {
  const accountRows = accounts.map((row) => ({ ...row, current_balance: Number(row.current_balance) || 0 }));
  const liabilityRows = liabilities.map((row) => ({
    ...row,
    current_balance: Number(row.current_balance) || 0,
    interest_rate: row.interest_rate == null ? null : Number(row.interest_rate)
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

  const investableTypes = new Set(['cash', 'brokerage', 'retirement', 'hsa', '529']);
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
    .filter((row) => ['brokerage', 'retirement', 'hsa', '529'].includes(row.account_type))
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
    retirementPlan: plan || null
  };
}

async function getHouseholdContext(householdId) {
  const [accounts, liabilities, holdings, plan] = await Promise.all([
    pool.query(
      `SELECT id, name, institution, account_type, current_balance::float8 AS current_balance, last_verified_at
       FROM accounts WHERE household_id = $1 ORDER BY current_balance DESC`,
      [householdId]
    ),
    pool.query(
      `SELECT id, name, institution, liability_type, current_balance::float8 AS current_balance,
              interest_rate::float8 AS interest_rate, last_verified_at
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
    pool.query('SELECT * FROM retirement_plans WHERE household_id = $1', [householdId])
  ]);
  return buildHouseholdContext(accounts.rows, liabilities.rows, holdings.rows, plan.rows[0] || null);
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
