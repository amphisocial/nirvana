import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db.js';
import { answerChat } from '../services/chat-service.js';

export const chatRouter = Router();
const chatSchema = z.object({
  message: z.string().min(2).max(6000),
  threadId: z.string().uuid().optional()
});

async function getHouseholdContext(householdId) {
  const [accounts, liabilities, holdings, plan] = await Promise.all([
    pool.query('SELECT name, account_type, current_balance::float8 AS current_balance FROM accounts WHERE household_id = $1', [householdId]),
    pool.query('SELECT name, liability_type, current_balance::float8 AS current_balance, interest_rate::float8 AS interest_rate FROM liabilities WHERE household_id = $1', [householdId]),
    pool.query(`
      SELECT h.symbol, SUM(h.quantity)::float8 AS quantity,
             SUM(h.quantity * COALESCE(h.current_price, 0))::float8 AS value
      FROM holdings h JOIN accounts a ON a.id = h.account_id
      WHERE a.household_id = $1 GROUP BY h.symbol ORDER BY value DESC`, [householdId]),
    pool.query('SELECT * FROM retirement_plans WHERE household_id = $1', [householdId])
  ]);
  return { accounts: accounts.rows, liabilities: liabilities.rows, holdings: holdings.rows, retirementPlan: plan.rows[0] || null };
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
