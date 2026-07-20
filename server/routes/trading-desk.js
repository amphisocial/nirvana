import { Router } from 'express';
import { z } from 'zod';
import { pool, withTransaction } from '../db.js';
import { config } from '../config.js';
import {
  loadTradingSettings,
  executeTradingRun,
  DEFAULT_TRADING_SETTINGS
} from '../services/trading-desk-service.js';

export const tradingDeskRouter = Router();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const DEFAULT_SETTINGS = DEFAULT_TRADING_SETTINGS;

async function loadSettings(householdId) {
  return loadTradingSettings(householdId);
}

function isAdmin(req) {
  // Household owner is the admin who can toggle the paid feature.
  return req.householdRole === 'owner' || config.demoMode;
}

// Require the feature to be enabled for a household before running/reviewing.
async function requireFeatureEnabled(req, res, next) {
  try {
    const settings = await loadSettings(req.householdId);
    if (!settings.enabled) {
      return res.status(403).json({
        error: 'The Trading Desk agent is turned off for this household.',
        code: 'feature_disabled'
      });
    }
    req.tradingSettings = settings;
    next();
  } catch (error) { next(error); }
}

// ---------------------------------------------------------------------------
// Portfolio assembly lives in trading-desk-service.js (shared with scheduler).
// ---------------------------------------------------------------------------

// ===========================================================================
// SETTINGS  (GET is available to all members; PUT is admin-only)
// ===========================================================================
tradingDeskRouter.get('/settings', async (req, res, next) => {
  try {
    const settings = await loadSettings(req.householdId);
    res.json({
      settings: {
        enabled: settings.enabled,
        riskProfile: settings.risk_profile,
        maxPositionPct: number(settings.max_position_pct, 10),
        maxNewIdeas: settings.max_new_ideas ?? 3,
        autoRunEnabled: settings.auto_run_enabled ?? false,
        cashReservePct: number(settings.cash_reserve_pct, 5),
        notes: settings.notes || null,
        enabledAt: settings.enabled_at || null
      },
      isAdmin: isAdmin(req),
      aiProvider: config.ai.provider,
      aiModel: config.ai.model,
      disclaimer: config.disclaimer
    });
  } catch (error) { next(error); }
});

const settingsSchema = z.object({
  enabled: z.coerce.boolean().optional(),
  riskProfile: z.enum(['conservative', 'balanced', 'aggressive']).optional(),
  maxPositionPct: z.coerce.number().min(1).max(50).optional(),
  maxNewIdeas: z.coerce.number().int().min(0).max(10).optional(),
  autoRunEnabled: z.coerce.boolean().optional(),
  cashReservePct: z.coerce.number().min(0).max(50).optional(),
  notes: z.string().trim().max(500).optional().nullable()
});

tradingDeskRouter.put('/settings', async (req, res, next) => {
  try {
    if (!isAdmin(req)) {
      return res.status(403).json({ error: 'Only the household owner can change Trading Desk settings.' });
    }
    const value = settingsSchema.parse(req.body || {});
    const existing = await loadSettings(req.householdId);
    const merged = {
      enabled: value.enabled ?? existing.enabled,
      risk_profile: value.riskProfile ?? existing.risk_profile,
      max_position_pct: value.maxPositionPct ?? number(existing.max_position_pct, 10),
      max_new_ideas: value.maxNewIdeas ?? existing.max_new_ideas ?? 3,
      auto_run_enabled: value.autoRunEnabled ?? existing.auto_run_enabled ?? false,
      cash_reserve_pct: value.cashReservePct ?? number(existing.cash_reserve_pct, 5),
      notes: value.notes !== undefined ? value.notes : existing.notes || null
    };
    const turningOn = merged.enabled && !existing.enabled;

    const result = await pool.query(
      `INSERT INTO trading_desk_settings
         (household_id, enabled, risk_profile, max_position_pct, max_new_ideas,
          auto_run_enabled, cash_reserve_pct, notes,
          enabled_by_user_id, enabled_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())
       ON CONFLICT (household_id) DO UPDATE SET
         enabled=EXCLUDED.enabled,
         risk_profile=EXCLUDED.risk_profile,
         max_position_pct=EXCLUDED.max_position_pct,
         max_new_ideas=EXCLUDED.max_new_ideas,
         auto_run_enabled=EXCLUDED.auto_run_enabled,
         cash_reserve_pct=EXCLUDED.cash_reserve_pct,
         notes=EXCLUDED.notes,
         enabled_by_user_id=COALESCE(EXCLUDED.enabled_by_user_id, trading_desk_settings.enabled_by_user_id),
         enabled_at=CASE WHEN $2 AND NOT trading_desk_settings.enabled THEN now()
                         WHEN $2 THEN trading_desk_settings.enabled_at ELSE NULL END,
         updated_at=now()
       RETURNING enabled, risk_profile,
                 max_position_pct::float8 AS max_position_pct, max_new_ideas,
                 auto_run_enabled, cash_reserve_pct::float8 AS cash_reserve_pct,
                 notes, enabled_at`,
      [
        req.householdId, merged.enabled, merged.risk_profile, merged.max_position_pct,
        merged.max_new_ideas, merged.auto_run_enabled, merged.cash_reserve_pct, merged.notes,
        req.user?.id || null, turningOn ? new Date() : null
      ]
    );
    const row = result.rows[0];
    res.json({
      settings: {
        enabled: row.enabled,
        riskProfile: row.risk_profile,
        maxPositionPct: number(row.max_position_pct, 10),
        maxNewIdeas: row.max_new_ideas,
        autoRunEnabled: row.auto_run_enabled,
        cashReservePct: number(row.cash_reserve_pct, 5),
        notes: row.notes || null,
        enabledAt: row.enabled_at || null
      }
    });
  } catch (error) { next(error); }
});

// ===========================================================================
// WATCHLIST  (candidate names to evaluate as new additions)
// ===========================================================================
tradingDeskRouter.get('/watchlist', requireFeatureEnabled, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT id, symbol, name, thesis, created_at
       FROM trading_watchlist_items WHERE household_id=$1 ORDER BY created_at DESC`,
      [req.householdId]
    );
    res.json({ items: result.rows });
  } catch (error) { next(error); }
});

const watchlistSchema = z.object({
  symbol: z.string().trim().min(1).max(12).transform((s) => s.toUpperCase()),
  name: z.string().trim().max(120).optional().nullable(),
  thesis: z.string().trim().max(500).optional().nullable()
});

tradingDeskRouter.post('/watchlist', requireFeatureEnabled, async (req, res, next) => {
  try {
    const value = watchlistSchema.parse(req.body || {});
    const result = await pool.query(
      `INSERT INTO trading_watchlist_items (household_id, symbol, name, thesis, added_by_user_id)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (household_id, symbol) DO UPDATE SET
         name=COALESCE(EXCLUDED.name, trading_watchlist_items.name),
         thesis=COALESCE(EXCLUDED.thesis, trading_watchlist_items.thesis)
       RETURNING id, symbol, name, thesis, created_at`,
      [req.householdId, value.symbol, value.name || null, value.thesis || null, req.user?.id || null]
    );
    res.status(201).json({ item: result.rows[0] });
  } catch (error) { next(error); }
});

tradingDeskRouter.delete('/watchlist/:id', requireFeatureEnabled, async (req, res, next) => {
  try {
    const result = await pool.query(
      `DELETE FROM trading_watchlist_items WHERE id=$1 AND household_id=$2 RETURNING id`,
      [req.params.id, req.householdId]
    );
    if (!result.rowCount) return res.status(404).json({ error: 'Watchlist item not found.' });
    res.json({ ok: true });
  } catch (error) { next(error); }
});

// ===========================================================================
// RUN the agentic workflow
// ===========================================================================
const runSchema = z.object({
  maxLiveSymbols: z.coerce.number().int().min(1).max(40).optional().default(24),
  discoveryIdeas: z.array(z.object({
    symbol: z.string().trim().min(1).max(12).transform((s) => s.toUpperCase()),
    name: z.string().trim().max(120).optional().nullable()
  })).max(10).optional().default([])
});

tradingDeskRouter.post('/run', requireFeatureEnabled, async (req, res, next) => {
  try {
    const value = runSchema.parse(req.body || {});
    const settings = req.tradingSettings;

    const result = await executeTradingRun({
      householdId: req.householdId,
      settings,
      trigger: 'manual',
      startedByUserId: req.user?.id || null,
      maxLiveSymbols: value.maxLiveSymbols,
      discoveryIdeas: value.discoveryIdeas
    });

    res.json(result);
  } catch (error) {
    if (error.code === 'empty_universe') {
      return res.status(400).json({ error: error.message, code: 'empty_universe' });
    }
    next(error);
  }
});

// ===========================================================================
// AI INBOX — list recommendations + counts
// ===========================================================================
tradingDeskRouter.get('/inbox', requireFeatureEnabled, async (req, res, next) => {
  try {
    const status = z.enum(['pending', 'approved', 'watchlisted', 'rejected', 'snoozed', 'all'])
      .catch('pending').parse(req.query.status);

    const params = [req.householdId];
    let where = 'household_id=$1';
    if (status !== 'all') { params.push(status); where += ` AND review_status=$${params.length}`; }

    const [rows, counts] = await Promise.all([
      pool.query(
        `SELECT id, run_id, symbol, company_name, action, origin, conviction,
                confidence_score::float8 AS confidence_score, time_horizon,
                reference_price::float8 AS reference_price,
                entry_zone_low::float8 AS entry_zone_low,
                entry_zone_high::float8 AS entry_zone_high,
                target_price::float8 AS target_price,
                stop_price::float8 AS stop_price,
                invalidation, rr_ratio::float8 AS rr_ratio,
                suggested_weight_pct::float8 AS suggested_weight_pct,
                thesis, signals, risk_checks, data_gaps,
                review_status, review_note, reviewed_at, created_at
         FROM trading_recommendations
         WHERE ${where}
         ORDER BY
           CASE review_status WHEN 'pending' THEN 0 ELSE 1 END,
           confidence_score DESC NULLS LAST,
           created_at DESC
         LIMIT 200`,
        params
      ),
      pool.query(
        `SELECT review_status, COUNT(*)::int AS n
         FROM trading_recommendations WHERE household_id=$1 GROUP BY review_status`,
        [req.householdId]
      )
    ]);

    const countMap = { pending: 0, approved: 0, watchlisted: 0, rejected: 0, snoozed: 0 };
    for (const row of counts.rows) countMap[row.review_status] = row.n;

    res.json({ recommendations: rows.rows, counts: countMap });
  } catch (error) { next(error); }
});

// Review action on a single recommendation.
const reviewSchema = z.object({
  action: z.enum(['approve', 'watchlist', 'reject', 'snooze', 'reopen']),
  note: z.string().trim().max(500).optional().nullable(),
  snoozeDays: z.coerce.number().int().min(1).max(90).optional()
});

const STATUS_FOR_ACTION = {
  approve: 'approved',
  watchlist: 'watchlisted',
  reject: 'rejected',
  snooze: 'snoozed',
  reopen: 'pending'
};

tradingDeskRouter.post('/inbox/:id/review', requireFeatureEnabled, async (req, res, next) => {
  try {
    const value = reviewSchema.parse(req.body || {});
    const newStatus = STATUS_FOR_ACTION[value.action];
    const snoozeUntil = value.action === 'snooze'
      ? new Date(Date.now() + (value.snoozeDays ?? 7) * 86400000)
      : null;

    const result = await withTransaction(async (client) => {
      const updated = await client.query(
        `UPDATE trading_recommendations
         SET review_status=$3,
             review_note=COALESCE($4, review_note),
             reviewed_by_user_id=$5,
             reviewed_at=CASE WHEN $3='pending' THEN NULL ELSE now() END,
             snooze_until=$6,
             updated_at=now()
         WHERE id=$1 AND household_id=$2
         RETURNING id, symbol, action, review_status, review_note, reviewed_at`,
        [req.params.id, req.householdId, newStatus, value.note || null, req.user?.id || null, snoozeUntil]
      );
      if (!updated.rowCount) return null;
      await client.query(
        `INSERT INTO trading_review_events (household_id, recommendation_id, action, note, actor_user_id)
         VALUES ($1,$2,$3,$4,$5)`,
        [req.householdId, req.params.id, value.action, value.note || null, req.user?.id || null]
      );
      return updated.rows[0];
    });

    if (!result) return res.status(404).json({ error: 'Recommendation not found.' });
    res.json({ recommendation: result });
  } catch (error) { next(error); }
});

// Bulk review (approve/reject/watchlist several at once).
const bulkSchema = z.object({
  ids: z.array(z.string().uuid()).min(1).max(100),
  action: z.enum(['approve', 'watchlist', 'reject', 'snooze', 'reopen']),
  note: z.string().trim().max(500).optional().nullable()
});

tradingDeskRouter.post('/inbox/bulk-review', requireFeatureEnabled, async (req, res, next) => {
  try {
    const value = bulkSchema.parse(req.body || {});
    const newStatus = STATUS_FOR_ACTION[value.action];
    const updated = await withTransaction(async (client) => {
      const rows = await client.query(
        `UPDATE trading_recommendations
         SET review_status=$3, review_note=COALESCE($4, review_note),
             reviewed_by_user_id=$5,
             reviewed_at=CASE WHEN $3='pending' THEN NULL ELSE now() END,
             updated_at=now()
         WHERE household_id=$2 AND id = ANY($1::uuid[])
         RETURNING id`,
        [value.ids, req.householdId, newStatus, value.note || null, req.user?.id || null]
      );
      for (const row of rows.rows) {
        await client.query(
          `INSERT INTO trading_review_events (household_id, recommendation_id, action, note, actor_user_id)
           VALUES ($1,$2,$3,$4,$5)`,
          [req.householdId, row.id, value.action, value.note || null, req.user?.id || null]
        );
      }
      return rows.rowCount;
    });
    res.json({ updated });
  } catch (error) { next(error); }
});

// ===========================================================================
// RUN HISTORY
// ===========================================================================
tradingDeskRouter.get('/runs', requireFeatureEnabled, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT id, trigger, status, risk_profile, ai_provider, ai_model,
              symbols_evaluated, recommendations_created, stages, summary,
              error_text, started_at, finished_at
       FROM trading_agent_runs WHERE household_id=$1
       ORDER BY started_at DESC LIMIT 20`,
      [req.householdId]
    );
    res.json({ runs: result.rows });
  } catch (error) { next(error); }
});
