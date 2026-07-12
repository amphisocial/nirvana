import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../db.js';
import { loadRetirementData } from '../services/retirement-service.js';
import { parseWhatIfPrompt } from '../services/what-if-parser.js';
import { simulateHouseholdWhatIf, simulatePortfolioWhatIf } from '../services/what-if-engine.js';

export const whatIfRouter = Router();

const promptSchema = z.object({
  prompt: z.string().trim().min(3).max(5000),
  accountId: z.string().uuid().optional().nullable(),
  horizonYears: z.coerce.number().int().min(1).max(40).optional(),
  useAI: z.coerce.boolean().optional().default(true)
});

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeHolding(row) {
  const quantity = Math.max(0, number(row.quantity));
  const directValue = number(row.market_value ?? row.current_value ?? row.value, NaN);
  const price = number(
    row.current_price ?? row.last_price ?? row.market_price ?? row.price ?? row.average_cost ?? row.cost_basis,
    0
  );
  return {
    ...row,
    symbol: String(row.symbol || row.ticker || 'OTHER').toUpperCase(),
    quantity,
    price,
    market_value: Number.isFinite(directValue) && directValue >= 0
      ? directValue
      : quantity * price
  };
}

async function loadHoldings(householdId) {
  const result = await pool.query(`
    SELECT h.*, a.name AS account_name, a.account_type
    FROM holdings h
    JOIN accounts a ON a.id = h.account_id
    WHERE a.household_id = $1
    ORDER BY a.name`, [householdId]);
  return result.rows.map(normalizeHolding);
}

function publicContext(data, holdings) {
  return {
    currentAge: Number(data.plan?.current_age || 45),
    retirementAge: Number(data.plan?.retirement_age || 65),
    planEndAge: Number(data.plan?.plan_end_age || 95),
    accounts: (data.accounts || []).map((row) => ({
      id: row.id,
      name: row.name,
      account_type: row.account_type,
      current_balance: number(row.current_balance),
      expected_return: row.expected_return == null ? null : number(row.expected_return),
      forecast_expected_return: row.forecast_expected_return == null ? null : number(row.forecast_expected_return)
    })),
    liabilities: (data.liabilities || []).map((row) => ({
      id: row.id,
      name: row.name,
      liability_type: row.liability_type,
      current_balance: number(row.current_balance),
      monthly_payment: number(row.monthly_payment || row.minimum_payment),
      principal_interest_payment: number(row.principal_interest_payment)
    })),
    holdings: holdings.map((row) => ({
      id: row.id,
      account_id: row.account_id,
      account_name: row.account_name,
      symbol: row.symbol,
      quantity: row.quantity,
      price: row.price,
      market_value: number(row.market_value)
    }))
  };
}

whatIfRouter.get('/context', async (req, res, next) => {
  try {
    const [data, holdings] = await Promise.all([
      loadRetirementData(req.householdId),
      loadHoldings(req.householdId)
    ]);
    res.json(publicContext(data, holdings));
  } catch (error) {
    next(error);
  }
});

whatIfRouter.post('/analyze', async (req, res, next) => {
  try {
    const value = promptSchema.parse(req.body);
    const [data, holdings] = await Promise.all([
      loadRetirementData(req.householdId),
      loadHoldings(req.householdId)
    ]);
    const context = publicContext(data, holdings);
    const scenario = value.useAI
      ? await parseWhatIfPrompt(value.prompt, context, 'household')
      : await parseWhatIfPrompt(value.prompt, context, 'household');
    const analysis = simulateHouseholdWhatIf(data, scenario);
    res.json({
      prompt: value.prompt,
      persisted: false,
      ...analysis
    });
  } catch (error) {
    next(error);
  }
});

whatIfRouter.post('/portfolio', async (req, res, next) => {
  try {
    const value = promptSchema.parse(req.body);
    const [data, holdings] = await Promise.all([
      loadRetirementData(req.householdId),
      loadHoldings(req.householdId)
    ]);
    const context = publicContext(data, holdings);
    const scenario = await parseWhatIfPrompt(value.prompt, context, 'portfolio');
    scenario.accountId = value.accountId || scenario.accountId || null;
    scenario.horizonYears = value.horizonYears || scenario.horizonYears || 10;
    const analysis = simulatePortfolioWhatIf(data, holdings, scenario);
    res.json({
      prompt: value.prompt,
      persisted: false,
      scenario,
      ...analysis
    });
  } catch (error) {
    next(error);
  }
});
