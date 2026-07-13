import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db.js';
import { config } from '../config.js';
import {
  buildWeeklyChange,
  resetPortfolioTargetsToCurrent,
  startAgentNow,
  startHoldingResearchNow
} from '../services/agent-financial-center.js';
import { monthlyPlannedExpense } from '../services/financial-intelligence-engine.js';

export const intelligenceRouter = Router();

const actualsSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/),
  entries: z.array(z.object({
    expenseId: z.string().uuid(),
    actualAmount: z.coerce.number().min(0),
    notes: z.string().max(1000).optional().nullable()
  })).max(500)
});

const runSchema = z.object({ type: z.enum(['weekly', 'nightly']).default('weekly') });

function monthStart(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})$/);
  if (!match) return null;
  return `${match[1]}-${match[2]}-01`;
}

function addMonths(dateString, offset) {
  const date = new Date(`${dateString}T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + offset);
  return date.toISOString().slice(0, 10);
}

intelligenceRouter.get('/overview', async (req, res, next) => {
  try {
    const [forecastResult, weeklyResult, deskResult, alertsResult, runsResult] = await Promise.all([
      pool.query(`SELECT * FROM weekly_forecasts WHERE household_id=$1 ORDER BY generated_at DESC LIMIT 1`, [req.householdId]),
      pool.query(`SELECT * FROM financial_briefings WHERE household_id=$1 AND briefing_type='weekly_personal' ORDER BY briefing_date DESC LIMIT 1`, [req.householdId]),
      pool.query(`SELECT * FROM financial_briefings WHERE household_id=$1 AND briefing_type='desk_daily' ORDER BY briefing_date DESC LIMIT 1`, [req.householdId]),
      pool.query(`SELECT * FROM portfolio_alerts WHERE household_id=$1 AND status='open' ORDER BY CASE severity WHEN 'important' THEN 0 WHEN 'watch' THEN 1 ELSE 2 END, updated_at DESC LIMIT 50`, [req.householdId]),
      pool.query(`SELECT id, run_type, period_key, status, error_text, started_at, finished_at FROM agent_runs WHERE household_id=$1 ORDER BY started_at DESC LIMIT 10`, [req.householdId])
    ]);
    const change = await buildWeeklyChange(req.householdId);
    res.json({
      change,
      forecast: forecastResult.rows[0] || null,
      weeklyBriefing: weeklyResult.rows[0] || null,
      desk: deskResult.rows[0] || null,
      alerts: alertsResult.rows,
      runs: runsResult.rows,
      scheduler: {
        enabled: config.agent.schedulerEnabled,
        timezone: config.agent.timezone,
        nightlyHour: config.agent.nightlyHour,
        weeklyDay: config.agent.weeklyDay,
        weeklyHour: config.agent.weeklyHour
      }
    });
  } catch (error) { next(error); }
});

intelligenceRouter.post('/run-now', async (req, res, next) => {
  try {
    const value = runSchema.parse(req.body || {});
    const started = await startAgentNow(req.householdId, value.type);
    started.completion.catch((error) => {
      console.error(`Manual ${value.type} agent run failed for ${req.householdId}:`, error);
    });
    res.status(202).json({
      accepted: true,
      runId: started.runId,
      type: value.type,
      message: `${value.type} agent run started.`
    });
  } catch (error) { next(error); }
});

intelligenceRouter.get('/runs', async (req, res, next) => {
  try {
    const result = await pool.query(`
      SELECT id, run_type, period_key, status, payload, error_text, started_at, finished_at
      FROM agent_runs WHERE household_id=$1 ORDER BY started_at DESC LIMIT 30`, [req.householdId]);
    res.json(result.rows);
  } catch (error) { next(error); }
});

intelligenceRouter.get('/holding-research', async (req, res, next) => {
  try {
    const result = await pool.query(`
      WITH positions AS (
        SELECT upper(h.symbol) AS symbol,
               COALESCE(MAX(h.name), upper(h.symbol)) AS holding_name,
               SUM(h.quantity)::float8 AS quantity,
               SUM(h.quantity * COALESCE(h.current_price, h.cost_basis_per_share, 0))::float8 AS current_value,
               MAX(h.current_price)::float8 AS saved_price,
               MAX(h.price_as_of) AS price_as_of
        FROM holdings h JOIN accounts a ON a.id=h.account_id
        WHERE a.household_id=$1
        GROUP BY upper(h.symbol)
      )
      SELECT p.*, r.company_name, r.latest_price::float8 AS research_price,
             r.analyst_target_price::float8 AS analyst_target_price,
             r.consensus_rating, r.rating_counts, r.earnings_summary,
             r.earnings_period, r.earnings_date, r.next_earnings_date,
             r.dividend_per_share::float8 AS dividend_per_share,
             r.dividend_yield::float8 AS dividend_yield,
             r.next_ex_dividend_date, r.next_dividend_pay_date,
             r.source_payload, r.data_gaps, r.researched_at
      FROM positions p
      LEFT JOIN holding_research_snapshots r
        ON r.household_id=$1 AND r.symbol=p.symbol
      ORDER BY p.current_value DESC`, [req.householdId]);
    res.json(result.rows.map((row) => {
      const price = Number(row.saved_price || row.research_price || 0);
      const target = Number(row.analyst_target_price || 0);
      return {
        ...row,
        target_upside_pct: price > 0 && target > 0 ? (target / price - 1) * 100 : null
      };
    }));
  } catch (error) { next(error); }
});

intelligenceRouter.post('/holding-research/refresh', async (req, res, next) => {
  try {
    const started = await startHoldingResearchNow(req.householdId);
    started.completion.catch((error) => console.error(`Holding research refresh failed for ${req.householdId}:`, error));
    res.status(202).json({ accepted: true, runId: started.runId, message: 'Holding research agents started.' });
  } catch (error) { next(error); }
});

intelligenceRouter.get('/desk', async (req, res, next) => {
  try {
    const limit = Math.max(1, Math.min(60, Number(req.query.limit || 14)));
    const result = await pool.query(`
      SELECT * FROM financial_briefings
      WHERE household_id=$1 AND briefing_type='desk_daily'
      ORDER BY briefing_date DESC LIMIT $2`, [req.householdId, limit]);
    res.json(result.rows);
  } catch (error) { next(error); }
});

intelligenceRouter.get('/calendar', async (req, res, next) => {
  try {
    const [researchResult, interestResult] = await Promise.all([
      pool.query(`
        WITH quantities AS (
          SELECT upper(h.symbol) AS symbol, SUM(h.quantity)::float8 AS quantity
          FROM holdings h JOIN accounts a ON a.id=h.account_id
          WHERE a.household_id=$1 GROUP BY upper(h.symbol)
        )
        SELECT r.*, q.quantity
        FROM holding_research_snapshots r
        LEFT JOIN quantities q ON q.symbol=r.symbol
        WHERE r.household_id=$1`, [req.householdId]),
      pool.query(`
        SELECT id, name, account_type, current_balance::float8 AS current_balance,
               COALESCE(forecast_expected_return, expected_return, CASE WHEN account_type='cash' THEN 0.02 ELSE 0 END)::float8 AS annual_rate
        FROM accounts
        WHERE household_id=$1 AND account_type='cash'`, [req.householdId])
    ]);
    const events = [];
    for (const row of researchResult.rows) {
      const quantity = Number(row.quantity || 0);
      if (row.next_earnings_date) events.push({
        type: 'earnings', date: row.next_earnings_date, symbol: row.symbol,
        title: `${row.symbol} expected earnings`, estimatedAmount: null,
        source: 'Nirvana earnings agent'
      });
      if (row.next_ex_dividend_date) events.push({
        type: 'dividend_ex', date: row.next_ex_dividend_date, symbol: row.symbol,
        title: `${row.symbol} ex-dividend date`, estimatedAmount: Number(row.dividend_per_share || 0) * quantity,
        source: 'Nirvana holdings research'
      });
      if (row.next_dividend_pay_date) events.push({
        type: 'dividend_pay', date: row.next_dividend_pay_date, symbol: row.symbol,
        title: `${row.symbol} estimated dividend payment`, estimatedAmount: Number(row.dividend_per_share || 0) * quantity,
        source: 'Nirvana holdings research'
      });
    }
    const currentMonth = new Date();
    currentMonth.setUTCDate(1);
    for (const account of interestResult.rows) {
      const rate = Number(account.annual_rate || 0);
      if (!(rate > 0) || !(Number(account.current_balance) > 0)) continue;
      for (let offset = 0; offset < 12; offset += 1) {
        const date = new Date(Date.UTC(currentMonth.getUTCFullYear(), currentMonth.getUTCMonth() + offset + 1, 0));
        events.push({
          type: 'interest', date: date.toISOString().slice(0, 10), accountId: account.id,
          title: `${account.name} estimated monthly interest`,
          estimatedAmount: Number(account.current_balance) * rate / 12,
          source: 'Account balance × saved annual growth assumption'
        });
      }
    }
    const today = new Date().toISOString().slice(0, 10);
    const horizon = new Date();
    horizon.setUTCMonth(horizon.getUTCMonth() + 18);
    const horizonDate = horizon.toISOString().slice(0, 10);
    const upcoming = events
      .filter((event) => /^\d{4}-\d{2}-\d{2}$/.test(String(event.date || '')))
      .filter((event) => event.date >= today && event.date <= horizonDate)
      .sort((a, b) => String(a.date).localeCompare(String(b.date)));
    res.json({ events: upcoming, generatedAt: new Date().toISOString() });
  } catch (error) { next(error); }
});

intelligenceRouter.get('/spending', async (req, res, next) => {
  try {
    const requestedMonth = String(req.query.month || new Date().toISOString().slice(0, 7));
    const expenseMonth = monthStart(requestedMonth);
    if (!expenseMonth) return res.status(400).json({ error: 'month must use YYYY-MM' });
    const [expensesResult, actualsResult, alertsResult] = await Promise.all([
      pool.query(`SELECT * FROM expenses WHERE household_id=$1 ORDER BY annual_amount DESC`, [req.householdId]),
      pool.query(`SELECT * FROM expense_actuals WHERE household_id=$1 AND expense_month=$2`, [req.householdId, expenseMonth]),
      pool.query(`SELECT * FROM portfolio_alerts WHERE household_id=$1 AND status='open' AND alert_type='large_expense' ORDER BY updated_at DESC`, [req.householdId])
    ]);
    const actualMap = new Map(actualsResult.rows.map((row) => [row.expense_id, row]));
    const rows = expensesResult.rows.map((expense) => {
      const planned = monthlyPlannedExpense(expense, expenseMonth);
      const actual = actualMap.get(expense.id);
      return {
        id: expense.id,
        name: expense.name,
        category: expense.category,
        planned,
        actual: actual ? Number(actual.actual_amount) : null,
        variance: actual ? Number(actual.actual_amount) - planned : null,
        notes: actual?.notes || ''
      };
    }).filter((row) => row.planned > 0 || row.actual != null);

    const history = [];
    const firstMonth = addMonths(expenseMonth, -11);
    const allActuals = await pool.query(`
      SELECT expense_month, SUM(actual_amount)::float8 AS actual
      FROM expense_actuals
      WHERE household_id=$1 AND expense_month BETWEEN $2 AND $3
      GROUP BY expense_month`, [req.householdId, firstMonth, expenseMonth]);
    const actualByMonth = new Map(allActuals.rows.map((row) => [String(row.expense_month).slice(0, 10), Number(row.actual)]));
    for (let offset = 0; offset < 12; offset += 1) {
      const month = addMonths(firstMonth, offset);
      const planned = expensesResult.rows.reduce((sum, expense) => sum + monthlyPlannedExpense(expense, month), 0);
      history.push({ month: month.slice(0, 7), planned, actual: actualByMonth.get(month) ?? null });
    }
    res.json({ month: requestedMonth, rows, history, reminders: alertsResult.rows });
  } catch (error) { next(error); }
});

intelligenceRouter.put('/spending/actuals', async (req, res, next) => {
  try {
    const value = actualsSchema.parse(req.body);
    const expenseMonth = monthStart(value.month);
    for (const entry of value.entries) {
      const owned = await pool.query(`SELECT 1 FROM expenses WHERE id=$1 AND household_id=$2`, [entry.expenseId, req.householdId]);
      if (!owned.rowCount) continue;
      await pool.query(`
        INSERT INTO expense_actuals
          (household_id, expense_id, expense_month, actual_amount, notes, entered_by_user_id, updated_at)
        VALUES ($1,$2,$3,$4,$5,$6,now())
        ON CONFLICT (household_id, expense_id, expense_month) DO UPDATE SET
          actual_amount=EXCLUDED.actual_amount, notes=EXCLUDED.notes,
          entered_by_user_id=EXCLUDED.entered_by_user_id, updated_at=now()`, [
        req.householdId, entry.expenseId, expenseMonth, entry.actualAmount,
        entry.notes || null, req.user.id
      ]);
    }
    res.json({ saved: value.entries.length, month: value.month });
  } catch (error) { next(error); }
});

intelligenceRouter.get('/alerts', async (req, res, next) => {
  try {
    const status = req.query.status === 'all' ? null : 'open';
    const result = await pool.query(`
      SELECT * FROM portfolio_alerts
      WHERE household_id=$1 AND ($2::text IS NULL OR status=$2)
      ORDER BY CASE severity WHEN 'important' THEN 0 WHEN 'watch' THEN 1 ELSE 2 END, updated_at DESC
      LIMIT 100`, [req.householdId, status]);
    res.json(result.rows);
  } catch (error) { next(error); }
});

intelligenceRouter.post('/alerts/:id/dismiss', async (req, res, next) => {
  try {
    const result = await pool.query(`
      UPDATE portfolio_alerts SET status='dismissed', updated_at=now()
      WHERE id=$1 AND household_id=$2 RETURNING *`, [req.params.id, req.householdId]);
    if (!result.rowCount) return res.status(404).json({ error: 'Alert not found' });
    res.json(result.rows[0]);
  } catch (error) { next(error); }
});

intelligenceRouter.post('/alerts/targets/reset', async (req, res, next) => {
  try {
    res.json(await resetPortfolioTargetsToCurrent(req.householdId));
  } catch (error) { next(error); }
});
