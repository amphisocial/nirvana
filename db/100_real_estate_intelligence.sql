BEGIN;

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS property_address TEXT,
  ADD COLUMN IF NOT EXISTS property_zip TEXT,
  ADD COLUMN IF NOT EXISTS property_bedrooms INTEGER,
  ADD COLUMN IF NOT EXISTS property_bathrooms NUMERIC(5,2),
  ADD COLUMN IF NOT EXISTS property_home_type TEXT,
  ADD COLUMN IF NOT EXISTS property_square_feet INTEGER,
  ADD COLUMN IF NOT EXISTS is_rental_property BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS property_growth_source TEXT,
  ADD COLUMN IF NOT EXISTS property_growth_as_of TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS property_growth_confidence NUMERIC(5,4),
  ADD COLUMN IF NOT EXISTS property_market_summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS rental_monthly_income NUMERIC(18,2),
  ADD COLUMN IF NOT EXISTS rental_vacancy_rate NUMERIC(8,5),
  ADD COLUMN IF NOT EXISTS rental_management_rate NUMERIC(8,5),
  ADD COLUMN IF NOT EXISTS rental_annual_property_tax NUMERIC(18,2),
  ADD COLUMN IF NOT EXISTS rental_annual_insurance NUMERIC(18,2),
  ADD COLUMN IF NOT EXISTS rental_monthly_hoa NUMERIC(18,2),
  ADD COLUMN IF NOT EXISTS rental_monthly_maintenance NUMERIC(18,2),
  ADD COLUMN IF NOT EXISTS rental_rent_growth_rate NUMERIC(8,5),
  ADD COLUMN IF NOT EXISTS rental_deposit_account_id UUID REFERENCES accounts(id) ON DELETE SET NULL;

ALTER TABLE income_streams
  ADD COLUMN IF NOT EXISTS linked_property_account_id UUID REFERENCES accounts(id) ON DELETE CASCADE;

ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS linked_property_account_id UUID REFERENCES accounts(id) ON DELETE CASCADE;

CREATE UNIQUE INDEX IF NOT EXISTS idx_rental_income_property
  ON income_streams (household_id, linked_property_account_id)
  WHERE linked_property_account_id IS NOT NULL AND income_type = 'rental';

CREATE UNIQUE INDEX IF NOT EXISTS idx_rental_expense_property
  ON expenses (household_id, linked_property_account_id)
  WHERE linked_property_account_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_accounts_property_zip
  ON accounts (property_zip)
  WHERE account_type = 'property';

COMMIT;
