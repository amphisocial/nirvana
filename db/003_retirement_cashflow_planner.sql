BEGIN;

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS is_primary_residence BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS retirement_treatment TEXT NOT NULL DEFAULT 'keep',
  ADD COLUMN IF NOT EXISTS retirement_treatment_age INTEGER,
  ADD COLUMN IF NOT EXISTS retirement_cash_release NUMERIC(18,2),
  ADD COLUMN IF NOT EXISTS property_growth_rate NUMERIC(8,5) NOT NULL DEFAULT 0.03;

ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_retirement_treatment_check;
ALTER TABLE accounts
  ADD CONSTRAINT accounts_retirement_treatment_check
  CHECK (retirement_treatment IN (
    'keep', 'sell_at_retirement', 'sell_at_age', 'downsize',
    'convert_to_rental', 'equity_access', 'undecided'
  ));

ALTER TABLE liabilities
  ADD COLUMN IF NOT EXISTS linked_account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS monthly_payment NUMERIC(18,2),
  ADD COLUMN IF NOT EXISTS payoff_age INTEGER;

ALTER TABLE income_streams
  ADD COLUMN IF NOT EXISTS income_type TEXT NOT NULL DEFAULT 'employment',
  ADD COLUMN IF NOT EXISTS frequency TEXT NOT NULL DEFAULT 'annual',
  ADD COLUMN IF NOT EXISTS start_age INTEGER,
  ADD COLUMN IF NOT EXISTS end_age INTEGER,
  ADD COLUMN IF NOT EXISTS inflation_rate NUMERIC(8,5) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS taxable BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS ends_at_retirement BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE income_streams DROP CONSTRAINT IF EXISTS income_streams_type_check;
ALTER TABLE income_streams
  ADD CONSTRAINT income_streams_type_check
  CHECK (income_type IN (
    'employment', 'social_security', 'pension', 'annuity',
    'rental', 'part_time', 'other'
  ));

ALTER TABLE income_streams DROP CONSTRAINT IF EXISTS income_streams_frequency_check;
ALTER TABLE income_streams
  ADD CONSTRAINT income_streams_frequency_check
  CHECK (frequency IN ('weekly', 'biweekly', 'monthly', 'quarterly', 'annual'));

ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS frequency TEXT NOT NULL DEFAULT 'annual',
  ADD COLUMN IF NOT EXISTS post_retirement_annual_amount NUMERIC(18,2),
  ADD COLUMN IF NOT EXISTS post_retirement_frequency TEXT NOT NULL DEFAULT 'annual',
  ADD COLUMN IF NOT EXISTS retirement_behavior TEXT NOT NULL DEFAULT 'same',
  ADD COLUMN IF NOT EXISTS start_age INTEGER,
  ADD COLUMN IF NOT EXISTS end_age INTEGER,
  ADD COLUMN IF NOT EXISTS inflation_rate NUMERIC(8,5) NOT NULL DEFAULT 0.025,
  ADD COLUMN IF NOT EXISTS essential BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS linked_liability_id UUID REFERENCES liabilities(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();

ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_frequency_check;
ALTER TABLE expenses
  ADD CONSTRAINT expenses_frequency_check
  CHECK (frequency IN ('weekly', 'biweekly', 'monthly', 'quarterly', 'annual'));

ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_post_frequency_check;
ALTER TABLE expenses
  ADD CONSTRAINT expenses_post_frequency_check
  CHECK (post_retirement_frequency IN ('weekly', 'biweekly', 'monthly', 'quarterly', 'annual'));

ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_retirement_behavior_check;
ALTER TABLE expenses
  ADD CONSTRAINT expenses_retirement_behavior_check
  CHECK (retirement_behavior IN ('same', 'ends', 'custom', 'starts'));

ALTER TABLE retirement_plans
  ADD COLUMN IF NOT EXISTS success_threshold NUMERIC(8,5) NOT NULL DEFAULT 0.90,
  ADD COLUMN IF NOT EXISTS max_search_age INTEGER NOT NULL DEFAULT 75,
  ADD COLUMN IF NOT EXISTS effective_tax_rate NUMERIC(8,5) NOT NULL DEFAULT 0.15;

UPDATE income_streams
SET frequency = 'annual',
    start_age = COALESCE(start_age, CASE WHEN start_year BETWEEN 0 AND 120 THEN start_year END),
    end_age = COALESCE(end_age, CASE WHEN end_year BETWEEN 0 AND 120 THEN end_year END),
    inflation_rate = CASE WHEN inflation_adjusted THEN 0.025 ELSE 0 END
WHERE frequency IS NULL OR start_age IS NULL OR end_age IS NULL;

UPDATE expenses
SET frequency = 'annual',
    post_retirement_frequency = 'annual',
    start_age = COALESCE(start_age, CASE WHEN start_year BETWEEN 0 AND 120 THEN start_year END),
    end_age = COALESCE(end_age, CASE WHEN end_year BETWEEN 0 AND 120 THEN end_year END),
    inflation_rate = CASE WHEN inflation_adjusted THEN 0.025 ELSE 0 END
WHERE frequency IS NULL OR post_retirement_frequency IS NULL;

CREATE INDEX IF NOT EXISTS idx_income_streams_household ON income_streams(household_id);
CREATE INDEX IF NOT EXISTS idx_expenses_household ON expenses(household_id);
CREATE INDEX IF NOT EXISTS idx_accounts_primary_residence ON accounts(household_id, is_primary_residence);

COMMIT;
