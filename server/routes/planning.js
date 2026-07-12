import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db.js';
import { annualize, expenseAtAge, incomeAtAge } from '../services/retirement-cashflow-engine.js';
import { buildDerivedLiabilityExpenses } from '../services/retirement-service.js';
import { calculateNetWorthProjection } from '../services/net-worth-service.js';
import { contributionAtYear, scheduleMonthlyAmount } from '../services/account-contribution.js';

export const planningRouter = Router();

const frequencySchema = z.enum(['weekly', 'biweekly', 'monthly', 'quarterly', 'annual']);

const incomeSchema = z.object({
  name: z.string().min(1).max(120),
  incomeType: z.enum(['employment', 'social_security', 'pension', 'annuity', 'rental', 'part_time', 'other']),
  amount: z.coerce.number().min(0),
  frequency: frequencySchema.default('monthly'),
  startAge: z.coerce.number().int().min(0).max(120).optional().nullable(),
  endAge: z.coerce.number().int().min(0).max(120).optional().nullable(),
  startDate: z.string().date().optional().nullable(),
  endDate: z.string().date().optional().nullable(),
  inflationRate: z.coerce.number().min(-0.1).max(0.2).default(0),
  taxable: z.coerce.boolean().default(true),
  endsAtRetirement: z.coerce.boolean().default(false),
  depositAccountId: z.string().uuid().optional().nullable(),
  notes: z.string().max(1000).optional().nullable()
}).superRefine((value, ctx) => {
  if (value.startAge != null && value.endAge != null && value.endAge < value.startAge) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['endAge'], message: 'End age must be at or after start age' });
  }
  if (value.startDate && value.endDate && value.endDate < value.startDate) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['endDate'], message: 'End date must be at or after start date' });
  }
});

const expenseSchema = z.object({
  name: z.string().min(1).max(120),
  category: z.enum([
    'housing', 'mortgage', 'property_tax', 'home_insurance', 'mortgage_insurance', 'hoa',
    'utilities', 'food', 'transportation', 'auto_insurance',
    'healthcare_premium', 'medical_insurance', 'dental_vision_insurance',
    'medicare', 'healthcare_out_of_pocket', 'long_term_care_insurance',
    'travel', 'entertainment', 'education', 'family_support',
    'life_insurance', 'umbrella_insurance', 'insurance',
    'debt_payment', 'taxes', 'other'
  ]),
  amount: z.coerce.number().min(0),
  frequency: frequencySchema.default('monthly'),
  retirementBehavior: z.enum(['same', 'ends', 'custom', 'starts']).default('same'),
  postRetirementAmount: z.coerce.number().min(0).optional().nullable(),
  postRetirementFrequency: frequencySchema.default('monthly'),
  startAge: z.coerce.number().int().min(0).max(120).optional().nullable(),
  endAge: z.coerce.number().int().min(0).max(120).optional().nullable(),
  startDate: z.string().date().optional().nullable(),
  endDate: z.string().date().optional().nullable(),
  inflationRate: z.coerce.number().min(-0.1).max(0.2).default(0.025),
  essential: z.coerce.boolean().default(true),
  linkedLiabilityId: z.string().uuid().optional().nullable(),
  paymentAccountId: z.string().uuid().optional().nullable(),
  fundingPolicy: z.enum(['linked_then_liquid', 'linked_only']).default('linked_then_liquid'),
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
  if (value.startDate && value.endDate && value.endDate < value.startDate) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['endDate'], message: 'End date must be at or after start date' });
  }
});

const contributionSchema = z.object({
  name: z.string().min(1).max(120),
  contributionType: z.enum(['transfer', 'external', 'employer_match']).default('transfer'),
  sourceAccountId: z.string().uuid().optional().nullable(),
  targetAccountId: z.string().uuid(),
  amount: z.coerce.number().min(0),
  frequency: frequencySchema.default('monthly'),
  startDate: z.string().date().optional().nullable(),
  endDate: z.string().date().optional().nullable(),
  annualIncreaseRate: z.coerce.number().min(-0.1).max(0.5).default(0),
  notes: z.string().max(1000).optional().nullable()
}).superRefine((value, ctx) => {
  if (value.contributionType === 'transfer' && !value.sourceAccountId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['sourceAccountId'],
      message: 'Choose the account funding this transfer'
    });
  }
  if (value.sourceAccountId && value.sourceAccountId === value.targetAccountId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['targetAccountId'],
      message: 'Source and target accounts must be different'
    });
  }
  if (value.startDate && value.endDate && value.endDate < value.startDate) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['endDate'], message: 'End date must be at or after start date' });
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

function serializeContribution(row) {
  return {
    ...row,
    amount: Number(row.amount || 0),
    annual_increase_rate: Number(row.annual_increase_rate || 0),
    monthly_amount: scheduleMonthlyAmount(row),
    current_monthly_amount: contributionAtYear(
      row,
      new Date().getUTCFullYear(),
      new Date().getUTCFullYear()
    ) / 12
  };
}

async function ensureAccountLink(accountId, householdId) {
  if (!accountId) return null;
  const result = await pool.query(
    'SELECT id FROM accounts WHERE id=$1 AND household_id=$2',
    [accountId, householdId]
  );
  if (!result.rowCount) {
    const error = new Error('Linked account not found');
    error.status = 400;
    throw error;
  }
  return accountId;
}

planningRouter.get('/net-worth-projection', async (req, res, next) => {
  try {
    res.json(await calculateNetWorthProjection(req.householdId));
  } catch (error) { next(error); }
});

planningRouter.get('/summary', async (req, res, next) => {
  try {
    const [planResult, incomeResult, expenseResult, liabilityResult, accountResult, contributionResult] = await Promise.all([
      pool.query('SELECT * FROM retirement_plans WHERE household_id = $1', [req.householdId]),
      pool.query('SELECT * FROM income_streams WHERE household_id = $1 ORDER BY annual_amount DESC', [req.householdId]),
      pool.query('SELECT * FROM expenses WHERE household_id = $1 ORDER BY annual_amount DESC', [req.householdId]),
      pool.query(`
        SELECT id, household_id, name, liability_type,
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
               other_escrow_payment::float8 AS other_escrow_payment
        FROM liabilities WHERE household_id = $1`, [req.householdId]),
      pool.query(`
        SELECT id, name, account_type, institution,
               current_balance::float8 AS current_balance
        FROM accounts WHERE household_id=$1 ORDER BY current_balance DESC`, [req.householdId]),
      pool.query(`
        SELECT id, household_id, name, contribution_type, source_account_id,
               target_account_id, amount::float8 AS amount, frequency,
               start_date, end_date,
               annual_increase_rate::float8 AS annual_increase_rate, notes
        FROM account_contribution_schedules
        WHERE household_id=$1
        ORDER BY start_date NULLS FIRST, created_at`, [req.householdId])
    ]);
    const plan = planResult.rows[0] || { current_age: 45, retirement_age: 65, effective_tax_rate: 0.15 };
    const incomes = incomeResult.rows.map(serializeIncome);
    const explicitExpenses = expenseResult.rows;
    const derivedExpenses = buildDerivedLiabilityExpenses(
      liabilityResult.rows,
      explicitExpenses,
      Number(plan.current_age || 45)
    );
    const expenses = [...explicitExpenses, ...derivedExpenses].map(serializeExpense);
    const contributions = contributionResult.rows.map(serializeContribution);
    const currentAge = Number(plan.current_age || 45);
    const retirementAge = Number(plan.retirement_age || 65);
    const taxRate = Number(plan.effective_tax_rate ?? 0.15);

    const currentIncome = incomes.reduce((total, item) => {
      const value = incomeAtAge(item, currentAge, currentAge, retirementAge);
      total.gross += value.gross;
      total.afterTax += value.nonTaxable + value.taxable * (1 - taxRate);
      return total;
    }, { gross: 0, afterTax: 0 });
    const currentAnnualExpenses = expenses.reduce(
      (sum, item) => sum + expenseAtAge(item, currentAge, currentAge, retirementAge),
      0
    );
    const retirementIncome = incomes.reduce((total, item) => {
      const value = incomeAtAge(item, retirementAge, currentAge, retirementAge);
      total.gross += value.gross;
      total.afterTax += value.nonTaxable + value.taxable * (1 - taxRate);
      return total;
    }, { gross: 0, afterTax: 0 });
    const retirementAnnualExpenses = expenses.reduce(
      (sum, item) => sum + expenseAtAge(item, retirementAge, currentAge, retirementAge),
      0
    );

    res.json({
      incomes,
      expenses,
      contributions,
      accounts: accountResult.rows,
      metrics: {
        currentMonthlyGrossIncome: currentIncome.gross / 12,
        currentMonthlyIncome: currentIncome.afterTax / 12,
        currentMonthlyExpenses: currentAnnualExpenses / 12,
        currentMonthlySurplus: (currentIncome.afterTax - currentAnnualExpenses) / 12,
        retirementMonthlyGrossIncome: retirementIncome.gross / 12,
        retirementMonthlyIncome: retirementIncome.afterTax / 12,
        retirementMonthlyExpenses: retirementAnnualExpenses / 12,
        retirementMonthlyGap: (retirementAnnualExpenses - retirementIncome.afterTax) / 12,
        currentMonthlyContributions: contributions
          .reduce((sum, item) => sum + Number(item.current_monthly_amount || 0), 0)
      }
    });
  } catch (error) { next(error); }
});

planningRouter.post('/incomes', async (req, res, next) => {
  try {
    const value = incomeSchema.parse(req.body);
    await ensureAccountLink(value.depositAccountId, req.householdId);
    const result = await pool.query(`
      INSERT INTO income_streams
        (household_id, name, income_type, annual_amount, frequency, start_age, end_age,
         inflation_rate, taxable, ends_at_retirement, deposit_account_id,
         start_date, end_date, notes, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,now())
      RETURNING *`, [
      req.householdId, value.name, value.incomeType,
      annualize(value.amount, value.frequency), value.frequency,
      value.startAge ?? null, value.endAge ?? null, value.inflationRate,
      value.taxable, value.endsAtRetirement, value.depositAccountId || null,
      value.startDate || null, value.endDate || null, value.notes || null
    ]);
    res.status(201).json(serializeIncome(result.rows[0]));
  } catch (error) { next(error); }
});

planningRouter.put('/incomes/:id', async (req, res, next) => {
  try {
    const value = incomeSchema.parse(req.body);
    await ensureAccountLink(value.depositAccountId, req.householdId);
    const result = await pool.query(`
      UPDATE income_streams
      SET name=$1, income_type=$2, annual_amount=$3, frequency=$4,
          start_age=$5, end_age=$6, inflation_rate=$7, taxable=$8,
          ends_at_retirement=$9, deposit_account_id=$10, start_date=$11,
          end_date=$12, notes=$13, updated_at=now()
      WHERE id=$14 AND household_id=$15
      RETURNING *`, [
      value.name, value.incomeType, annualize(value.amount, value.frequency), value.frequency,
      value.startAge ?? null, value.endAge ?? null, value.inflationRate,
      value.taxable, value.endsAtRetirement, value.depositAccountId || null,
      value.startDate || null, value.endDate || null, value.notes || null,
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
    await ensureAccountLink(value.paymentAccountId, req.householdId);
    const result = await pool.query(`
      INSERT INTO expenses
        (household_id, name, category, annual_amount, frequency,
         post_retirement_annual_amount, post_retirement_frequency,
         retirement_behavior, start_age, end_age, inflation_rate,
         essential, linked_liability_id, payment_account_id,
         start_date, end_date, funding_policy, notes, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,now())
      RETURNING *`, [
      req.householdId, value.name, value.category,
      annualize(value.amount, value.frequency), value.frequency,
      value.postRetirementAmount == null
        ? null
        : annualize(value.postRetirementAmount, value.postRetirementFrequency),
      value.postRetirementFrequency, value.retirementBehavior,
      value.startAge ?? null, value.endAge ?? null, value.inflationRate,
      value.essential, value.linkedLiabilityId || null,
      value.paymentAccountId || null, value.startDate || null, value.endDate || null,
      value.fundingPolicy, value.notes || null
    ]);
    res.status(201).json(serializeExpense(result.rows[0]));
  } catch (error) { next(error); }
});

planningRouter.put('/expenses/:id', async (req, res, next) => {
  try {
    const value = expenseSchema.parse(req.body);
    await ensureAccountLink(value.paymentAccountId, req.householdId);
    const result = await pool.query(`
      UPDATE expenses
      SET name=$1, category=$2, annual_amount=$3, frequency=$4,
          post_retirement_annual_amount=$5, post_retirement_frequency=$6,
          retirement_behavior=$7, start_age=$8, end_age=$9,
          inflation_rate=$10, essential=$11, linked_liability_id=$12,
          payment_account_id=$13, start_date=$14, end_date=$15,
          funding_policy=$16, notes=$17, updated_at=now()
      WHERE id=$18 AND household_id=$19
      RETURNING *`, [
      value.name, value.category, annualize(value.amount, value.frequency), value.frequency,
      value.postRetirementAmount == null
        ? null
        : annualize(value.postRetirementAmount, value.postRetirementFrequency),
      value.postRetirementFrequency, value.retirementBehavior,
      value.startAge ?? null, value.endAge ?? null, value.inflationRate,
      value.essential, value.linkedLiabilityId || null,
      value.paymentAccountId || null, value.startDate || null, value.endDate || null,
      value.fundingPolicy, value.notes || null, req.params.id, req.householdId
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


planningRouter.post('/contributions', async (req, res, next) => {
  try {
    const value = contributionSchema.parse(req.body);
    await ensureAccountLink(value.targetAccountId, req.householdId);
    await ensureAccountLink(value.sourceAccountId, req.householdId);
    const result = await pool.query(`
      INSERT INTO account_contribution_schedules
        (household_id, name, contribution_type, source_account_id, target_account_id,
         amount, frequency, start_date, end_date, annual_increase_rate, notes, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,now())
      RETURNING *`, [
      req.householdId, value.name, value.contributionType,
      value.sourceAccountId || null, value.targetAccountId, value.amount,
      value.frequency, value.startDate || null, value.endDate || null,
      value.annualIncreaseRate, value.notes || null
    ]);
    res.status(201).json(serializeContribution(result.rows[0]));
  } catch (error) { next(error); }
});

planningRouter.put('/contributions/:id', async (req, res, next) => {
  try {
    const value = contributionSchema.parse(req.body);
    await ensureAccountLink(value.targetAccountId, req.householdId);
    await ensureAccountLink(value.sourceAccountId, req.householdId);
    const result = await pool.query(`
      UPDATE account_contribution_schedules
      SET name=$1, contribution_type=$2, source_account_id=$3,
          target_account_id=$4, amount=$5, frequency=$6, start_date=$7,
          end_date=$8, annual_increase_rate=$9, notes=$10, updated_at=now()
      WHERE id=$11 AND household_id=$12
      RETURNING *`, [
      value.name, value.contributionType, value.sourceAccountId || null,
      value.targetAccountId, value.amount, value.frequency,
      value.startDate || null, value.endDate || null,
      value.annualIncreaseRate, value.notes || null,
      req.params.id, req.householdId
    ]);
    if (!result.rowCount) return res.status(404).json({ error: 'Contribution schedule not found' });
    res.json(serializeContribution(result.rows[0]));
  } catch (error) { next(error); }
});

planningRouter.delete('/contributions/:id', async (req, res, next) => {
  try {
    const result = await pool.query(
      'DELETE FROM account_contribution_schedules WHERE id=$1 AND household_id=$2 RETURNING id',
      [req.params.id, req.householdId]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Contribution schedule not found' });
    res.json({ ok: true });
  } catch (error) { next(error); }
});
