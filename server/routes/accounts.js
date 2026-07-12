import { Router } from 'express';
import multer from 'multer';
import { parse } from 'csv-parse/sync';
import { z } from 'zod';
import { pool, withTransaction } from '../db.js';
import { expenseAtAge, incomeAtAge } from '../services/retirement-cashflow-engine.js';
import { getQuote } from '../services/market/index.js';
import { linkedContributionForAccount } from '../services/account-contribution.js';
import {
  estimatePortfolioMoments,
  researchHoldingsForForecast,
  simulateAccountForecast
} from '../services/account-forecast.js';
import {
  estimatedPayoffAge,
  monthsElapsedSince,
  mortgagePaymentBreakdown
} from '../services/loan-schedule.js';

export const accountsRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });

const investmentAccountTypes = new Set(['brokerage', 'ira', '401k', 'retirement', '529']);
const retirementAccountTypes = new Set(['ira', '401k', 'retirement']);

const styleDefaults = {
  growth: { expectedReturn: 0.08, expectedVolatility: 0.18 },
  balanced: { expectedReturn: 0.06, expectedVolatility: 0.12 },
  conservative: { expectedReturn: 0.04, expectedVolatility: 0.07 },
  self_managed: { expectedReturn: 0.07, expectedVolatility: 0.20 }
};

const accountSchema = z.object({
  name: z.string().min(1).max(120),
  institution: z.string().max(120).optional().nullable(),
  accountType: z.enum(['cash', 'brokerage', 'ira', '401k', 'retirement', 'property', 'hsa', '529', 'other_asset']),
  currentBalance: z.coerce.number().min(0),
  currency: z.string().length(3).default('USD'),
  projectionMethod: z.enum(['profile', 'holdings_monte_carlo']).optional().nullable(),
  investmentStyle: z.enum(['growth', 'balanced', 'conservative', 'self_managed']).optional().nullable(),
  expectedReturn: z.coerce.number().min(-0.5).max(0.5).optional().nullable(),
  expectedVolatility: z.coerce.number().min(0).max(1).optional().nullable(),
  isPrimaryResidence: z.coerce.boolean().optional().default(false),
  retirementTreatment: z.enum([
    'keep', 'sell_at_retirement', 'sell_at_age', 'downsize',
    'convert_to_rental', 'equity_access', 'undecided'
  ]).optional().default('keep'),
  retirementTreatmentAge: z.coerce.number().int().min(18).max(120).optional().nullable(),
  retirementCashRelease: z.coerce.number().min(0).optional().nullable(),
  propertyGrowthRate: z.coerce.number().min(-0.2).max(0.2).optional().default(0.03)
}).superRefine((value, ctx) => {
  const method = value.projectionMethod
    || (['brokerage', 'ira'].includes(value.accountType) || value.investmentStyle === 'self_managed'
      ? 'holdings_monte_carlo'
      : 'profile');
  if (investmentAccountTypes.has(value.accountType) && method === 'profile' && !value.investmentStyle) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['investmentStyle'],
      message: 'Choose an investment style or use holdings-based Monte Carlo'
    });
  }
  if (value.accountType === 'property'
      && ['sell_at_age', 'downsize', 'equity_access'].includes(value.retirementTreatment)
      && value.retirementTreatmentAge == null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['retirementTreatmentAge'],
      message: 'Enter the age for this property scenario'
    });
  }
});

const liabilitySchema = z.object({
  name: z.string().min(1).max(120),
  institution: z.string().max(120).optional().nullable(),
  liabilityType: z.enum(['mortgage', 'credit_card', 'student_loan', 'auto_loan', 'personal_loan', 'other']),
  originalAmount: z.coerce.number().min(0).optional().nullable(),
  currentBalance: z.coerce.number().min(0),
  interestRate: z.coerce.number().min(0).max(1).optional().nullable(),
  minimumPayment: z.coerce.number().min(0).optional().nullable(),
  monthlyPayment: z.coerce.number().min(0).optional().nullable(),
  payoffAge: z.coerce.number().int().min(18).max(120).optional().nullable(),
  linkedAccountId: z.string().uuid().optional().nullable(),
  originalTermMonths: z.coerce.number().int().min(1).max(600).optional().nullable(),
  loanStartDate: z.string().date().optional().nullable(),
  currentTermMonth: z.coerce.number().int().min(0).max(600).optional().nullable(),
  principalInterestPayment: z.coerce.number().min(0).optional().nullable(),
  propertyTaxPayment: z.coerce.number().min(0).optional().nullable(),
  homeInsurancePayment: z.coerce.number().min(0).optional().nullable(),
  pmiPayment: z.coerce.number().min(0).optional().nullable(),
  hoaPayment: z.coerce.number().min(0).optional().nullable(),
  otherEscrowPayment: z.coerce.number().min(0).optional().nullable()
}).superRefine((value, ctx) => {
  if (['mortgage', 'student_loan', 'auto_loan', 'personal_loan'].includes(value.liabilityType)
      && value.originalTermMonths == null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['originalTermMonths'],
      message: 'Enter the original loan term'
    });
  }
  const amortizing = ['mortgage', 'student_loan', 'auto_loan', 'personal_loan'].includes(value.liabilityType);
  if (amortizing && !value.loanStartDate && value.currentTermMonth == null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['loanStartDate'],
      message: 'Enter the loan start date or current loan year and month'
    });
  }
  if (amortizing && !(Number(value.monthlyPayment || value.principalInterestPayment || value.minimumPayment) > 0)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['monthlyPayment'],
      message: 'Enter the monthly payment'
    });
  }
  if (value.currentTermMonth != null && value.originalTermMonths != null
      && value.currentTermMonth > value.originalTermMonths) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['currentTermMonth'],
      message: 'Current loan month cannot exceed the original term'
    });
  }
});

const holdingSchema = z.object({
  symbol: z.string().min(1).max(12).transform((value) => value.trim().toUpperCase()),
  name: z.string().max(160).optional().nullable(),
  assetClass: z.string().max(80).optional().default('equity'),
  quantity: z.coerce.number().min(0),
  costBasisPerShare: z.coerce.number().min(0).optional().nullable(),
  currentPrice: z.coerce.number().min(0).optional().nullable()
});

function defaultProjectionMethod(value) {
  if (!investmentAccountTypes.has(value.accountType)) return 'profile';
  if (value.projectionMethod) return value.projectionMethod;
  if (['brokerage', 'ira'].includes(value.accountType) || value.investmentStyle === 'self_managed') return 'holdings_monte_carlo';
  return 'profile';
}

function normalizeInvestmentProfile(value) {
  if (!investmentAccountTypes.has(value.accountType)) {
    return {
      projectionMethod: 'profile',
      investmentStyle: null,
      expectedReturn: null,
      expectedVolatility: null
    };
  }
  const projectionMethod = defaultProjectionMethod(value);
  const style = value.investmentStyle || (['brokerage', 'ira'].includes(value.accountType) ? 'self_managed' : 'balanced');
  const defaults = styleDefaults[style] || styleDefaults.balanced;
  return {
    projectionMethod,
    investmentStyle: style,
    expectedReturn: value.expectedReturn ?? defaults.expectedReturn,
    expectedVolatility: value.expectedVolatility ?? defaults.expectedVolatility
  };
}

function normalizePropertyProfile(value) {
  if (value.accountType !== 'property') {
    return {
      isPrimaryResidence: false,
      retirementTreatment: 'keep',
      retirementTreatmentAge: null,
      retirementCashRelease: null,
      propertyGrowthRate: 0.03
    };
  }
  return {
    isPrimaryResidence: Boolean(value.isPrimaryResidence),
    retirementTreatment: value.retirementTreatment || 'keep',
    retirementTreatmentAge: value.retirementTreatmentAge ?? null,
    retirementCashRelease: value.retirementCashRelease ?? null,
    propertyGrowthRate: value.propertyGrowthRate ?? 0.03
  };
}

async function ensureOwnedAccount(accountId, householdId, allowedTypes = null) {
  if (!accountId) return null;
  const result = await pool.query(
    'SELECT * FROM accounts WHERE id = $1 AND household_id = $2',
    [accountId, householdId]
  );
  if (!result.rowCount) {
    const error = new Error('Account not found');
    error.status = 404;
    throw error;
  }
  const account = result.rows[0];
  if (allowedTypes && !allowedTypes.has(account.account_type)) {
    const error = new Error('This account type does not support a holdings portfolio');
    error.status = 400;
    throw error;
  }
  return account;
}

async function ensureOwnedLinkedAccount(accountId, householdId) {
  if (!accountId) return null;
  return ensureOwnedAccount(accountId, householdId);
}

async function refreshAccountBalance(client, accountId) {
  const result = await client.query(`
    SELECT COALESCE(SUM(quantity * COALESCE(current_price, 0)), 0)::float8 AS value
    FROM holdings WHERE account_id = $1`, [accountId]);
  const value = Number(result.rows[0]?.value || 0);
  await client.query(`
    UPDATE accounts
    SET current_balance = $1, last_verified_at = now(), updated_at = now()
    WHERE id = $2`, [value, accountId]);
  return value;
}

async function currentAgeForHousehold(householdId) {
  const result = await pool.query(
    'SELECT current_age FROM retirement_plans WHERE household_id = $1',
    [householdId]
  );
  return result.rows[0]?.current_age == null ? null : Number(result.rows[0].current_age);
}

function normalizeLiability(value, currentAge) {
  const currentTermMonth = value.currentTermMonth
    ?? monthsElapsedSince(value.loanStartDate)
    ?? null;
  const breakdown = mortgagePaymentBreakdown({
    liability_type: value.liabilityType,
    monthly_payment: value.monthlyPayment,
    principal_interest_payment: value.principalInterestPayment,
    property_tax_payment: value.propertyTaxPayment,
    home_insurance_payment: value.homeInsurancePayment,
    pmi_payment: value.pmiPayment,
    hoa_payment: value.hoaPayment,
    other_escrow_payment: value.otherEscrowPayment
  });
  const monthlyPayment = value.liabilityType === 'mortgage'
    ? breakdown.total
    : Number(value.monthlyPayment ?? value.minimumPayment ?? 0) || null;
  const row = {
    liability_type: value.liabilityType,
    payoff_age: value.payoffAge,
    original_term_months: value.originalTermMonths,
    loan_start_date: value.loanStartDate,
    current_term_month: currentTermMonth
  };
  return {
    currentTermMonth,
    monthlyPayment,
    payoffAge: value.payoffAge ?? estimatedPayoffAge(row, currentAge),
    breakdown
  };
}

accountsRouter.get('/', async (req, res, next) => {
  try {
    const result = await pool.query(
      'SELECT * FROM accounts WHERE household_id = $1 ORDER BY current_balance DESC',
      [req.householdId]
    );
    res.json(result.rows);
  } catch (error) { next(error); }
});

accountsRouter.post('/', async (req, res, next) => {
  try {
    const value = accountSchema.parse(req.body);
    const profile = normalizeInvestmentProfile(value);
    const property = normalizePropertyProfile(value);
    const result = await pool.query(
      `INSERT INTO accounts
        (household_id, name, institution, account_type, current_balance, currency,
         projection_method, investment_style, expected_return, expected_volatility,
         is_primary_residence, retirement_treatment, retirement_treatment_age,
         retirement_cash_release, property_growth_rate, last_verified_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,now())
       RETURNING *`,
      [
        req.householdId, value.name, value.institution || null, value.accountType,
        value.currentBalance, value.currency.toUpperCase(), profile.projectionMethod,
        profile.investmentStyle, profile.expectedReturn, profile.expectedVolatility,
        property.isPrimaryResidence, property.retirementTreatment,
        property.retirementTreatmentAge, property.retirementCashRelease,
        property.propertyGrowthRate
      ]
    );
    const account = result.rows[0];
    res.status(201).json({
      ...account,
      requiresPortfolioSetup: investmentAccountTypes.has(account.account_type)
        && account.projection_method === 'holdings_monte_carlo'
    });
  } catch (error) { next(error); }
});

accountsRouter.put('/:id', async (req, res, next) => {
  try {
    const value = accountSchema.parse(req.body);
    const profile = normalizeInvestmentProfile(value);
    const property = normalizePropertyProfile(value);
    const result = await pool.query(
      `UPDATE accounts
       SET name = $1,
           institution = $2,
           account_type = $3,
           current_balance = $4,
           currency = $5,
           projection_method = $6,
           investment_style = $7,
           expected_return = $8,
           expected_volatility = $9,
           forecast_expected_return = CASE WHEN $6 = 'profile' THEN NULL ELSE forecast_expected_return END,
           forecast_volatility = CASE WHEN $6 = 'profile' THEN NULL ELSE forecast_volatility END,
           forecast_as_of = CASE WHEN $6 = 'profile' THEN NULL ELSE forecast_as_of END,
           forecast_source = CASE WHEN $6 = 'profile' THEN NULL ELSE forecast_source END,
           is_primary_residence = $10,
           retirement_treatment = $11,
           retirement_treatment_age = $12,
           retirement_cash_release = $13,
           property_growth_rate = $14,
           last_verified_at = now(),
           updated_at = now()
       WHERE id = $15 AND household_id = $16
       RETURNING *`,
      [
        value.name, value.institution || null, value.accountType,
        value.currentBalance, value.currency.toUpperCase(), profile.projectionMethod,
        profile.investmentStyle, profile.expectedReturn, profile.expectedVolatility,
        property.isPrimaryResidence, property.retirementTreatment,
        property.retirementTreatmentAge, property.retirementCashRelease,
        property.propertyGrowthRate, req.params.id, req.householdId
      ]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Account not found' });
    res.json(result.rows[0]);
  } catch (error) { next(error); }
});

accountsRouter.delete('/:id', async (req, res, next) => {
  try {
    const result = await pool.query(
      'DELETE FROM accounts WHERE id = $1 AND household_id = $2 RETURNING id',
      [req.params.id, req.householdId]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Account not found' });
    res.json({ ok: true });
  } catch (error) { next(error); }
});

accountsRouter.post('/liabilities', async (req, res, next) => {
  try {
    const value = liabilitySchema.parse(req.body);
    await ensureOwnedLinkedAccount(value.linkedAccountId, req.householdId);
    const normalized = normalizeLiability(value, await currentAgeForHousehold(req.householdId));
    const result = await pool.query(
      `INSERT INTO liabilities
        (household_id, name, institution, liability_type, original_amount,
         current_balance, interest_rate, minimum_payment, monthly_payment,
         payoff_age, linked_account_id, original_term_months, loan_start_date,
         current_term_month, principal_interest_payment, property_tax_payment,
         home_insurance_payment, pmi_payment, hoa_payment, other_escrow_payment,
         last_verified_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,now())
       RETURNING *`,
      [
        req.householdId, value.name, value.institution || null, value.liabilityType,
        value.originalAmount ?? null, value.currentBalance, value.interestRate ?? null,
        normalized.monthlyPayment, normalized.monthlyPayment, normalized.payoffAge,
        value.linkedAccountId || null, value.originalTermMonths ?? null,
        value.loanStartDate || null, normalized.currentTermMonth,
        value.principalInterestPayment ?? null, value.propertyTaxPayment ?? null,
        value.homeInsurancePayment ?? null, value.pmiPayment ?? null,
        value.hoaPayment ?? null, value.otherEscrowPayment ?? null
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) { next(error); }
});

accountsRouter.put('/liabilities/:id', async (req, res, next) => {
  try {
    const value = liabilitySchema.parse(req.body);
    await ensureOwnedLinkedAccount(value.linkedAccountId, req.householdId);
    const normalized = normalizeLiability(value, await currentAgeForHousehold(req.householdId));
    const result = await pool.query(
      `UPDATE liabilities
       SET name = $1,
           institution = $2,
           liability_type = $3,
           original_amount = $4,
           current_balance = $5,
           interest_rate = $6,
           minimum_payment = $7,
           monthly_payment = $8,
           payoff_age = $9,
           linked_account_id = $10,
           original_term_months = $11,
           loan_start_date = $12,
           current_term_month = $13,
           principal_interest_payment = $14,
           property_tax_payment = $15,
           home_insurance_payment = $16,
           pmi_payment = $17,
           hoa_payment = $18,
           other_escrow_payment = $19,
           last_verified_at = now(),
           updated_at = now()
       WHERE id = $20 AND household_id = $21
       RETURNING *`,
      [
        value.name, value.institution || null, value.liabilityType,
        value.originalAmount ?? null, value.currentBalance, value.interestRate ?? null,
        normalized.monthlyPayment, normalized.monthlyPayment, normalized.payoffAge,
        value.linkedAccountId || null, value.originalTermMonths ?? null,
        value.loanStartDate || null, normalized.currentTermMonth,
        value.principalInterestPayment ?? null, value.propertyTaxPayment ?? null,
        value.homeInsurancePayment ?? null, value.pmiPayment ?? null,
        value.hoaPayment ?? null, value.otherEscrowPayment ?? null,
        req.params.id, req.householdId
      ]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Liability not found' });
    res.json(result.rows[0]);
  } catch (error) { next(error); }
});

accountsRouter.delete('/liabilities/:id', async (req, res, next) => {
  try {
    const result = await pool.query(
      'DELETE FROM liabilities WHERE id = $1 AND household_id = $2 RETURNING id',
      [req.params.id, req.householdId]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Liability not found' });
    res.json({ ok: true });
  } catch (error) { next(error); }
});

accountsRouter.get('/holdings', async (req, res, next) => {
  try {
    const result = await pool.query(`
      SELECT h.*, a.name AS account_name, a.account_type,
             (h.quantity * COALESCE(h.current_price, 0))::float8 AS current_value
      FROM holdings h JOIN accounts a ON a.id = h.account_id
      WHERE a.household_id = $1
      ORDER BY current_value DESC`, [req.householdId]);
    res.json(result.rows);
  } catch (error) { next(error); }
});

accountsRouter.get('/:id/portfolio', async (req, res, next) => {
  try {
    const account = await ensureOwnedAccount(req.params.id, req.householdId, investmentAccountTypes);
    const [holdings, forecast] = await Promise.all([
      pool.query(`
        SELECT id, account_id, symbol, name, asset_class,
               quantity::float8 AS quantity,
               cost_basis_per_share::float8 AS cost_basis_per_share,
               current_price::float8 AS current_price,
               (quantity * COALESCE(current_price, 0))::float8 AS current_value,
               price_as_of, updated_at
        FROM holdings WHERE account_id = $1 ORDER BY current_value DESC`, [account.id]),
      pool.query(`
        SELECT id, generated_at, horizon_years, simulation_count,
               starting_value::float8 AS starting_value,
               annual_linked_cash_flow::float8 AS annual_linked_cash_flow,
               linked_cash_flow_timeline,
               expected_return::float8 AS expected_return,
               volatility::float8 AS volatility,
               source, timeline, assumptions, data_gaps
        FROM account_forecasts
        WHERE account_id = $1 AND household_id = $2
        ORDER BY generated_at DESC LIMIT 1`, [account.id, req.householdId])
    ]);
    res.json({ account, holdings: holdings.rows, forecast: forecast.rows[0] || null });
  } catch (error) { next(error); }
});

accountsRouter.post('/:id/holdings', async (req, res, next) => {
  try {
    const account = await ensureOwnedAccount(req.params.id, req.householdId, investmentAccountTypes);
    const value = holdingSchema.parse(req.body);
    let currentPrice = value.currentPrice ?? null;
    let priceAsOf = null;
    if (currentPrice == null) {
      try {
        const quote = await getQuote(value.symbol);
        currentPrice = quote.price;
        priceAsOf = quote.asOf || null;
      } catch {
        currentPrice = null;
      }
    }
    const result = await withTransaction(async (client) => {
      const holding = await client.query(`
        INSERT INTO holdings
          (account_id, symbol, name, asset_class, quantity,
           cost_basis_per_share, current_price, price_as_of)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT (account_id, symbol) DO UPDATE SET
          name = EXCLUDED.name,
          asset_class = EXCLUDED.asset_class,
          quantity = EXCLUDED.quantity,
          cost_basis_per_share = EXCLUDED.cost_basis_per_share,
          current_price = COALESCE(EXCLUDED.current_price, holdings.current_price),
          price_as_of = COALESCE(EXCLUDED.price_as_of, holdings.price_as_of),
          updated_at = now()
        RETURNING *`, [
        account.id, value.symbol, value.name || value.symbol, value.assetClass,
        value.quantity, value.costBasisPerShare ?? null, currentPrice, priceAsOf
      ]);
      const accountBalance = await refreshAccountBalance(client, account.id);
      return { holding: holding.rows[0], accountBalance };
    });
    res.status(201).json(result);
  } catch (error) { next(error); }
});

accountsRouter.put('/:id/holdings/:holdingId', async (req, res, next) => {
  try {
    const account = await ensureOwnedAccount(req.params.id, req.householdId, investmentAccountTypes);
    const value = holdingSchema.parse(req.body);
    const result = await withTransaction(async (client) => {
      const holding = await client.query(`
        UPDATE holdings
        SET symbol=$1, name=$2, asset_class=$3, quantity=$4,
            cost_basis_per_share=$5, current_price=$6,
            price_as_of=CASE WHEN $6::numeric IS NULL THEN price_as_of ELSE now() END,
            updated_at=now()
        WHERE id=$7 AND account_id=$8
        RETURNING *`, [
        value.symbol, value.name || value.symbol, value.assetClass,
        value.quantity, value.costBasisPerShare ?? null,
        value.currentPrice ?? null, req.params.holdingId, account.id
      ]);
      if (!holding.rowCount) return null;
      const accountBalance = await refreshAccountBalance(client, account.id);
      return { holding: holding.rows[0], accountBalance };
    });
    if (!result) return res.status(404).json({ error: 'Holding not found' });
    res.json(result);
  } catch (error) { next(error); }
});

accountsRouter.delete('/:id/holdings/:holdingId', async (req, res, next) => {
  try {
    const account = await ensureOwnedAccount(req.params.id, req.householdId, investmentAccountTypes);
    const result = await withTransaction(async (client) => {
      const deleted = await client.query(
        'DELETE FROM holdings WHERE id=$1 AND account_id=$2 RETURNING id',
        [req.params.holdingId, account.id]
      );
      if (!deleted.rowCount) return null;
      const accountBalance = await refreshAccountBalance(client, account.id);
      return { ok: true, accountBalance };
    });
    if (!result) return res.status(404).json({ error: 'Holding not found' });
    res.json(result);
  } catch (error) { next(error); }
});

accountsRouter.post('/:id/forecast', async (req, res, next) => {
  try {
    const account = await ensureOwnedAccount(req.params.id, req.householdId, investmentAccountTypes);
    const [holdingsResult, planResult, incomeResult, expenseResult, contributionResult] = await Promise.all([
      pool.query(`
        SELECT id, symbol, name, asset_class,
               quantity::float8 AS quantity,
               current_price::float8 AS current_price,
               price_as_of
        FROM holdings WHERE account_id=$1 ORDER BY quantity * COALESCE(current_price,0) DESC`, [account.id]),
      pool.query('SELECT current_age, retirement_age, effective_tax_rate FROM retirement_plans WHERE household_id=$1', [req.householdId]),
      pool.query(`SELECT * FROM income_streams
                  WHERE household_id=$1 AND deposit_account_id=$2`, [req.householdId, account.id]),
      pool.query(`SELECT * FROM expenses
                  WHERE household_id=$1 AND payment_account_id=$2`, [req.householdId, account.id]),
      pool.query(`
        SELECT id, contribution_type, source_account_id, target_account_id,
               amount::float8 AS amount, frequency, start_date, end_date,
               annual_increase_rate::float8 AS annual_increase_rate
        FROM account_contribution_schedules
        WHERE household_id=$1 AND (target_account_id=$2 OR source_account_id=$2)`,
      [req.householdId, account.id])
    ]);
    if (!holdingsResult.rowCount && ['brokerage', 'ira'].includes(account.account_type)
        && account.projection_method === 'holdings_monte_carlo') {
      return res.status(400).json({ error: 'Add at least one stock or ETF before calculating this holdings-based account forecast' });
    }

    const plan = planResult.rows[0] || {};
    const taxRate = Number(plan.effective_tax_rate ?? 0.15);
    const currentAge = Number(plan.current_age ?? 45);
    const retirementAge = Number(plan.retirement_age ?? 65);
    const horizonYears = Math.min(60, Math.max(1, Math.floor(Number(req.body?.horizonYears || 30))));
    const annualLinkedCashFlows = Array.from({ length: horizonYears }, (_, index) => {
      const age = currentAge + index;
      const afterTaxIncome = incomeResult.rows.reduce((sum, row) => {
        const value = incomeAtAge(row, age, currentAge, retirementAge);
        return sum + value.nonTaxable + value.taxable * (1 - taxRate);
      }, 0);
      const expenses = expenseResult.rows.reduce(
        (sum, row) => sum + expenseAtAge(row, age, currentAge, retirementAge),
        0
      );
      const year = new Date().getUTCFullYear() + index;
      const scheduledContributions = contributionResult.rows.reduce(
        (sum, row) => sum + linkedContributionForAccount(
          row,
          account.id,
          year,
          new Date().getUTCFullYear()
        ),
        0
      );
      return afterTaxIncome - expenses + scheduledContributions;
    });
    const annualLinkedCashFlow = annualLinkedCashFlows[0] || 0;
    const fallback = {
      expectedReturn: Number(account.expected_return ?? 0.07),
      volatility: Number(account.expected_volatility ?? 0.17)
    };
    const research = holdingsResult.rowCount
      ? await researchHoldingsForForecast(holdingsResult.rows, fallback, { maxSymbols: 12 })
      : {
          positions: [],
          moments: {
            expectedReturn: fallback.expectedReturn,
            volatility: fallback.volatility,
            historicalReturn: null,
            historicalVolatility: null,
            observationCount: 0,
            source: 'Account investment-profile forecast'
          },
          dataGaps: []
        };
    const startingValue = research.positions.reduce((sum, position) => sum + Number(position.value || 0), 0)
      || Number(account.current_balance || 0);
    const forecast = simulateAccountForecast({
      startingValue,
      annualLinkedCashFlow,
      annualLinkedCashFlows,
      expectedReturn: research.moments.expectedReturn,
      volatility: research.moments.volatility,
      horizonYears,
      simulationCount: Number(req.body?.simulationCount || 1000),
      seed: 20260712
    });
    const forecastMethod = holdingsResult.rowCount ? 'holdings_monte_carlo' : 'profile';
    const assumptions = [
      holdingsResult.rowCount
        ? 'Forecast uses saved quantities and the latest available one-year market history for up to 12 holdings.'
        : 'Forecast uses the account saved expected return and volatility because no individual holdings are required for this fund-based account.',
      holdingsResult.rowCount
        ? 'Historical return is shrunk toward the account planning assumption to reduce one-year sample noise.'
        : 'The saved fund or allocation assumption is a planning input, not a prediction.',
      'Linked income, expenses, and contribution schedules follow their saved dates, retirement, tax, and inflation settings in this account-only forecast.',
      'Transfers from another owned account reduce the source account and increase this account without increasing household net worth. External and employer contributions are new inflows.',
      'Taxes, trading, fees, and future allocation changes are excluded. This is a planning simulation, not a prediction.'
    ];

    const saved = await withTransaction(async (client) => {
      for (const position of research.positions) {
        if (!(position.currentPrice > 0)) continue;
        await client.query(`
          UPDATE holdings
          SET current_price=$1, price_as_of=COALESCE($2::date, CURRENT_DATE), updated_at=now()
          WHERE account_id=$3 AND symbol=$4`, [
          position.currentPrice, position.asOf, account.id, position.symbol
        ]);
      }
      await client.query(`
        UPDATE accounts
        SET current_balance=$1,
            projection_method=$2,
            forecast_expected_return=$3,
            forecast_volatility=$4,
            forecast_as_of=now(),
            forecast_source=$5,
            last_verified_at=now(), updated_at=now()
        WHERE id=$6 AND household_id=$7`, [
        startingValue, forecastMethod, forecast.expectedReturn, forecast.volatility,
        research.moments.source, account.id, req.householdId
      ]);
      const result = await client.query(`
        INSERT INTO account_forecasts
          (household_id, account_id, horizon_years, simulation_count,
           starting_value, annual_linked_cash_flow, linked_cash_flow_timeline,
           expected_return, volatility, source, timeline, assumptions, data_gaps)
        VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11::jsonb,$12::jsonb,$13::jsonb)
        RETURNING *`, [
        req.householdId, account.id, forecast.horizonYears,
        forecast.simulationCount, startingValue, annualLinkedCashFlow,
        JSON.stringify(forecast.linkedCashFlowTimeline),
        forecast.expectedReturn, forecast.volatility, research.moments.source,
        JSON.stringify(forecast.timeline), JSON.stringify(assumptions),
        JSON.stringify(research.dataGaps)
      ]);
      return result.rows[0];
    });

    res.json({
      forecast: {
        ...saved,
        expected_return: Number(saved.expected_return),
        volatility: Number(saved.volatility),
        starting_value: Number(saved.starting_value),
        annual_linked_cash_flow: Number(saved.annual_linked_cash_flow)
      },
      positions: research.positions,
      moments: research.moments,
      dataGaps: research.dataGaps
    });
  } catch (error) { next(error); }
});

accountsRouter.post('/holdings/import', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'CSV file is required' });
    const records = parse(req.file.buffer.toString('utf8'), {
      columns: true,
      skip_empty_lines: true,
      trim: true
    });
    if (records.length > 5000) return res.status(400).json({ error: 'CSV is limited to 5,000 holdings' });

    const result = await withTransaction(async (client) => {
      const imported = [];
      const accountIds = new Set();
      for (const row of records) {
        const accountName = row.account_name || row.account || 'Imported Brokerage';
        let account = await client.query(
          'SELECT id FROM accounts WHERE household_id = $1 AND lower(name) = lower($2) LIMIT 1',
          [req.householdId, accountName]
        );
        if (!account.rowCount) {
          account = await client.query(
            `INSERT INTO accounts
              (household_id, name, institution, account_type, current_balance,
               projection_method, investment_style, expected_return, expected_volatility,
               last_verified_at)
             VALUES ($1,$2,$3,$4,0,'holdings_monte_carlo','self_managed',0.07,0.17,now())
             RETURNING id`,
            [req.householdId, accountName, row.institution || null, row.account_type || 'brokerage']
          );
        }
        const accountId = account.rows[0].id;
        accountIds.add(accountId);
        const symbol = String(row.symbol || '').trim().toUpperCase();
        if (!symbol) continue;
        const quantity = Number(row.quantity || 0);
        const costBasis = row.cost_basis_per_share === '' ? null : Number(row.cost_basis_per_share || 0);
        const currentPrice = row.current_price === '' ? null : Number(row.current_price || 0);
        const holding = await client.query(`
          INSERT INTO holdings
            (account_id, symbol, name, asset_class, quantity,
             cost_basis_per_share, current_price, price_as_of)
          VALUES ($1,$2,$3,$4,$5,$6,$7,CASE WHEN $7::numeric IS NULL THEN NULL ELSE now() END)
          ON CONFLICT (account_id, symbol) DO UPDATE SET
            name=EXCLUDED.name,
            asset_class=EXCLUDED.asset_class,
            quantity=EXCLUDED.quantity,
            cost_basis_per_share=EXCLUDED.cost_basis_per_share,
            current_price=EXCLUDED.current_price,
            price_as_of=EXCLUDED.price_as_of,
            updated_at=now()
          RETURNING *`, [
          accountId, symbol, row.name || symbol, row.asset_class || 'equity',
          quantity, Number.isFinite(costBasis) ? costBasis : null,
          Number.isFinite(currentPrice) ? currentPrice : null
        ]);
        imported.push(holding.rows[0]);
      }

      for (const accountId of accountIds) await refreshAccountBalance(client, accountId);
      return imported;
    });

    res.json({ imported: result.length, holdings: result });
  } catch (error) { next(error); }
});
