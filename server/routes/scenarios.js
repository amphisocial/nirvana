import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db.js';
import { getQuote } from '../services/market/index.js';
import { simulateTrade } from '../services/financial-engine.js';

export const scenariosRouter = Router();

const tradeSchema = z.object({
  name: z.string().max(120).optional(),
  symbol: z.string().min(1).max(10),
  action: z.enum(['BUY', 'SELL', 'buy', 'sell']),
  quantity: z.coerce.number().positive().optional(),
  amount: z.coerce.number().positive().optional(),
  executionPrice: z.coerce.number().positive().optional(),
  targetPrice: z.coerce.number().positive(),
  cashAccountId: z.string().uuid().optional()
}).refine((value) => value.quantity || value.amount, { message: 'Enter quantity or amount' });

scenariosRouter.post('/trade', async (req, res, next) => {
  try {
    const input = tradeSchema.parse(req.body);
    const symbol = input.symbol.toUpperCase();
    const [holdingsResult, cashResult] = await Promise.all([
      pool.query(`
        SELECT h.symbol, SUM(h.quantity)::float8 AS quantity,
               CASE WHEN SUM(h.quantity) = 0 THEN 0
                    ELSE SUM(h.quantity * COALESCE(h.current_price, 0)) / SUM(h.quantity) END::float8 AS current_price
        FROM holdings h JOIN accounts a ON a.id = h.account_id
        WHERE a.household_id = $1
        GROUP BY h.symbol`, [req.householdId]),
      input.cashAccountId
        ? pool.query('SELECT current_balance::float8 AS balance FROM accounts WHERE id = $1 AND household_id = $2 AND account_type = $3', [input.cashAccountId, req.householdId, 'cash'])
        : pool.query(`SELECT COALESCE(SUM(current_balance), 0)::float8 AS balance FROM accounts WHERE household_id = $1 AND account_type = 'cash'`, [req.householdId])
    ]);

    const selected = holdingsResult.rows.find((holding) => holding.symbol === symbol);
    let executionPrice = input.executionPrice || Number(selected?.current_price || 0);
    if (!executionPrice) executionPrice = Number((await getQuote(symbol)).price);

    const result = simulateTrade({
      ...input,
      symbol,
      executionPrice,
      cashBalance: Number(cashResult.rows[0]?.balance || 0),
      holdings: holdingsResult.rows.map((holding) => ({
        symbol: holding.symbol,
        quantity: Number(holding.quantity),
        currentPrice: Number(holding.current_price)
      }))
    });

    const saved = await pool.query(
      `INSERT INTO scenarios (household_id, name, scenario_type, inputs, result)
       VALUES ($1, $2, 'stock_trade', $3::jsonb, $4::jsonb)
       RETURNING id, created_at`,
      [req.householdId, input.name || `${input.action.toUpperCase()} ${symbol}`, JSON.stringify(input), JSON.stringify(result)]
    );

    res.json({ ...result, scenarioId: saved.rows[0].id, createdAt: saved.rows[0].created_at });
  } catch (error) { next(error); }
});

scenariosRouter.get('/', async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT id, name, scenario_type, inputs, result, created_at
       FROM scenarios WHERE household_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [req.householdId]
    );
    res.json(result.rows);
  } catch (error) { next(error); }
});
