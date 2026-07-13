import { Router } from 'express';
import { z } from 'zod';
import { pool, withTransaction } from '../db.js';
import { getQuote } from '../services/market/index.js';
import { analyzeHoldingsLab } from '../services/holdings-agent-workflow.js';

export const holdingsLabRouter = Router();

const accountTypeSchema = z.enum(['brokerage', 'ira', '401k', 'retirement']);
const overviewSchema = z.object({
  accountTypes: z.array(accountTypeSchema).max(4).optional().default(['brokerage', 'ira', '401k']),
  growthOverrides: z.record(z.string().uuid(), z.coerce.number().min(-0.5).max(1)).optional().default({}),
  prompt: z.string().trim().max(5000).optional().nullable(),
  horizonMonths: z.coerce.number().int().min(12).max(60).optional().default(36),
  maxLiveSymbols: z.coerce.number().int().min(1).max(40).optional().default(24),
  includeNarrative: z.coerce.boolean().optional().default(true)
});

const refreshSchema = z.object({
  accountTypes: z.array(accountTypeSchema).max(4).optional().default(['brokerage', 'ira', '401k']),
  missingOnly: z.coerce.boolean().optional().default(true)
});

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function loadHoldingsLabData(householdId) {
  const [accountsResult, holdingsResult] = await Promise.all([
    pool.query(`
      SELECT id, household_id, name, institution, account_type,
             current_balance::float8 AS current_balance,
             projection_method, investment_style,
             expected_return::float8 AS expected_return,
             expected_volatility::float8 AS expected_volatility,
             forecast_expected_return::float8 AS forecast_expected_return,
             forecast_volatility::float8 AS forecast_volatility,
             forecast_as_of, forecast_source, last_verified_at
      FROM accounts
      WHERE household_id=$1
        AND account_type IN ('brokerage','ira','401k','retirement')
      ORDER BY current_balance DESC`, [householdId]),
    pool.query(`
      SELECT h.id, h.account_id, h.symbol, h.name, h.asset_class,
             h.quantity::float8 AS quantity,
             h.cost_basis_per_share::float8 AS cost_basis_per_share,
             h.current_price::float8 AS current_price,
             h.price_as_of, h.updated_at,
             a.name AS account_name, a.account_type,
             a.current_balance::float8 AS account_total
      FROM holdings h
      JOIN accounts a ON a.id=h.account_id
      WHERE a.household_id=$1
        AND a.account_type IN ('brokerage','ira','401k','retirement')
      ORDER BY a.current_balance DESC,
               h.quantity * COALESCE(h.current_price, h.cost_basis_per_share, 0) DESC`, [householdId])
  ]);
  return { accounts: accountsResult.rows, holdings: holdingsResult.rows };
}

async function mapWithConcurrency(items, concurrency, worker) {
  const results = new Array(items.length);
  let cursor = 0;
  async function run() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, run));
  return results;
}

holdingsLabRouter.get('/context', async (req, res, next) => {
  try {
    const data = await loadHoldingsLabData(req.householdId);
    res.json({
      accounts: data.accounts,
      holdings: data.holdings.map((row) => ({
        ...row,
        current_value: number(row.quantity) * number(row.current_price)
      }))
    });
  } catch (error) { next(error); }
});

holdingsLabRouter.post('/overview', async (req, res, next) => {
  try {
    const value = overviewSchema.parse(req.body || {});
    const data = await loadHoldingsLabData(req.householdId);
    const result = await analyzeHoldingsLab({
      ...data,
      selectedTypes: value.accountTypes,
      growthOverrides: value.growthOverrides,
      prompt: value.prompt || null,
      horizonMonths: value.horizonMonths,
      maxLiveSymbols: value.maxLiveSymbols,
      includeNarrative: value.includeNarrative
    });
    res.json(result);
  } catch (error) { next(error); }
});

holdingsLabRouter.post('/refresh-missing', async (req, res, next) => {
  try {
    const value = refreshSchema.parse(req.body || {});
    const result = await pool.query(`
      SELECT h.id, h.symbol, h.account_id, h.current_price::float8 AS current_price,
             a.account_type, a.name AS account_name
      FROM holdings h
      JOIN accounts a ON a.id=h.account_id
      WHERE a.household_id=$1
        AND a.account_type = ANY($2::text[])
        AND ($3::boolean = false OR h.current_price IS NULL OR h.current_price <= 0)
      ORDER BY h.symbol`, [req.householdId, value.accountTypes, value.missingOnly]);

    const uniqueSymbols = [...new Set(result.rows.map((row) => String(row.symbol || '').toUpperCase()).filter(Boolean))];
    const quoteRows = await mapWithConcurrency(uniqueSymbols, 3, async (symbol) => {
      try {
        const quote = await getQuote(symbol);
        const price = Number(quote?.price);
        if (!(price > 0)) throw new Error('Quote did not contain a positive price');
        return { symbol, ok: true, price, asOf: quote.asOf || null, source: quote.source || null };
      } catch (error) {
        return { symbol, ok: false, error: error.message };
      }
    });

    const successful = quoteRows.filter((row) => row.ok);
    if (successful.length) {
      await withTransaction(async (client) => {
        for (const quote of successful) {
          await client.query(`
            UPDATE holdings h
            SET current_price=$1,
                price_as_of=COALESCE($2::timestamptz, now()),
                updated_at=now()
            FROM accounts a
            WHERE h.account_id=a.id
              AND a.household_id=$3
              AND UPPER(h.symbol)=$4
              AND a.account_type = ANY($5::text[])
              AND ($6::boolean = false OR h.current_price IS NULL OR h.current_price <= 0)`,
          [quote.price, quote.asOf, req.householdId, quote.symbol, value.accountTypes, value.missingOnly]);
        }
        await client.query(`
          UPDATE accounts
          SET last_verified_at=now(), updated_at=now()
          WHERE household_id=$1
            AND account_type = ANY($2::text[])
            AND id IN (SELECT DISTINCT account_id FROM holdings)`,
        [req.householdId, value.accountTypes]);
      });
    }

    res.json({
      requestedSymbols: uniqueSymbols.length,
      refreshedSymbols: successful.length,
      failedSymbols: quoteRows.filter((row) => !row.ok),
      quotes: successful
    });
  } catch (error) { next(error); }
});
