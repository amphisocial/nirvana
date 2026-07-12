import { Router } from 'express';
import multer from 'multer';
import { parse } from 'csv-parse/sync';
import { z } from 'zod';
import { pool, withTransaction } from '../db.js';

export const accountsRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024 } });

const accountSchema = z.object({
  name: z.string().min(1).max(120),
  institution: z.string().max(120).optional().nullable(),
  accountType: z.enum(['cash', 'brokerage', 'retirement', 'property', 'hsa', '529', 'other_asset']),
  currentBalance: z.coerce.number().min(0),
  currency: z.string().length(3).default('USD')
});

const liabilitySchema = z.object({
  name: z.string().min(1).max(120),
  institution: z.string().max(120).optional().nullable(),
  liabilityType: z.enum(['mortgage', 'credit_card', 'student_loan', 'auto_loan', 'personal_loan', 'other']),
  currentBalance: z.coerce.number().min(0),
  interestRate: z.coerce.number().min(0).max(1).optional().nullable(),
  minimumPayment: z.coerce.number().min(0).optional().nullable()
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
    const result = await pool.query(
      `INSERT INTO accounts (household_id, name, institution, account_type, current_balance, currency, last_verified_at)
       VALUES ($1, $2, $3, $4, $5, $6, now()) RETURNING *`,
      [req.householdId, value.name, value.institution || null, value.accountType, value.currentBalance, value.currency.toUpperCase()]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) { next(error); }
});

accountsRouter.put('/:id', async (req, res, next) => {
  try {
    const value = accountSchema.parse(req.body);
    const result = await pool.query(
      `UPDATE accounts
       SET name = $1,
           institution = $2,
           account_type = $3,
           current_balance = $4,
           currency = $5,
           last_verified_at = now(),
           updated_at = now()
       WHERE id = $6 AND household_id = $7
       RETURNING *`,
      [
        value.name,
        value.institution || null,
        value.accountType,
        value.currentBalance,
        value.currency.toUpperCase(),
        req.params.id,
        req.householdId
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
      `INSERT INTO liabilities (household_id, name, institution, liability_type, current_balance, interest_rate, minimum_payment, last_verified_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, now()) RETURNING *`,
      [req.householdId, value.name, value.institution || null, value.liabilityType, value.currentBalance, value.interestRate || null, value.minimumPayment || null]
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
           last_verified_at = now(),
           updated_at = now()
       WHERE id = $7 AND household_id = $8
       RETURNING *`,
      [
        value.name,
        value.institution || null,
        value.liabilityType,
        value.currentBalance,
        value.interestRate ?? null,
        value.minimumPayment ?? null,
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
