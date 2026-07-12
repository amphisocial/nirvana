BEGIN;

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS projection_method TEXT NOT NULL DEFAULT 'profile',
  ADD COLUMN IF NOT EXISTS forecast_expected_return NUMERIC(8,5),
  ADD COLUMN IF NOT EXISTS forecast_volatility NUMERIC(8,5),
  ADD COLUMN IF NOT EXISTS forecast_as_of TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS forecast_source TEXT;

ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_projection_method_check;
ALTER TABLE accounts
  ADD CONSTRAINT accounts_projection_method_check
  CHECK (projection_method IN ('profile', 'holdings_monte_carlo'));

UPDATE accounts
SET projection_method = CASE
  WHEN account_type = 'brokerage' THEN 'holdings_monte_carlo'
  WHEN investment_style = 'self_managed' THEN 'holdings_monte_carlo'
  ELSE 'profile'
END
WHERE projection_method IS NULL OR projection_method = 'profile';

ALTER TABLE liabilities
  ADD COLUMN IF NOT EXISTS original_amount NUMERIC(18,2),
  ADD COLUMN IF NOT EXISTS original_term_months INTEGER,
  ADD COLUMN IF NOT EXISTS loan_start_date DATE,
  ADD COLUMN IF NOT EXISTS current_term_month INTEGER,
  ADD COLUMN IF NOT EXISTS principal_interest_payment NUMERIC(18,2),
  ADD COLUMN IF NOT EXISTS property_tax_payment NUMERIC(18,2),
  ADD COLUMN IF NOT EXISTS home_insurance_payment NUMERIC(18,2),
  ADD COLUMN IF NOT EXISTS pmi_payment NUMERIC(18,2),
  ADD COLUMN IF NOT EXISTS hoa_payment NUMERIC(18,2),
  ADD COLUMN IF NOT EXISTS other_escrow_payment NUMERIC(18,2);

ALTER TABLE liabilities DROP CONSTRAINT IF EXISTS liabilities_original_term_months_check;
ALTER TABLE liabilities
  ADD CONSTRAINT liabilities_original_term_months_check
  CHECK (original_term_months IS NULL OR original_term_months BETWEEN 1 AND 600);

ALTER TABLE liabilities DROP CONSTRAINT IF EXISTS liabilities_current_term_month_check;
ALTER TABLE liabilities
  ADD CONSTRAINT liabilities_current_term_month_check
  CHECK (current_term_month IS NULL OR current_term_month BETWEEN 0 AND 600);

ALTER TABLE income_streams
  ADD COLUMN IF NOT EXISTS deposit_account_id UUID REFERENCES accounts(id) ON DELETE SET NULL;

ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS payment_account_id UUID REFERENCES accounts(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS account_forecasts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  account_id UUID NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  horizon_years INTEGER NOT NULL DEFAULT 30,
  simulation_count INTEGER NOT NULL DEFAULT 1000,
  starting_value NUMERIC(18,2) NOT NULL DEFAULT 0,
  annual_linked_cash_flow NUMERIC(18,2) NOT NULL DEFAULT 0,
  linked_cash_flow_timeline JSONB NOT NULL DEFAULT '[]'::jsonb,
  expected_return NUMERIC(8,5) NOT NULL,
  volatility NUMERIC(8,5) NOT NULL,
  source TEXT NOT NULL,
  timeline JSONB NOT NULL,
  assumptions JSONB NOT NULL DEFAULT '[]'::jsonb,
  data_gaps JSONB NOT NULL DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_account_forecasts_account_generated
  ON account_forecasts(account_id, generated_at DESC);
CREATE INDEX IF NOT EXISTS idx_income_streams_deposit_account
  ON income_streams(deposit_account_id);
CREATE INDEX IF NOT EXISTS idx_expenses_payment_account
  ON expenses(payment_account_id);
CREATE INDEX IF NOT EXISTS idx_liabilities_linked_account
  ON liabilities(linked_account_id);

COMMIT;
