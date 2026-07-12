BEGIN;

ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_account_type_check;
ALTER TABLE accounts
  ADD CONSTRAINT accounts_account_type_check
  CHECK (account_type IN (
    'cash', 'brokerage', 'ira', '401k', 'retirement',
    'property', 'hsa', '529', 'other_asset'
  ));

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS investment_style TEXT,
  ADD COLUMN IF NOT EXISTS expected_return NUMERIC(8,5),
  ADD COLUMN IF NOT EXISTS expected_volatility NUMERIC(8,5);

ALTER TABLE accounts DROP CONSTRAINT IF EXISTS accounts_investment_style_check;
ALTER TABLE accounts
  ADD CONSTRAINT accounts_investment_style_check
  CHECK (
    investment_style IS NULL OR investment_style IN (
      'growth', 'balanced', 'conservative', 'self_managed'
    )
  );

UPDATE accounts
SET investment_style = COALESCE(investment_style, 'balanced'),
    expected_return = COALESCE(expected_return, 0.06),
    expected_volatility = COALESCE(expected_volatility, 0.12)
WHERE account_type = 'retirement';

COMMIT;
