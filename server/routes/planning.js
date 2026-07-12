import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db.js';
import { annualize, expenseAtAge, incomeAtAge } from '../services/retirement-cashflow-engine.js';
import { buildDerivedLiabilityExpenses } from '../services/retirement-service.js';

export const planningRouter = Router();

const frequencySchema = z.enum(['weekly', 'biweekly', 'monthly', 'quarterly', 'annual']);

const incomeSchema = z.object({
  name: z.string().min(1).max(120),
  incomeType: z.enum(['employment', 'social_security', 'pension', 'annuity', 'rental', 'part_time', 'other']),
  amount: z.coerce.number().min(0),
  frequency: frequencySchema.default('monthly'),
  startAge: z.coerce.number().int().min(0).max(120).optional().nullable(),
  endAge: z.coerce.number().int().min(0).max(120).optional().nullable(),
  inflationRate: z.coerce.number().min(-0.1).max(0.2).default(0),
  taxable: z.coerce.boolean().default(true),
  endsAtRetirement: z.coerce.boolean().default(false),
  notes: z.string().max(1000).optional().nullable()
}).refine((value) => value.startAge == null || value.endAge == null || value.endAge >= value.startAge, {
  message: 'End age must be at or after start age'
});

const expenseSchema = z.object({
  name: z.string().min(1).max(120),
  category: z.enum([
    'housing', 'mortgage', 'property_tax', 'home_insurance', 'utilities',
    'food', 'transportation', 'healthcare_premium', 'healthcare_out_of_pocket',
    'travel', 'entertainment', 'education', 'family_support', 'insurance',
    'debt_payment', 'taxes', 'other'
  ]),
  amount: z.coerce.number().min(0),
  frequency: frequencySchema.default('monthly'),
  retirementBehavior: z.enum(['same', 'ends', 'custom', 'starts']).default('same'),
  postRetirementAmount: z.coerce.number().min(0).optional().nullable(),
  postRetirementFrequency: frequencySchema.default('monthly'),
  startAge: z.coerce.number().int().min(0).max(120).optional().nullable(),
  endAge: z.coerce.number().int().min(0).max(120).optional().nullable(),
  inflationRate: z.coerce.number().min(-0.1).max(0.2).default(0.025),
  essential: z.coerce.boolean().default(true),
  linkedLiabilityId: z.string().uuid().optional().nullable(),
  notes: z.string().max(1000).optional().nullable()
}).superRefine((value, ctx) => {
  if (['custom', 'starts'].includes(value.retirementBehavior) && value.postRetirementAmount == null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['postRetirementAmount'],
      message: 'Enter the post-retirement amount for this behavior'
    });
  }
  if (value.startAge != null && value.endAge != null && value.endAge < value.startAge) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['endAge'],
      message: 'End age must be at or after start age'
    });
  }
});

function divisor(frequency) {
  return { weekly: 52, biweekly: 26, monthly: 12, quarterly: 4, annual: 1 }[frequency] || 1;
}

function serializeIncome(row) {
  return {
    ...row,
    annual_amount: Number(row.annual_amount || 0),
    inflation_rate: Number(row.inflation_rate || 0),
    amount: Number(row.annual_amount || 0) / divisor(row.frequency)
  };
}

function serializeExpense(row) {
  return {
    ...row,
    annual_amount: Number(row.annual_amount || 0),
    post_retirement_annual_amount: row.post_retirement_annual_amount == null
      ? null
      : Number(row.post_retirement_annual_amount),
    inflation_rate: Number(row.inflation_rate || 0),
    amount: Number(row.annual_amount || 0) / divisor(row.frequency),
    post_retirement_amount: row.post_retirement_annual_amount == null
      ? null
      : Number(row.post_retirement_annual_amount) / divisor(row.post_retirement_frequency)
  };
}

planningRouter.get('/summary', async (req, res, next) => {
  try {
    const [planResult, incomeResult, expenseResult, liabilityResult] = await Promise.all([
      pool.query('SELECT * FROM retirement_plans WHERE household_id = $1', [req.householdId]),
      pool.query('SELECT * FROM income_streams WHERE household_id = $1 ORDER BY annual_amount DESC', [req.householdId]),
      pool.query('SELECT * FROM expenses WHERE household_id = $1 ORDER BY annual_amount DESC', [req.householdId]),
      pool.query(`SELECT id, household_id, name, liability_type,
                         monthly_payment::float8 AS monthly_payment,
                         payoff_age, linked_account_id
                  FROM liabilities WHERE household_id = $1`, [req.householdId])
    ]);
    const plan = planResult.rows[0] || { current_age: 45, retirement_age: 65 };
    const incomes = incomeResult.rows.map(serializeIncome);
    const explicitExpenses = expenseResult.rows;
    const derivedExpenses = buildDerivedLiabilityExpenses(liabilityResult.rows, explicitExpenses);
    const expenses = [...explicitExpenses, ...derivedExpenses].map(serializeExpense);
    const currentAge = Number(plan.current_age || 45);
    const retirementAge = Number(plan.retirement_age || 65);

    const currentAnnualIncome = incomes.reduce(
      (sum, item) => sum + incomeAtAge(item, currentAge, currentAge, retirementAge).gross,
      0
    );
    const currentAnnualExpenses = expenses.reduce(
      (sum, item) => sum + expenseAtAge(item, currentAge, currentAge, retirementAge),
      0
    );
    const retirementAnnualIncome = incomes.reduce(
      (sum, item) => sum + incomeAtAge(item, retirementAge, currentAge, retirementAge).gross,
      0
    );
    const retirementAnnualExpenses = expenses.reduce(
      (sum, item) => sum + expenseAtAge(item, retirementAge, currentAge, retirementAge),
      0
    );

    res.json({
      incomes,
      expenses,
      metrics: {
        currentMonthlyIncome: currentAnnualIncome / 12,
        currentMonthlyExpenses: currentAnnualExpenses / 12,
        currentMonthlySurplus: (currentAnnualIncome - currentAnnualExpenses) / 12,
        retirementMonthlyIncome: retirementAnnualIncome / 12,
        retirementMonthlyExpenses: retirementAnnualExpenses / 12,
        retirementMonthlyGap: (retirementAnnualExpenses - retirementAnnualIncome) / 12
      }
    });
  } catch (error) { next(error); }
});

planningRouter.post('/incomes', async (req, res, next) => {
  try {
    const value = incomeSchema.parse(req.body);
    const result = await pool.query(`
      INSERT INTO income_streams
        (household_id, name, income_type, annual_amount, frequency, start_age, end_age,
         inflation_rate, taxable, ends_at_retirement, notes, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now())
      RETURNING *`, [
      req.householdId, value.name, value.incomeType,
      annualize(value.amount, value.frequency), value.frequency,
      value.startAge ?? null, value.endAge ?? null, value.inflationRate,
      value.taxable, value.endsAtRetirement, value.notes || null
    ]);
    res.status(201).json(serializeIncome(result.rows[0]));
  } catch (error) { next(error); }
});

planningRouter.put('/incomes/:id', async (req, res, next) => {
  try {
    const value = incomeSchema.parse(req.body);
    const result = await pool.query(`
      UPDATE income_streams
      SET name=$1, income_type=$2, annual_amount=$3, frequency=$4,
          start_age=$5, end_age=$6, inflation_rate=$7, taxable=$8,
          ends_at_retirement=$9, notes=$10, updated_at=now()
      WHERE id=$11 AND household_id=$12
      RETURNING *`, [
      value.name, value.incomeType, annualize(value.amount, value.frequency), value.frequency,
      value.startAge ?? null, value.endAge ?? null, value.inflationRate,
      value.taxable, value.endsAtRetirement, value.notes || null,
      req.params.id, req.householdId
    ]);
    if (!result.rowCount) return res.status(404).json({ error: 'Income source not found' });
    res.json(serializeIncome(result.rows[0]));
  } catch (error) { next(error); }
});

planningRouter.delete('/incomes/:id', async (req, res, next) => {
  try {
    const result = await pool.query(
      'DELETE FROM income_streams WHERE id=$1 AND household_id=$2 RETURNING id',
      [req.params.id, req.householdId]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Income source not found' });
    res.json({ ok: true });
  } catch (error) { next(error); }
});

planningRouter.post('/expenses', async (req, res, next) => {
  try {
    const value = expenseSchema.parse(req.body);
    const result = await pool.query(`
      INSERT INTO expenses
        (household_id, name, category, annual_amount, frequency,
         post_retirement_annual_amount, post_retirement_frequency,
         retirement_behavior, start_age, end_age, inflation_rate,
         essential, linked_liability_id, notes, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,now())
      RETURNING *`, [
      req.householdId, value.name, value.category,
      annualize(value.amount, value.frequency), value.frequency,
      value.postRetirementAmount == null
        ? null
        : annualize(value.postRetirementAmount, value.postRetirementFrequency),
      value.postRetirementFrequency, value.retirementBehavior,
      value.startAge ?? null, value.endAge ?? null, value.inflationRate,
      value.essential, value.linkedLiabilityId || null, value.notes || null
    ]);
    res.status(201).json(serializeExpense(result.rows[0]));
  } catch (error) { next(error); }
});

planningRouter.put('/expenses/:id', async (req, res, next) => {
  try {
    const value = expenseSchema.parse(req.body);
    const result = await pool.query(`
      UPDATE expenses
      SET name=$1, category=$2, annual_amount=$3, frequency=$4,
          post_retirement_annual_amount=$5, post_retirement_frequency=$6,
          retirement_behavior=$7, start_age=$8, end_age=$9,
          inflation_rate=$10, essential=$11, linked_liability_id=$12,
          notes=$13, updated_at=now()
      WHERE id=$14 AND household_id=$15
      RETURNING *`, [
      value.name, value.category, annualize(value.amount, value.frequency), value.frequency,
      value.postRetirementAmount == null
        ? null
        : annualize(value.postRetirementAmount, value.postRetirementFrequency),
      value.postRetirementFrequency, value.retirementBehavior,
      value.startAge ?? null, value.endAge ?? null, value.inflationRate,
      value.essential, value.linkedLiabilityId || null, value.notes || null,
      req.params.id, req.householdId
    ]);
    if (!result.rowCount) return res.status(404).json({ error: 'Expense not found' });
    res.json(serializeExpense(result.rows[0]));
  } catch (error) { next(error); }
});

planningRouter.delete('/expenses/:id', async (req, res, next) => {
  try {
    const result = await pool.query(
      'DELETE FROM expenses WHERE id=$1 AND household_id=$2 RETURNING id',
      [req.params.id, req.householdId]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Expense not found' });
    res.json({ ok: true });
  } catch (error) { next(error); }
});
