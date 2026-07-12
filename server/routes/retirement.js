import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db.js';
import { calculateRetirementProjection } from '../services/retirement-service.js';

export const retirementRouter = Router();

const planSchema = z.object({
  currentAge: z.coerce.number().int().min(18).max(90),
  retirementAge: z.coerce.number().int().min(19).max(95),
  planEndAge: z.coerce.number().int().min(50).max(120),
  annualContribution: z.coerce.number().min(0),
  annualRetirementSpending: z.coerce.number().min(0),
  expectedReturn: z.coerce.number().min(-0.5).max(0.5),
  volatility: z.coerce.number().min(0).max(1),
  inflation: z.coerce.number().min(-0.02).max(0.2),
  successThreshold: z.coerce.number().min(0.5).max(0.99).default(0.90),
  maxSearchAge: z.coerce.number().int().min(40).max(95).default(75),
  effectiveTaxRate: z.coerce.number().min(0).max(0.6).default(0.15)
}).refine((value) => value.retirementAge > value.currentAge, { message: 'Retirement age must exceed current age' })
  .refine((value) => value.planEndAge > value.retirementAge, { message: 'Plan end age must exceed retirement age' })
  .refine((value) => value.maxSearchAge > value.currentAge, { message: 'Maximum search age must exceed current age' });

retirementRouter.get('/projection', async (req, res, next) => {
  try {
    const projection = await calculateRetirementProjection(req.householdId);
    if (!projection) return res.status(404).json({ error: 'Retirement plan not found' });
    res.json(projection);
  } catch (error) { next(error); }
});

retirementRouter.put('/plan', async (req, res, next) => {
  try {
    const value = planSchema.parse(req.body);
    const result = await pool.query(`
      INSERT INTO retirement_plans
        (household_id, current_age, retirement_age, plan_end_age,
         annual_contribution, annual_retirement_spending,
         expected_return, volatility, inflation,
         success_threshold, max_search_age, effective_tax_rate, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,now())
      ON CONFLICT (household_id) DO UPDATE SET
        current_age = EXCLUDED.current_age,
        retirement_age = EXCLUDED.retirement_age,
        plan_end_age = EXCLUDED.plan_end_age,
        annual_contribution = EXCLUDED.annual_contribution,
        annual_retirement_spending = EXCLUDED.annual_retirement_spending,
        expected_return = EXCLUDED.expected_return,
        volatility = EXCLUDED.volatility,
        inflation = EXCLUDED.inflation,
        success_threshold = EXCLUDED.success_threshold,
        max_search_age = EXCLUDED.max_search_age,
        effective_tax_rate = EXCLUDED.effective_tax_rate,
        updated_at = now()
      RETURNING *`, [
      req.householdId, value.currentAge, value.retirementAge, value.planEndAge,
      value.annualContribution, value.annualRetirementSpending,
      value.expectedReturn, value.volatility, value.inflation,
      value.successThreshold, value.maxSearchAge, value.effectiveTaxRate
    ]);
    res.json(result.rows[0]);
  } catch (error) { next(error); }
});
