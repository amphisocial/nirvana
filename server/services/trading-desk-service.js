import { pool, withTransaction } from '../db.js';
import { config } from '../config.js';
import { runTradingWorkflow } from './trading-desk-engine.js';

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const DEFAULT_TRADING_SETTINGS = {
  enabled: false,
  risk_profile: 'balanced',
  max_position_pct: 10,
  max_new_ideas: 3,
  auto_run_enabled: false,
  cash_reserve_pct: 5,
  notes: null
};

export async function loadTradingSettings(householdId) {
  const result = await pool.query(
    `SELECT household_id, enabled, risk_profile,
            max_position_pct::float8 AS max_position_pct,
            max_new_ideas,
            auto_run_enabled,
            cash_reserve_pct::float8 AS cash_reserve_pct,
            notes, enabled_at
     FROM trading_desk_settings WHERE household_id=$1`,
    [householdId]
  );
  if (!result.rowCount) return { ...DEFAULT_TRADING_SETTINGS, household_id: householdId };
  return result.rows[0];
}

// Build the household portfolio snapshot the engine needs.
export async function loadTradingPortfolio(householdId) {
  const [holdingsResult, accountsResult] = await Promise.all([
    pool.query(
      `SELECT h.symbol, h.name,
              h.quantity::float8 AS quantity,
              h.cost_basis_per_share::float8 AS cost_basis_per_share,
              h.current_price::float8 AS current_price
       FROM holdings h
       JOIN accounts a ON a.id=h.account_id
       WHERE a.household_id=$1
         AND a.account_type IN ('brokerage','ira','401k','retirement')`,
      [householdId]
    ),
    pool.query(
      `SELECT account_type, current_balance::float8 AS current_balance
       FROM accounts WHERE household_id=$1`,
      [householdId]
    )
  ]);

  const bySymbol = {};
  let totalValue = 0;
  const holdings = [];
  for (const row of holdingsResult.rows) {
    const price = number(row.current_price) || number(row.cost_basis_per_share);
    const value = number(row.quantity) * price;
    totalValue += value;
    const cost = number(row.cost_basis_per_share);
    const unrealizedGainPct = cost > 0 && price > 0 ? ((price - cost) / cost) * 100 : null;
    const sym = String(row.symbol).toUpperCase();
    bySymbol[sym] = { value, unrealizedGainPct };
    holdings.push({ symbol: sym, name: row.name, value });
  }

  const cashBalance = accountsResult.rows
    .filter((r) => r.account_type === 'cash')
    .reduce((sum, r) => sum + number(r.current_balance), 0);
  const grossValue = totalValue + cashBalance;
  const cashPct = grossValue > 0 ? (cashBalance / grossValue) * 100 : 0;

  return { holdings, bySymbol, totalValue, cashBalance, cashPct };
}

/**
 * Execute one full Trading Desk run for a household: open the run row, invoke
 * the agentic workflow, persist recommendations, and finalize the run.
 * Shared by the manual /run route and the nightly scheduler.
 *
 * @returns {Promise<{runId, symbolsEvaluated, recommendationsCreated, stages, summary, provider, model}>}
 * @throws if the symbol universe is empty (caller decides how to surface).
 */
export async function executeTradingRun({
  householdId,
  settings,
  trigger = 'manual',
  startedByUserId = null,
  maxLiveSymbols = 24,
  discoveryIdeas = []
}) {
  const [portfolio, watchlistResult] = await Promise.all([
    loadTradingPortfolio(householdId),
    pool.query(`SELECT symbol, name FROM trading_watchlist_items WHERE household_id=$1`, [householdId])
  ]);

  if (!portfolio.holdings.length && !watchlistResult.rowCount && !discoveryIdeas.length) {
    const err = new Error('Add at least one holding or watchlist symbol before running the agent.');
    err.code = 'empty_universe';
    throw err;
  }

  const runRow = await pool.query(
    `INSERT INTO trading_agent_runs
       (household_id, trigger, status, risk_profile, ai_provider, ai_model, started_by_user_id, portfolio_snapshot)
     VALUES ($1,$2,'running',$3,$4,$5,$6,$7) RETURNING id`,
    [
      householdId, trigger, settings.risk_profile, config.ai.provider, config.ai.model,
      startedByUserId,
      JSON.stringify({ totalValue: portfolio.totalValue, cashPct: portfolio.cashPct, positions: portfolio.holdings.length })
    ]
  );
  const runId = runRow.rows[0].id;

  let workflow;
  try {
    workflow = await runTradingWorkflow({
      holdings: portfolio.holdings,
      watchlist: watchlistResult.rows,
      discoveryIdeas,
      portfolio,
      settings: {
        riskProfile: settings.risk_profile,
        maxPositionPct: number(settings.max_position_pct, 10),
        maxNewIdeas: settings.max_new_ideas ?? 3,
        cashReservePct: number(settings.cash_reserve_pct, 5)
      },
      maxLiveSymbols
    });
  } catch (engineError) {
    await pool.query(
      `UPDATE trading_agent_runs SET status='failed', error_text=$2, finished_at=now() WHERE id=$1`,
      [runId, engineError.message]
    );
    throw engineError;
  }

  const summary = `${workflow.recommendations.length} recommendation${workflow.recommendations.length === 1 ? '' : 's'} across ${workflow.symbolsEvaluated} evaluated symbols.`;
  await withTransaction(async (client) => {
    for (const rec of workflow.recommendations) {
      await client.query(
        `INSERT INTO trading_recommendations
           (household_id, run_id, symbol, company_name, action, origin, conviction,
            confidence_score, time_horizon, reference_price, entry_zone_low, entry_zone_high,
            target_price, stop_price, invalidation, rr_ratio, suggested_weight_pct,
            thesis, signals, risk_checks, data_gaps)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`,
        [
          householdId, runId, rec.symbol, rec.companyName, rec.action, rec.origin,
          rec.conviction, rec.confidenceScore, rec.timeHorizon, rec.referencePrice,
          rec.entryZoneLow, rec.entryZoneHigh, rec.targetPrice, rec.stopPrice,
          rec.invalidation, rec.rrRatio, rec.suggestedWeightPct, rec.thesis,
          JSON.stringify(rec.signals), JSON.stringify(rec.riskChecks), JSON.stringify(rec.dataGaps)
        ]
      );
    }
    await client.query(
      `UPDATE trading_agent_runs SET status='completed', symbols_evaluated=$2,
         recommendations_created=$3, stages=$4, summary=$5, finished_at=now() WHERE id=$1`,
      [runId, workflow.symbolsEvaluated, workflow.recommendations.length, JSON.stringify(workflow.stages), summary]
    );
  });

  return {
    runId,
    symbolsEvaluated: workflow.symbolsEvaluated,
    recommendationsCreated: workflow.recommendations.length,
    stages: workflow.stages,
    summary,
    provider: workflow.provider,
    model: workflow.model
  };
}

/**
 * Nightly pass: run the Trading Desk for every household that has the feature
 * enabled AND auto-run turned on. Deduped per household per day via a marker
 * in trading_agent_runs (trigger='scheduled'), so a restart won't double-run.
 */
export async function runScheduledTradingDeskForAll(dateKey) {
  const eligible = await pool.query(
    `SELECT household_id FROM trading_desk_settings
     WHERE enabled = true AND auto_run_enabled = true`
  );
  let completed = 0;
  for (const row of eligible.rows) {
    const householdId = row.household_id;
    try {
      // Skip if a scheduled run already happened today for this household.
      const already = await pool.query(
        `SELECT 1 FROM trading_agent_runs
         WHERE household_id=$1 AND trigger='scheduled'
           AND started_at::date = $2::date LIMIT 1`,
        [householdId, dateKey]
      );
      if (already.rowCount) continue;

      const settings = await loadTradingSettings(householdId);
      if (!settings.enabled || !settings.auto_run_enabled) continue;

      await executeTradingRun({
        householdId,
        settings,
        trigger: 'scheduled',
        startedByUserId: null,
        maxLiveSymbols: config.agent.maxSymbolsPerRun ? Math.min(40, config.agent.maxSymbolsPerRun) : 24
      });
      completed += 1;
    } catch (error) {
      if (error.code === 'empty_universe') continue;
      console.error(`Scheduled Trading Desk run failed for household ${householdId}:`, error.message);
    }
  }
  return { eligible: eligible.rowCount, completed };
}
