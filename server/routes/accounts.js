import { Router } from 'express';
import multer from 'multer';
import { parse } from 'csv-parse/sync';
import { z } from 'zod';
import { pool, withTransaction } from '../db.js';

export const accountsRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });

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
  if (retirementAccountTypes.has(value.accountType) && !value.investmentStyle) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['investmentStyle'],
      message: 'Choose an investment style for this retirement account'
    });
  }
  if (value.accountType === 'property' && ['sell_at_age', 'downsize', 'equity_access'].includes(value.retirementTreatment) && value.retirementTreatmentAge == null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['retirementTreatmentAge'],
      message: 'Enter the age for this property scenario'
    });
  }
});

function normalizeInvestmentProfile(value) {
  if (!retirementAccountTypes.has(value.accountType)) {
    return { investmentStyle: null, expectedReturn: null, expectedVolatility: null };
  }
  const defaults = styleDefaults[value.investmentStyle] || styleDefaults.balanced;
  return {
    investmentStyle: value.investmentStyle,
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

const liabilitySchema = z.object({
  name: z.string().min(1).max(120),
  institution: z.string().max(120).optional().nullable(),
  liabilityType: z.enum(['mortgage', 'credit_card', 'student_loan', 'auto_loan', 'personal_loan', 'other']),
  currentBalance: z.coerce.number().min(0),
  interestRate: z.coerce.number().min(0).max(1).optional().nullable(),
  minimumPayment: z.coerce.number().min(0).optional().nullable(),
  monthlyPayment: z.coerce.number().min(0).optional().nullable(),
  payoffAge: z.coerce.number().int().min(18).max(120).optional().nullable(),
  linkedAccountId: z.string().uuid().optional().nullable()
});

accountsRouter.get('/', async (req, res, next) => {
  try {
    const result = await pool.query('SELECT * FROM accounts WHERE household_id = $1 ORDER BY current_balance DESC', [req.householdId]);
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
         investment_style, expected_return, expected_volatility,
         is_primary_residence, retirement_treatment, retirement_treatment_age,
         retirement_cash_release, property_growth_rate, last_verified_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,now())
       RETURNING *`,
      [
        req.householdId, value.name, value.institution || null, value.accountType,
        value.currentBalance, value.currency.toUpperCase(), profile.investmentStyle,
        profile.expectedReturn, profile.expectedVolatility,
        property.isPrimaryResidence, property.retirementTreatment,
        property.retirementTreatmentAge, property.retirementCashRelease,
        property.propertyGrowthRate
      ]
    );
    res.status(201).json(result.rows[0]);
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
           investment_style = $6,
           expected_return = $7,
           expected_volatility = $8,
           is_primary_residence = $9,
           retirement_treatment = $10,
           retirement_treatment_age = $11,
           retirement_cash_release = $12,
           property_growth_rate = $13,
           last_verified_at = now(),
           updated_at = now()
       WHERE id = $14 AND household_id = $15
       RETURNING *`,
      [
        value.name, value.institution || null, value.accountType,
        value.currentBalance, value.currency.toUpperCase(),
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
    const result = await pool.query('DELETE FROM accounts WHERE id = $1 AND household_id = $2 RETURNING id', [req.params.id, req.householdId]);
    if (!result.rowCount) return res.status(404).json({ error: 'Account not found' });
    res.json({ ok: true });
  } catch (error) { next(error); }
});

accountsRouter.post('/liabilities', async (req, res, next) => {
  try {
    const value = liabilitySchema.parse(req.body);
    const result = await pool.query(
      `INSERT INTO liabilities
        (household_id, name, institution, liability_type, current_balance,
         interest_rate, minimum_payment, monthly_payment, payoff_age,
         linked_account_id, last_verified_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now()) RETURNING *`,
      [
        req.householdId, value.name, value.institution || null, value.liabilityType,
        value.currentBalance, value.interestRate ?? null, value.minimumPayment ?? null,
        value.monthlyPayment ?? value.minimumPayment ?? null, value.payoffAge ?? null,
        value.linkedAccountId || null
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) { next(error); }
});

accountsRouter.put('/liabilities/:id', async (req, res, next) => {
  try {
    const value = liabilitySchema.parse(req.body);
    const result = await pool.query(
      `UPDATE liabilities
       SET name = $1,
           institution = $2,
           liability_type = $3,
           current_balance = $4,
           interest_rate = $5,
           minimum_payment = $6,
           monthly_payment = $7,
           payoff_age = $8,
           linked_account_id = $9,
           last_verified_at = now(),
           updated_at = now()
       WHERE id = $10 AND household_id = $11
       RETURNING *`,
      [
        value.name,
        value.institution || null,
        value.liabilityType,
        value.currentBalance,
        value.interestRate ?? null,
        value.minimumPayment ?? null,
        value.monthlyPayment ?? value.minimumPayment ?? null,
        value.payoffAge ?? null,
        value.linkedAccountId || null,
        req.params.id,
        req.householdId
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

accountsRouter.post('/holdings/import', upload.single('file'), async (req, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'CSV file is required' });
    const records = parse(req.file.buffer.toString('utf8'), { columns: true, skip_empty_lines: true, trim: true });
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
            `INSERT INTO accounts (household_id, name, institution, account_type, current_balance, last_verified_at)
             VALUES ($1, $2, $3, $4, 0, now()) RETURNING id`,
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
        const holding = await client.query(
          `INSERT INTO holdings (account_id, symbol, name, asset_class, quantity, cost_basis_per_share, current_price, price_as_of)
           VALUES ($1, $2, $3, $4, $5, $6, $7, CASE WHEN $7::numeric IS NULL THEN NULL ELSE now() END)
           ON CONFLICT (account_id, symbol) DO UPDATE SET
             name = EXCLUDED.name,
             asset_class = EXCLUDED.asset_class,
             quantity = EXCLUDED.quantity,
             cost_basis_per_share = EXCLUDED.cost_basis_per_share,
             current_price = EXCLUDED.current_price,
             price_as_of = EXCLUDED.price_as_of,
             updated_at = now()
           RETURNING *`,
          [accountId, symbol, row.name || symbol, row.asset_class || 'equity', quantity, Number.isFinite(costBasis) ? costBasis : null, Number.isFinite(currentPrice) ? currentPrice : null]
        );
        imported.push(holding.rows[0]);
      }

      for (const accountId of accountIds) {
        await client.query(`
          UPDATE accounts a SET current_balance = totals.value, last_verified_at = now(), updated_at = now()
          FROM (SELECT account_id, SUM(quantity * COALESCE(current_price, 0)) AS value FROM holdings WHERE account_id = $1 GROUP BY account_id) totals
          WHERE a.id = totals.account_id`, [accountId]);
      }
      return imported;
    });

    res.json({ imported: result.length, holdings: result });
  } catch (error) { next(error); }
});
