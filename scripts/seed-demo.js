import 'dotenv/config';
import { pool } from '../server/db.js';

const DEMO_USER_ID = '11111111-1111-4111-8111-111111111111';
const DEMO_HOUSEHOLD_ID = '22222222-2222-4222-8222-222222222222';

async function seed() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      INSERT INTO users (id, email, display_name)
      VALUES ($1, 'demo@nirvana.local', 'Nirvana Demo')
      ON CONFLICT (id) DO NOTHING
    `, [DEMO_USER_ID]);
    await client.query(`
      INSERT INTO households (id, owner_user_id, name)
      VALUES ($1, $2, 'Demo Household')
      ON CONFLICT (id) DO NOTHING
    `, [DEMO_HOUSEHOLD_ID, DEMO_USER_ID]);
    await client.query(`
      INSERT INTO household_members (household_id, user_id, role)
      VALUES ($1, $2, 'owner')
      ON CONFLICT DO NOTHING
    `, [DEMO_HOUSEHOLD_ID, DEMO_USER_ID]);

    const accounts = [
      ['33333333-3333-4333-8333-333333333331', 'Emergency Cash', 'Community Bank', 'cash', 42000],
      ['33333333-3333-4333-8333-333333333332', 'Taxable Brokerage', 'Example Brokerage', 'brokerage', 238500],
      ['33333333-3333-4333-8333-333333333333', '401(k)', 'Example Retirement', 'retirement', 312000],
      ['33333333-3333-4333-8333-333333333334', 'Primary Home', null, 'property', 720000]
    ];
    for (const [id, name, institution, type, balance] of accounts) {
      await client.query(`
        INSERT INTO accounts (id, household_id, name, institution, account_type, current_balance, last_verified_at)
        VALUES ($1, $2, $3, $4, $5, $6, now())
        ON CONFLICT (id) DO UPDATE SET current_balance = EXCLUDED.current_balance
      `, [id, DEMO_HOUSEHOLD_ID, name, institution, type, balance]);
    }

    const holdings = [
      ['33333333-3333-4333-8333-333333333332', 'TSLA', 'Tesla', 'equity', 120, 210, 265],
      ['33333333-3333-4333-8333-333333333332', 'NVDA', 'NVIDIA', 'equity', 480, 82, 142],
      ['33333333-3333-4333-8333-333333333332', 'GOOGL', 'Alphabet', 'equity', 350, 135, 188],
      ['33333333-3333-4333-8333-333333333332', 'VTI', 'Vanguard Total Stock Market ETF', 'etf', 180, 235, 290],
      ['33333333-3333-4333-8333-333333333333', 'VTI', 'Vanguard Total Stock Market ETF', 'etf', 760, 210, 290],
      ['33333333-3333-4333-8333-333333333333', 'BND', 'Vanguard Total Bond Market ETF', 'etf', 500, 73, 75]
    ];
    for (const row of holdings) {
      await client.query(`
        INSERT INTO holdings (account_id, symbol, name, asset_class, quantity, cost_basis_per_share, current_price, price_as_of)
        VALUES ($1, $2, $3, $4, $5, $6, $7, now())
        ON CONFLICT (account_id, symbol) DO UPDATE SET
          quantity = EXCLUDED.quantity,
          current_price = EXCLUDED.current_price,
          cost_basis_per_share = EXCLUDED.cost_basis_per_share,
          price_as_of = now()
      `, row);
    }

    await client.query(`
      INSERT INTO liabilities (id, household_id, name, liability_type, current_balance, interest_rate, minimum_payment, last_verified_at)
      VALUES ('44444444-4444-4444-8444-444444444441', $1, 'Home Mortgage', 'mortgage', 361000, 0.04125, 2600, now())
      ON CONFLICT (id) DO UPDATE SET current_balance = EXCLUDED.current_balance
    `, [DEMO_HOUSEHOLD_ID]);

    await client.query(`
      INSERT INTO retirement_plans (household_id, current_age, retirement_age, plan_end_age, annual_contribution, annual_retirement_spending, expected_return, volatility, inflation)
      VALUES ($1, 50, 64, 95, 42000, 110000, 0.065, 0.14, 0.025)
      ON CONFLICT (household_id) DO NOTHING
    `, [DEMO_HOUSEHOLD_ID]);

    const snapshots = [
      ['2026-01-01', 1120000, 374000],
      ['2026-02-01', 1144000, 372000],
      ['2026-03-01', 1135000, 370500],
      ['2026-04-01', 1178000, 368500],
      ['2026-05-01', 1199000, 366000],
      ['2026-06-01', 1240000, 363500],
      ['2026-07-01', 1312500, 361000]
    ];
    for (const [date, assets, liabilities] of snapshots) {
      await client.query(`
        INSERT INTO net_worth_snapshots (household_id, snapshot_date, assets, liabilities, net_worth)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (household_id, snapshot_date) DO NOTHING
      `, [DEMO_HOUSEHOLD_ID, date, assets, liabilities, assets - liabilities]);
    }

    await client.query('COMMIT');
    console.log('Nirvana demo data seeded.');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

seed().catch((error) => {
  console.error(error);
  process.exit(1);
});
