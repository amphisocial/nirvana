-- =====================================================================
-- Nirvana 1.0.0 — Agentic Trading Desk & AI Inbox
-- Premium, admin-gated feature: an agentic workflow that reviews a
-- household's holdings and candidate ideas, then produces buy / sell /
-- hold / new-idea recommendations that a human reviews inside an AI Inbox.
--
-- Every table is household-scoped and idempotent so `npm run migrate`
-- can be re-run safely on the server.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Per-household feature settings (the on/off switch + guardrails)
--    Admin (household owner) toggles `enabled`. Defaults to OFF so the
--    premium feature never runs until it is explicitly turned on.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS trading_desk_settings (
  household_id UUID PRIMARY KEY REFERENCES households(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT false,
  risk_profile TEXT NOT NULL DEFAULT 'balanced'
    CHECK (risk_profile IN ('conservative', 'balanced', 'aggressive')),
  max_position_pct NUMERIC(5,2) NOT NULL DEFAULT 10.00,   -- max % of portfolio per name
  max_new_ideas INTEGER NOT NULL DEFAULT 3,               -- fresh ideas surfaced per run
  auto_run_enabled BOOLEAN NOT NULL DEFAULT false,        -- include in nightly scheduler
  cash_reserve_pct NUMERIC(5,2) NOT NULL DEFAULT 5.00,    -- keep this % in cash
  notes TEXT,
  enabled_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  enabled_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------
-- 2. Watchlist — symbols the user wants the agent to evaluate as
--    *candidate additions* to the portfolio (not yet owned).
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS trading_watchlist_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  name TEXT,
  thesis TEXT,                        -- optional user note on why they're watching it
  added_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (household_id, symbol)
);
CREATE INDEX IF NOT EXISTS idx_trading_watchlist_household
  ON trading_watchlist_items (household_id, created_at DESC);

-- ---------------------------------------------------------------------
-- 3. Agent runs — one row per execution of the workflow. Captures the
--    full staged pipeline output (scan → signals → plan → risk → decision)
--    so the UI can show provenance and the inbox can link back.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS trading_agent_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  trigger TEXT NOT NULL DEFAULT 'manual'
    CHECK (trigger IN ('manual', 'scheduled')),
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'completed', 'failed')),
  risk_profile TEXT,
  ai_provider TEXT,
  ai_model TEXT,
  symbols_evaluated INTEGER NOT NULL DEFAULT 0,
  recommendations_created INTEGER NOT NULL DEFAULT 0,
  stages JSONB NOT NULL DEFAULT '[]'::jsonb,     -- staged pipeline log for the UI
  portfolio_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb,
  summary TEXT,
  error_text TEXT,
  started_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_trading_agent_runs_household
  ON trading_agent_runs (household_id, started_at DESC);

-- ---------------------------------------------------------------------
-- 4. Recommendations — the AI Inbox. Each row is one buy / sell / hold /
--    trim / new-idea proposal awaiting human review.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS trading_recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  run_id UUID REFERENCES trading_agent_runs(id) ON DELETE SET NULL,
  symbol TEXT NOT NULL,
  company_name TEXT,
  action TEXT NOT NULL
    CHECK (action IN ('buy', 'sell', 'trim', 'add', 'hold', 'new_idea')),
  origin TEXT NOT NULL DEFAULT 'holding'
    CHECK (origin IN ('holding', 'watchlist', 'discovery')),
  conviction TEXT NOT NULL DEFAULT 'medium'
    CHECK (conviction IN ('low', 'medium', 'high')),
  confidence_score NUMERIC(4,1),                 -- 0..100
  time_horizon TEXT,                             -- e.g. "3-6 months"
  -- Trade plan (nullable for hold/monitor)
  reference_price NUMERIC(18,6),
  entry_zone_low NUMERIC(18,6),
  entry_zone_high NUMERIC(18,6),
  target_price NUMERIC(18,6),
  stop_price NUMERIC(18,6),
  invalidation TEXT,
  rr_ratio NUMERIC(8,2),
  suggested_weight_pct NUMERIC(6,2),             -- suggested portfolio weight
  -- Reasoning payload from each pipeline stage
  thesis TEXT NOT NULL,
  signals JSONB NOT NULL DEFAULT '[]'::jsonb,
  risk_checks JSONB NOT NULL DEFAULT '[]'::jsonb,
  data_gaps JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- Human review
  review_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (review_status IN ('pending', 'approved', 'watchlisted', 'rejected', 'snoozed')),
  reviewed_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TIMESTAMPTZ,
  review_note TEXT,
  snooze_until TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_trading_reco_household_status
  ON trading_recommendations (household_id, review_status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_trading_reco_run
  ON trading_recommendations (run_id);

-- ---------------------------------------------------------------------
-- 5. Review audit log — every human action on a recommendation, for
--    compliance and so multiple household members see who did what.
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS trading_review_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  recommendation_id UUID NOT NULL REFERENCES trading_recommendations(id) ON DELETE CASCADE,
  action TEXT NOT NULL,               -- approved | watchlisted | rejected | snoozed | reopened
  note TEXT,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_trading_review_events_reco
  ON trading_review_events (recommendation_id, created_at DESC);
