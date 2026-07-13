ALTER TABLE users ADD COLUMN IF NOT EXISTS active_household_id UUID;

DO $$
BEGIN
  ALTER TABLE users
    ADD CONSTRAINT users_active_household_id_fkey
    FOREIGN KEY (active_household_id) REFERENCES households(id) ON DELETE SET NULL;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS household_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member', 'viewer')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked')),
  invited_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  accepted_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  accepted_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_household_invites_pending_email
  ON household_invites (household_id, lower(email)) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS financial_state_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  snapshot_date DATE NOT NULL,
  assets NUMERIC(18,2) NOT NULL DEFAULT 0,
  liabilities NUMERIC(18,2) NOT NULL DEFAULT 0,
  net_worth NUMERIC(18,2) NOT NULL DEFAULT 0,
  account_breakdown JSONB NOT NULL DEFAULT '[]'::jsonb,
  liability_breakdown JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (household_id, snapshot_date)
);
CREATE INDEX IF NOT EXISTS idx_financial_state_snapshots_household_date
  ON financial_state_snapshots (household_id, snapshot_date DESC);

CREATE TABLE IF NOT EXISTS agent_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  run_type TEXT NOT NULL,
  period_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
  payload JSONB,
  error_text TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  UNIQUE (household_id, run_type, period_key)
);
CREATE INDEX IF NOT EXISTS idx_agent_runs_household_started
  ON agent_runs (household_id, started_at DESC);

CREATE TABLE IF NOT EXISTS weekly_forecasts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  week_start DATE NOT NULL,
  horizon_years INTEGER NOT NULL DEFAULT 10,
  forecast JSONB NOT NULL,
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (household_id, week_start)
);

CREATE TABLE IF NOT EXISTS holding_research_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  company_name TEXT,
  latest_price NUMERIC(18,6),
  analyst_target_price NUMERIC(18,6),
  consensus_rating TEXT,
  rating_counts JSONB NOT NULL DEFAULT '{}'::jsonb,
  earnings_summary TEXT,
  earnings_period TEXT,
  earnings_date DATE,
  next_earnings_date DATE,
  dividend_per_share NUMERIC(18,6),
  dividend_yield NUMERIC(12,8),
  next_ex_dividend_date DATE,
  next_dividend_pay_date DATE,
  source_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  data_gaps JSONB NOT NULL DEFAULT '[]'::jsonb,
  researched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (household_id, symbol)
);
CREATE INDEX IF NOT EXISTS idx_holding_research_household
  ON holding_research_snapshots (household_id, researched_at DESC);

CREATE TABLE IF NOT EXISTS financial_briefings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  briefing_type TEXT NOT NULL CHECK (briefing_type IN ('desk_daily', 'weekly_personal')),
  briefing_date DATE NOT NULL,
  title TEXT NOT NULL,
  dek TEXT,
  content JSONB NOT NULL DEFAULT '{}'::jsonb,
  sources JSONB NOT NULL DEFAULT '[]'::jsonb,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (household_id, briefing_type, briefing_date)
);
CREATE INDEX IF NOT EXISTS idx_financial_briefings_household_date
  ON financial_briefings (household_id, briefing_date DESC);

CREATE TABLE IF NOT EXISTS portfolio_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  dedupe_key TEXT NOT NULL,
  alert_type TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'watch', 'important')),
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  recommendation TEXT,
  action_view TEXT,
  action_tab TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'dismissed', 'resolved')),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ,
  UNIQUE (household_id, dedupe_key)
);
CREATE INDEX IF NOT EXISTS idx_portfolio_alerts_household_status
  ON portfolio_alerts (household_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS expense_actuals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  expense_id UUID REFERENCES expenses(id) ON DELETE SET NULL,
  expense_month DATE NOT NULL,
  actual_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  notes TEXT,
  entered_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (household_id, expense_id, expense_month)
);
CREATE INDEX IF NOT EXISTS idx_expense_actuals_household_month
  ON expense_actuals (household_id, expense_month DESC);

CREATE TABLE IF NOT EXISTS financial_goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  goal_type TEXT NOT NULL DEFAULT 'other',
  target_amount NUMERIC(18,2) NOT NULL,
  target_date DATE,
  manual_current_amount NUMERIC(18,2) NOT NULL DEFAULT 0,
  linked_account_ids UUID[] NOT NULL DEFAULT '{}'::uuid[],
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'paused')),
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_financial_goals_household
  ON financial_goals (household_id, status, target_date);

CREATE TABLE IF NOT EXISTS portfolio_target_allocations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  target_scope TEXT NOT NULL CHECK (target_scope IN ('symbol', 'account_type')),
  target_key TEXT NOT NULL,
  target_percent NUMERIC(9,6) NOT NULL CHECK (target_percent >= 0 AND target_percent <= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (household_id, target_scope, target_key)
);
