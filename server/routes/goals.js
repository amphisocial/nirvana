import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db.js';
import { loadGoalsWithProgress, refreshGoalAlerts } from '../services/agent-financial-center.js';

export const goalsRouter = Router();

const goalSchema = z.object({
  name: z.string().min(1).max(140),
  goalType: z.enum(['retirement', 'education', 'home', 'emergency', 'travel', 'family', 'legacy', 'other']).default('other'),
  targetAmount: z.coerce.number().positive(),
  targetDate: z.string().date().optional().nullable(),
  manualCurrentAmount: z.coerce.number().min(0).default(0),
  linkedAccountIds: z.array(z.string().uuid()).max(50).default([]),
  priority: z.enum(['low', 'medium', 'high']).default('medium'),
  status: z.enum(['active', 'completed', 'paused']).default('active'),
  notes: z.string().max(2000).optional().nullable()
});

async function validateAccounts(householdId, accountIds) {
  if (!accountIds.length) return;
  const result = await pool.query(`SELECT id FROM accounts WHERE household_id=$1 AND id=ANY($2::uuid[])`, [householdId, accountIds]);
  if (result.rowCount !== new Set(accountIds).size) {
    const error = new Error('One or more linked accounts were not found');
    error.status = 400;
    throw error;
  }
}

async function validateExclusiveGoalAccounts(householdId, accountIds, goalId = null) {
  if (!accountIds.length) return;
  const result = await pool.query(`
    SELECT name FROM financial_goals
    WHERE household_id=$1 AND status='active'
      AND ($3::uuid IS NULL OR id<>$3)
      AND linked_account_ids && $2::uuid[]
    LIMIT 1`, [householdId, accountIds, goalId]);
  if (result.rowCount) {
    const error = new Error(`A selected account is already linked to the active goal "${result.rows[0].name}". Use a separate account or manual current amount to avoid double counting.`);
    error.status = 400;
    throw error;
  }
}

goalsRouter.get('/', async (req, res, next) => {
  try {
    const [goals, accounts] = await Promise.all([
      loadGoalsWithProgress(req.householdId),
      pool.query(`SELECT id, name, account_type, current_balance::float8 AS current_balance FROM accounts WHERE household_id=$1 ORDER BY current_balance DESC`, [req.householdId])
    ]);
    res.json({ goals, accounts: accounts.rows });
  } catch (error) { next(error); }
});

goalsRouter.post('/', async (req, res, next) => {
  try {
    const value = goalSchema.parse(req.body);
    await validateAccounts(req.householdId, value.linkedAccountIds);
    if (value.status === 'active') await validateExclusiveGoalAccounts(req.householdId, value.linkedAccountIds);
    const result = await pool.query(`
      INSERT INTO financial_goals
        (household_id, name, goal_type, target_amount, target_date,
         manual_current_amount, linked_account_ids, priority, status, notes, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now()) RETURNING *`, [
      req.householdId, value.name, value.goalType, value.targetAmount,
      value.targetDate || null, value.manualCurrentAmount, value.linkedAccountIds,
      value.priority, value.status, value.notes || null
    ]);
    await refreshGoalAlerts(req.householdId);
    res.status(201).json(result.rows[0]);
  } catch (error) { next(error); }
});

goalsRouter.put('/:id', async (req, res, next) => {
  try {
    const value = goalSchema.parse(req.body);
    await validateAccounts(req.householdId, value.linkedAccountIds);
    if (value.status === 'active') await validateExclusiveGoalAccounts(req.householdId, value.linkedAccountIds, req.params.id);
    const result = await pool.query(`
      UPDATE financial_goals SET
        name=$1, goal_type=$2, target_amount=$3, target_date=$4,
        manual_current_amount=$5, linked_account_ids=$6, priority=$7,
        status=$8, notes=$9, updated_at=now()
      WHERE id=$10 AND household_id=$11 RETURNING *`, [
      value.name, value.goalType, value.targetAmount, value.targetDate || null,
      value.manualCurrentAmount, value.linkedAccountIds, value.priority,
      value.status, value.notes || null, req.params.id, req.householdId
    ]);
    if (!result.rowCount) return res.status(404).json({ error: 'Goal not found' });
    await refreshGoalAlerts(req.householdId);
    res.json(result.rows[0]);
  } catch (error) { next(error); }
});

goalsRouter.delete('/:id', async (req, res, next) => {
  try {
    const result = await pool.query(`DELETE FROM financial_goals WHERE id=$1 AND household_id=$2 RETURNING id`, [req.params.id, req.householdId]);
    if (!result.rowCount) return res.status(404).json({ error: 'Goal not found' });
    res.json({ ok: true });
  } catch (error) { next(error); }
});
