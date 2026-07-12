import { Router } from 'express';
import { pool } from '../db.js';

export const dashboardRouter = Router();

dashboardRouter.get('/summary', async (req, res, next) => {
  try {
    const householdId = req.householdId;
    const [accountsResult, liabilitiesResult, holdingsResult, snapshotsResult, planResult] = await Promise.all([
      pool.query(`
        SELECT id, name, institution, account_type, current_balance::float8 AS current_balance,
               is_manual, last_verified_at
        FROM accounts WHERE household_id = $1 ORDER BY current_balance DESC`, [householdId]),
      pool.query(`
        SELECT id, name, institution, liability_type, current_balance::float8 AS current_balance,
               interest_rate::float8 AS interest_rate, minimum_payment::float8 AS minimum_payment,
               last_verified_at
        FROM liabilities WHERE household_id = $1 ORDER BY current_balance DESC`, [householdId]),
      pool.query(`
        SELECT h.symbol,
               COALESCE(MAX(h.name), h.symbol) AS name,
               COALESCE(MAX(h.asset_class), 'equity') AS asset_class,
               SUM(h.quantity)::float8 AS quantity,
               SUM(h.quantity * COALESCE(h.current_price, 0))::float8 AS current_value,
               CASE WHEN SUM(h.quantity) = 0 THEN 0
                    ELSE SUM(h.quantity * COALESCE(h.current_price, 0)) / SUM(h.quantity) END::float8 AS current_price,
               MAX(h.price_as_of) AS price_as_of
        FROM holdings h
        JOIN accounts a ON a.id = h.account_id
        WHERE a.household_id = $1
        GROUP BY h.symbol
        ORDER BY current_value DESC`, [householdId]),
      pool.query(`
        SELECT snapshot_date, assets::float8 AS assets, liabilities::float8 AS liabilities,
               net_worth::float8 AS net_worth
        FROM net_worth_snapshots
        WHERE household_id = $1
        ORDER BY snapshot_date`, [householdId]),
      pool.query(`SELECT * FROM retirement_plans WHERE household_id = $1`, [householdId])
    ]);

    const accounts = accountsResult.rows;
    const liabilities = liabilitiesResult.rows;
    const holdings = holdingsResult.rows;
    const assetsTotal = accounts.reduce((sum, row) => sum + Number(row.current_balance || 0), 0);
    const liabilitiesTotal = liabilities.reduce((sum, row) => sum + Number(row.current_balance || 0), 0);
    const netWorth = assetsTotal - liabilitiesTotal;
    const liquidPortfolio = accounts
      .filter((row) => ['cash', 'brokerage', 'retirement', 'hsa', '529'].includes(row.account_type))
      .reduce((sum, row) => sum + Number(row.current_balance || 0), 0);

    const allocation = Object.entries(accounts.reduce((map, row) => {
      const label = row.account_type.replace('_', ' ');
      map[label] = (map[label] || 0) + Number(row.current_balance || 0);
      return map;
    }, {})).map(([label, value]) => ({ label, value }));

    const snapshots = snapshotsResult.rows.length ? snapshotsResult.rows : [{
      snapshot_date: new Date().toISOString().slice(0, 10),
      assets: assetsTotal,
      liabilities: liabilitiesTotal,
      net_worth: netWorth
    }];

    res.json({
      metrics: {
        assetsTotal,
        liabilitiesTotal,
        netWorth,
        liquidPortfolio,
        accountCount: accounts.length,
        holdingsCount: holdings.length
      },
      accounts,
      liabilities,
      holdings,
      allocation,
      netWorthHistory: snapshots,
      retirementPlan: planResult.rows[0] || null
    });
  } catch (error) {
    next(error);
  }
});
