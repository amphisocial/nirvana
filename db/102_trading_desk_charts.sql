-- =====================================================================
-- Nirvana 1.1.0 — Trading Desk: scoped runs + per-symbol charts
--
-- 1. Allow the 'superseded' review status so re-running the agent for a
--    symbol can retire the previous still-pending recommendation instead of
--    leaving duplicates in the inbox.
-- 2. Store a small price-history snapshot on each recommendation so the
--    per-symbol chart can render the exact series the agent evaluated,
--    with entry / target / stop overlays, without a fresh market call.
--
-- Idempotent: safe to re-run.
-- =====================================================================

-- 1. Extend the review_status CHECK constraint to include 'superseded'.
ALTER TABLE trading_recommendations
  DROP CONSTRAINT IF EXISTS trading_recommendations_review_status_check;

ALTER TABLE trading_recommendations
  ADD CONSTRAINT trading_recommendations_review_status_check
  CHECK (review_status IN ('pending', 'approved', 'watchlisted', 'rejected', 'snoozed', 'superseded'));

-- 2. Price-history snapshot for the chart (array of {date, close}). Nullable;
--    when absent the chart endpoint fetches live history on demand.
ALTER TABLE trading_recommendations
  ADD COLUMN IF NOT EXISTS price_history JSONB NOT NULL DEFAULT '[]'::jsonb;

-- 3. Optional analytics snapshot (volatility, drawdown, returns) for the
--    symbol detail view's mini stats.
ALTER TABLE trading_recommendations
  ADD COLUMN IF NOT EXISTS analytics_snapshot JSONB NOT NULL DEFAULT '{}'::jsonb;
