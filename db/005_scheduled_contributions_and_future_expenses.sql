BEGIN;

ALTER TABLE income_streams
  ADD COLUMN IF NOT EXISTS start_date DATE,
  ADD COLUMN IF NOT EXISTS end_date DATE;

ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS start_date DATE,
  ADD COLUMN IF NOT EXISTS end_date DATE,
  ADD COLUMN IF NOT EXISTS funding_policy TEXT NOT NULL DEFAULT 'linked_then_liquid';

ALTER TABLE expenses DROP CONSTRAINT IF EXISTS expenses_funding_policy_check;
ALTER TABLE expenses
  ADD CONSTRAINT expenses_funding_policy_check
  CHECK (funding_policy IN ('linked_then_liquid', 'linked_only'));

CREATE TABLE IF NOT EXISTS account_contribution_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  contribution_type TEXT NOT NULL DEFAULT 'transfer',
  source_account_id UUID REFERENCES accounts(id) ON DELETE SET NULL,
  target_account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  amount NUMERIC(18,2) NOT NULL CHECK (amount >= 0),
  frequency TEXT NOT NULL DEFAULT 'monthly',
  start_date DATE,
  end_date DATE,
  annual_increase_rate NUMERIC(8,5) NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE account_contribution_schedules
  DROP CONSTRAINT IF EXISTS account_contribution_type_check;
ALTER TABLE account_contribution_schedules
  ADD CONSTRAINT account_contribution_type_check
  CHECK (contribution_type IN ('transfer', 'external', 'employer_match'));

ALTER TABLE account_contribution_schedules
  DROP CONSTRAINT IF EXISTS account_contribution_frequency_check;
ALTER TABLE account_contribution_schedules
  ADD CONSTRAINT account_contribution_frequency_check
  CHECK (frequency IN ('weekly', 'biweekly', 'monthly', 'quarterly', 'annual'));

ALTER TABLE account_contribution_schedules
  DROP CONSTRAINT IF EXISTS account_contribution_accounts_check;
ALTER TABLE account_contribution_schedules
  ADD CONSTRAINT account_contribution_accounts_check
  CHECK (
    source_account_id IS NULL
    OR source_account_id <> target_account_id
  );

CREATE INDEX IF NOT EXISTS idx_account_contributions_household
  ON account_contribution_schedules(household_id);
CREATE INDEX IF NOT EXISTS idx_account_contributions_target
  ON account_contribution_schedules(target_account_id);
CREATE INDEX IF NOT EXISTS idx_account_contributions_source
  ON account_contribution_schedules(source_account_id);
CREATE INDEX IF NOT EXISTS idx_income_streams_dates
  ON income_streams(household_id, start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_expenses_dates
  ON expenses(household_id, start_date, end_date);

COMMIT;
