import { pool } from '../db.js';
import { config } from '../config.js';
import { getQuote, getResearch } from './market/index.js';
import { generateAiResponse } from './ai/index.js';
import { calculateNetWorthProjection } from './net-worth-service.js';
import {
  consensusFromRatings,
  compareFinancialSnapshots,
  calculatePortfolioDrift,
  calculateGoalProgress,
  tenYearForecastSlice
} from './financial-intelligence-engine.js';

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nullableNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function safeIsoDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : value;
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((number(value) + Number.EPSILON) * factor) / factor;
}

function dateOnly(value = new Date()) {
  return new Date(value).toISOString().slice(0, 10);
}

function startOfWeek(value = new Date()) {
  const date = new Date(value);
  const day = date.getUTCDay();
  date.setUTCDate(date.getUTCDate() - day);
  return date.toISOString().slice(0, 10);
}

function extractJson(text) {
  const raw = String(text || '').trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : raw;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(candidate.slice(start, end + 1)); }
  catch { return null; }
}

function extractJsonArray(text) {
  const raw = String(text || '').trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : raw;
  const start = candidate.indexOf('[');
  const end = candidate.lastIndexOf(']');
  if (start < 0 || end <= start) return null;
  try { return JSON.parse(candidate.slice(start, end + 1)); }
  catch { return null; }
}

async function upsertAlert(householdId, alert) {
  const result = await pool.query(`
    INSERT INTO portfolio_alerts
      (household_id, dedupe_key, alert_type, severity, title, summary,
       recommendation, action_view, action_tab, status, payload, updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'open',$10,now())
    ON CONFLICT (household_id, dedupe_key) DO UPDATE SET
      alert_type = EXCLUDED.alert_type,
      severity = EXCLUDED.severity,
      title = EXCLUDED.title,
      summary = EXCLUDED.summary,
      recommendation = EXCLUDED.recommendation,
      action_view = EXCLUDED.action_view,
      action_tab = EXCLUDED.action_tab,
      status = 'open',
      payload = EXCLUDED.payload,
      updated_at = now(),
      resolved_at = NULL
    RETURNING *`, [
    householdId,
    alert.dedupeKey,
    alert.alertType,
    alert.severity || 'info',
    alert.title,
    alert.summary,
    alert.recommendation || null,
    alert.actionView || null,
    alert.actionTab || null,
    JSON.stringify(alert.payload || {})
  ]);
  return result.rows[0];
}

async function resolveAlertsNotIn(householdId, alertType, activeKeys = []) {
  await pool.query(`
    UPDATE portfolio_alerts
    SET status = 'resolved', resolved_at = now(), updated_at = now()
    WHERE household_id = $1 AND alert_type = $2 AND status = 'open'
      AND NOT (dedupe_key = ANY($3::text[]))`, [householdId, alertType, activeKeys]);
}

export async function claimAgentRun(householdId, runType, periodKey) {
  const result = await pool.query(`
    INSERT INTO agent_runs (household_id, run_type, period_key, status)
    VALUES ($1,$2,$3,'running')
    ON CONFLICT (household_id, run_type, period_key) DO UPDATE SET
      status='running', payload=NULL, error_text=NULL,
      started_at=now(), finished_at=NULL
    WHERE agent_runs.status='failed'
       OR (agent_runs.status='running' AND agent_runs.started_at < now() - interval '6 hours')
    RETURNING *`, [householdId, runType, periodKey]);
  return result.rows[0] || null;
}

async function finishAgentRun(runId, status, payload = null, error = null) {
  await pool.query(`
    UPDATE agent_runs SET status=$2, payload=$3, error_text=$4, finished_at=now()
    WHERE id=$1`, [runId, status, payload ? JSON.stringify(payload) : null, error ? String(error.message || error) : null]);
}

export async function captureFinancialState(householdId, snapshotDate = dateOnly()) {
  const [accountsResult, liabilitiesResult] = await Promise.all([
    pool.query(`
      SELECT id, name, account_type AS type, current_balance::float8 AS balance
      FROM accounts WHERE household_id=$1 ORDER BY current_balance DESC`, [householdId]),
    pool.query(`
      SELECT id, name, liability_type AS type, current_balance::float8 AS balance
      FROM liabilities WHERE household_id=$1 ORDER BY current_balance DESC`, [householdId])
  ]);
  const assets = accountsResult.rows.reduce((sum, row) => sum + number(row.balance), 0);
  const liabilities = liabilitiesResult.rows.reduce((sum, row) => sum + number(row.balance), 0);
  const netWorth = assets - liabilities;

  const result = await pool.query(`
    INSERT INTO financial_state_snapshots
      (household_id, snapshot_date, assets, liabilities, net_worth,
       account_breakdown, liability_breakdown)
    VALUES ($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT (household_id, snapshot_date) DO UPDATE SET
      assets=EXCLUDED.assets,
      liabilities=EXCLUDED.liabilities,
      net_worth=EXCLUDED.net_worth,
      account_breakdown=EXCLUDED.account_breakdown,
      liability_breakdown=EXCLUDED.liability_breakdown
    RETURNING *`, [
    householdId, snapshotDate, assets, liabilities, netWorth,
    JSON.stringify(accountsResult.rows), JSON.stringify(liabilitiesResult.rows)
  ]);

  await pool.query(`
    INSERT INTO net_worth_snapshots (household_id, snapshot_date, assets, liabilities, net_worth)
    VALUES ($1,$2,$3,$4,$5)
    ON CONFLICT (household_id, snapshot_date) DO UPDATE SET
      assets=EXCLUDED.assets, liabilities=EXCLUDED.liabilities, net_worth=EXCLUDED.net_worth`,
  [householdId, snapshotDate, assets, liabilities, netWorth]);

  return result.rows[0];
}

export async function buildWeeklyChange(householdId) {
  const result = await pool.query(`
    SELECT * FROM financial_state_snapshots
    WHERE household_id=$1
    ORDER BY snapshot_date DESC
    LIMIT 15`, [householdId]);
  const current = result.rows[0] || await captureFinancialState(householdId);
  const currentDate = new Date(`${current.snapshot_date}T00:00:00Z`);
  const target = new Date(currentDate);
  target.setUTCDate(target.getUTCDate() - 7);
  const prior = result.rows.find((row) => new Date(`${row.snapshot_date}T00:00:00Z`) <= target)
    || result.rows.at(-1)
    || null;
  return compareFinancialSnapshots(current, prior === current ? null : prior);
}

export async function refreshStaleHoldingPrices(householdId, options = {}) {
  const maxSymbols = Math.max(1, Math.min(250, number(options.maxSymbols, config.agent.maxSymbolsPerRun)));
  const staleDays = Math.max(1, number(options.staleDays, 7));
  const result = await pool.query(`
    SELECT upper(h.symbol) AS symbol,
           MAX(h.price_as_of) AS price_as_of,
           MAX(h.current_price)::float8 AS current_price
    FROM holdings h
    JOIN accounts a ON a.id=h.account_id
    WHERE a.household_id=$1
    GROUP BY upper(h.symbol)
    HAVING MAX(h.current_price) IS NULL
        OR MAX(h.current_price) <= 0
        OR MAX(h.price_as_of) IS NULL
        OR MAX(h.price_as_of) < now() - ($2::text || ' days')::interval
    ORDER BY MAX(h.price_as_of) NULLS FIRST
    LIMIT $3`, [householdId, staleDays, maxSymbols]);

  const preValueResult = await pool.query(`
    SELECT a.id, a.current_balance::float8 AS current_balance,
           COALESCE(SUM(h.quantity * COALESCE(h.current_price, h.cost_basis_per_share, 0)), 0)::float8 AS known_value
    FROM accounts a
    JOIN holdings h ON h.account_id=a.id
    WHERE a.household_id=$1
    GROUP BY a.id`, [householdId]);
  const preValues = new Map(preValueResult.rows.map((row) => [row.id, row]));

  const refreshed = [];
  const failures = [];
  for (const row of result.rows) {
    try {
      const quote = await getQuote(row.symbol);
      if (!(number(quote?.price) > 0)) throw new Error('No usable quote');
      await pool.query(`
        UPDATE holdings h
        SET current_price=$3, price_as_of=COALESCE($4::timestamptz, now()), updated_at=now()
        FROM accounts a
        WHERE h.account_id=a.id AND a.household_id=$1 AND upper(h.symbol)=upper($2)`,
      [householdId, row.symbol, quote.price, quote.asOf || null]);
      refreshed.push({ symbol: row.symbol, price: number(quote.price), asOf: quote.asOf || null, source: quote.source || null });
    } catch (error) {
      failures.push({ symbol: row.symbol, error: error.message });
    }
  }

  // Preserve each account's unallocated value while allowing refreshed holding
  // prices to move the reported total by the same market-value delta.
  const adjustedAccounts = [];
  if (refreshed.length) {
    const postValueResult = await pool.query(`
      SELECT a.id,
             COALESCE(SUM(h.quantity * COALESCE(h.current_price, h.cost_basis_per_share, 0)), 0)::float8 AS known_value
      FROM accounts a
      JOIN holdings h ON h.account_id=a.id
      WHERE a.household_id=$1
      GROUP BY a.id`, [householdId]);
    for (const row of postValueResult.rows) {
      const before = preValues.get(row.id);
      if (!before) continue;
      const delta = number(row.known_value) - number(before.known_value);
      if (Math.abs(delta) < 0.005) continue;
      const updated = await pool.query(`
        UPDATE accounts
        SET current_balance=GREATEST(0, current_balance + $3),
            last_verified_at=now(), updated_at=now()
        WHERE id=$1 AND household_id=$2
        RETURNING id, name, current_balance::float8 AS current_balance`,
      [row.id, householdId, delta]);
      if (updated.rowCount) adjustedAccounts.push({ ...updated.rows[0], marketValueDelta: round(delta) });
    }
  }

  return { requested: result.rows.length, refreshed, failures, adjustedAccounts };
}

function fallbackEarningsSummary(symbol, research) {
  if (!research) return `${symbol} research could not be refreshed. Nirvana retained the latest available saved data.`;
  const growth = nullableNumber(research.quarterlyEarningsGrowthYoy);
  const revenue = nullableNumber(research.quarterlyRevenueGrowthYoy);
  const pieces = [];
  if (growth !== null) pieces.push(`quarterly earnings growth was ${(growth * 100).toFixed(1)}% year over year`);
  if (revenue !== null) pieces.push(`quarterly revenue growth was ${(revenue * 100).toFixed(1)}% year over year`);
  return pieces.length
    ? `${research.companyName || symbol}: ${pieces.join(' and ')} based on the latest company overview data.`
    : `${research.companyName || symbol}: earnings commentary was unavailable; valuation and analyst fields use the configured market-data provider.`;
}

async function researchSymbolWithAi(symbol, research) {
  const systemPrompt = `You are Nirvana's earnings research agent. Return JSON only. Use reputable primary company filings, investor-relations releases, and established financial reporting. Do not invent dates, targets, or ratings. Use supplied provider target/rating data when present. When absent, report a street consensus target or rating only when reputable current sources explicitly support it; otherwise return null or Unrated. Describe all consensus data as estimates, not advice.

Schema:
{
  "earningsSummary":"120-220 word factual summary of the latest earnings release, guidance, major drivers and risks",
  "earningsPeriod":"e.g. Q2 FY2026",
  "earningsDate":"YYYY-MM-DD or null",
  "nextEarningsDate":"YYYY-MM-DD or null",
  "analystTargetPrice":123.45,
  "consensusRating":"Strong Buy|Buy|Hold|Sell|Strong Sell|Unrated",
  "ratingCounts":{"strongBuy":0,"buy":0,"hold":0,"sell":0,"strongSell":0},
  "nextExDividendDate":"YYYY-MM-DD or null",
  "nextDividendPayDate":"YYYY-MM-DD or null",
  "dataGaps":["specific missing item"]
}`;
  const result = await generateAiResponse({
    systemPrompt,
    userMessage: `Research the latest reported earnings and upcoming known earnings/dividend dates for ${symbol}.`,
    context: { symbol, providerResearch: research },
    enableWebSearch: true
  });
  return { parsed: extractJson(result.text), sources: result.sources || [] };
}

export async function refreshHoldingResearch(householdId, options = {}) {
  const maxSymbols = Math.max(1, Math.min(250, number(options.maxSymbols, config.agent.maxSymbolsPerRun)));
  const symbolsResult = await pool.query(`
    SELECT upper(h.symbol) AS symbol,
           COALESCE(MAX(h.name), upper(h.symbol)) AS name,
           SUM(h.quantity)::float8 AS quantity,
           SUM(h.quantity * COALESCE(h.current_price, h.cost_basis_per_share, 0))::float8 AS value,
           CASE WHEN SUM(CASE WHEN h.current_price > 0 THEN h.quantity ELSE 0 END) > 0
                THEN (SUM(CASE WHEN h.current_price > 0 THEN h.quantity * h.current_price ELSE 0 END)
                  / SUM(CASE WHEN h.current_price > 0 THEN h.quantity ELSE 0 END))::float8
                ELSE NULL END AS current_price
    FROM holdings h JOIN accounts a ON a.id=h.account_id
    WHERE a.household_id=$1
    GROUP BY upper(h.symbol)
    ORDER BY value DESC
    LIMIT $2`, [householdId, maxSymbols]);

  const completed = [];
  const failures = [];
  for (const position of symbolsResult.rows) {
    const symbol = position.symbol;
    let research = null;
    const symbolGaps = [];
    try { research = await getResearch(symbol); }
    catch (error) { symbolGaps.push(`Market-provider research: ${error.message}`); }

    try {
      let ai = { parsed: null, sources: [] };
      try { ai = await researchSymbolWithAi(symbol, research); }
      catch (error) { ai = { parsed: { dataGaps: [`AI earnings summary: ${error.message}`] }, sources: [] }; }
      const parsed = ai.parsed || {};
      const providerRatings = research?.analystRatings || {};
      const parsedRatings = parsed.ratingCounts && typeof parsed.ratingCounts === 'object'
        ? {
            strongBuy: Math.max(0, number(parsed.ratingCounts.strongBuy ?? parsed.ratingCounts.strong_buy)),
            buy: Math.max(0, number(parsed.ratingCounts.buy)),
            hold: Math.max(0, number(parsed.ratingCounts.hold)),
            sell: Math.max(0, number(parsed.ratingCounts.sell)),
            strongSell: Math.max(0, number(parsed.ratingCounts.strongSell ?? parsed.ratingCounts.strong_sell))
          }
        : {};
      const providerRatingTotal = Object.values(providerRatings).reduce((sum, value) => sum + Math.max(0, number(value)), 0);
      const ratings = providerRatingTotal > 0 ? providerRatings : parsedRatings;
      const allowedConsensus = new Set(['Strong Buy', 'Buy', 'Hold', 'Sell', 'Strong Sell', 'Unrated']);
      const derivedConsensus = consensusFromRatings(ratings);
      const consensus = derivedConsensus !== 'Unrated'
        ? derivedConsensus
        : allowedConsensus.has(parsed.consensusRating) ? parsed.consensusRating : 'Unrated';
      const earningsSummary = typeof parsed.earningsSummary === 'string' && parsed.earningsSummary.trim()
        ? parsed.earningsSummary.trim().slice(0, 6000)
        : fallbackEarningsSummary(symbol, research);
      const parsedGaps = Array.isArray(parsed.dataGaps)
        ? parsed.dataGaps.filter((item) => typeof item === 'string').map((item) => item.slice(0, 500))
        : [];
      const targetAvailable = nullableNumber(research?.analystTargetPrice) !== null || nullableNumber(parsed.analystTargetPrice) !== null;
      const ratingAvailable = consensus !== 'Unrated';
      const dataGaps = [...new Set([
        ...symbolGaps,
        ...parsedGaps,
        ...(!targetAvailable ? ['Street target price unavailable'] : []),
        ...(!ratingAvailable ? ['Street consensus rating unavailable'] : [])
      ])];

      await pool.query(`
        INSERT INTO holding_research_snapshots
          (household_id, symbol, company_name, latest_price, analyst_target_price,
           consensus_rating, rating_counts, earnings_summary, earnings_period,
           earnings_date, next_earnings_date, dividend_per_share, dividend_yield,
           next_ex_dividend_date, next_dividend_pay_date, source_payload,
           data_gaps, researched_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,now())
        ON CONFLICT (household_id, symbol) DO UPDATE SET
          company_name=EXCLUDED.company_name,
          latest_price=EXCLUDED.latest_price,
          analyst_target_price=EXCLUDED.analyst_target_price,
          consensus_rating=EXCLUDED.consensus_rating,
          rating_counts=EXCLUDED.rating_counts,
          earnings_summary=EXCLUDED.earnings_summary,
          earnings_period=EXCLUDED.earnings_period,
          earnings_date=EXCLUDED.earnings_date,
          next_earnings_date=EXCLUDED.next_earnings_date,
          dividend_per_share=EXCLUDED.dividend_per_share,
          dividend_yield=EXCLUDED.dividend_yield,
          next_ex_dividend_date=EXCLUDED.next_ex_dividend_date,
          next_dividend_pay_date=EXCLUDED.next_dividend_pay_date,
          source_payload=EXCLUDED.source_payload,
          data_gaps=EXCLUDED.data_gaps,
          researched_at=now()`, [
        householdId, symbol, research?.companyName || position.name || symbol,
        research?.quote?.price || nullableNumber(position.current_price),
        nullableNumber(research?.analystTargetPrice) ?? nullableNumber(parsed.analystTargetPrice),
        consensus, JSON.stringify(ratings), earningsSummary,
        typeof parsed.earningsPeriod === 'string' ? parsed.earningsPeriod.slice(0, 80) : null,
        safeIsoDate(parsed.earningsDate), safeIsoDate(parsed.nextEarningsDate),
        research?.dividendPerShare || null, research?.dividendYield || null,
        safeIsoDate(parsed.nextExDividendDate), safeIsoDate(parsed.nextDividendPayDate),
        JSON.stringify({ provider: research?.source || null, sources: ai.sources || [] }),
        JSON.stringify(dataGaps)
      ]);
      completed.push(symbol);
    } catch (error) {
      failures.push({ symbol, error: error.message });
    }
  }
  return { completed, failures, requested: symbolsResult.rows.length };
}

export async function generateTenYearForecast(householdId, generatedAt = new Date()) {
  const projection = await calculateNetWorthProjection(householdId);
  const timeline = tenYearForecastSlice(projection, 10);
  const first = timeline[0] || {};
  const last = timeline.at(-1) || {};
  const summary = {
    currentAge: projection?.currentAge || null,
    retirementAge: projection?.retirementAge || null,
    currentNetWorth: number(first.netWorth),
    tenYearNetWorth: number(last.netWorth),
    tenYearChange: round(number(last.netWorth) - number(first.netWorth)),
    endingDebt: number(last.debt),
    endingFundingDeficit: number(last.fundingDeficit)
  };
  const weekStart = startOfWeek(generatedAt);
  await pool.query(`
    INSERT INTO weekly_forecasts (household_id, week_start, horizon_years, forecast, summary, generated_at)
    VALUES ($1,$2,10,$3,$4,now())
    ON CONFLICT (household_id, week_start) DO UPDATE SET
      forecast=EXCLUDED.forecast, summary=EXCLUDED.summary, generated_at=now()`,
  [householdId, weekStart, JSON.stringify({ timeline, assumptions: projection?.assumptions || [] }), JSON.stringify(summary)]);
  return { weekStart, timeline, summary, assumptions: projection?.assumptions || [] };
}

async function householdExposureContext(householdId) {
  const [holdingsResult, accountsResult] = await Promise.all([
    pool.query(`
      SELECT upper(h.symbol) AS symbol,
             SUM(h.quantity * COALESCE(h.current_price, h.cost_basis_per_share, 0))::float8 AS value
      FROM holdings h JOIN accounts a ON a.id=h.account_id
      WHERE a.household_id=$1
      GROUP BY upper(h.symbol) ORDER BY value DESC LIMIT 15`, [householdId]),
    pool.query(`
      SELECT account_type, SUM(current_balance)::float8 AS value
      FROM accounts WHERE household_id=$1 GROUP BY account_type ORDER BY value DESC`, [householdId])
  ]);
  return { topHoldings: holdingsResult.rows, accountMix: accountsResult.rows };
}

function fallbackDeskBriefing(exposure, date) {
  return {
    title: `From Nirvana's Desk — ${date}`,
    dek: 'A market briefing could not be generated with live web research. Portfolio monitoring remains available from saved data.',
    sections: [
      { heading: 'Your portfolio lens', body: `Top tracked exposures: ${(exposure.topHoldings || []).slice(0, 5).map((row) => row.symbol).join(', ') || 'No individual holdings saved'}.` },
      { heading: 'Risk discipline', body: 'Review concentration, liquidity, planned expenses, and portfolio drift before making short-term decisions.' }
    ],
    watchItems: [],
    proactiveRiskActions: ['Keep account values and holdings prices current.', 'Run a what-if before acting on a market headline.'],
    shortTermIdeas: ['Treat short-term opportunities as scenarios with defined downside limits.'],
    longTermIdeas: ['Maintain diversification and align account risk with the date each goal needs funding.']
  };
}

export async function generateDeskBriefing(householdId, briefingDate = dateOnly()) {
  const exposure = await householdExposureContext(householdId);
  const systemPrompt = `You are the editor of "From Nirvana's Desk," an educational nightly financial-markets briefing. Use current reputable sources. Cover major Wall Street movers, macro signals, geopolitical developments affecting markets, risks to watch, proactive risk-reduction actions, short-term scenario ideas, and durable long-term habits. Never promise gains, never give trade-execution instructions, and label all tactical ideas as educational scenarios. Connect the briefing to the household's broad exposures without issuing personalized buy/sell directives. Return JSON only.

Schema:
{
 "title":"From Nirvana's Desk — headline",
 "dek":"one-sentence summary",
 "sections":[{"heading":"...","body":"..."}],
 "watchItems":["..."],
 "proactiveRiskActions":["..."],
 "shortTermIdeas":["..."],
 "longTermIdeas":["..."]
}`;
  let content;
  let sources = [];
  try {
    const result = await generateAiResponse({
      systemPrompt,
      userMessage: `Write the market briefing for ${briefingDate}. Focus on developments from the last several trading sessions and signs relevant to the coming week.`,
      context: exposure,
      enableWebSearch: true
    });
    content = extractJson(result.text) || fallbackDeskBriefing(exposure, briefingDate);
    sources = result.sources || [];
  } catch (error) {
    content = fallbackDeskBriefing(exposure, briefingDate);
    content.dataGap = error.message;
  }
  await pool.query(`
    INSERT INTO financial_briefings
      (household_id, briefing_type, briefing_date, title, dek, content, sources, generated_at)
    VALUES ($1,'desk_daily',$2,$3,$4,$5,$6,now())
    ON CONFLICT (household_id, briefing_type, briefing_date) DO UPDATE SET
      title=EXCLUDED.title, dek=EXCLUDED.dek, content=EXCLUDED.content,
      sources=EXCLUDED.sources, generated_at=now()`, [
    householdId, briefingDate, content.title || `From Nirvana's Desk — ${briefingDate}`,
    content.dek || null, JSON.stringify(content), JSON.stringify(sources)
  ]);
  return { ...content, sources };
}

async function currentHoldingsWeights(householdId) {
  const result = await pool.query(`
    SELECT upper(h.symbol) AS key,
           SUM(h.quantity * COALESCE(h.current_price, h.cost_basis_per_share, 0))::float8 AS value
    FROM holdings h JOIN accounts a ON a.id=h.account_id
    WHERE a.household_id=$1
    GROUP BY upper(h.symbol)`, [householdId]);
  return result.rows;
}

export async function resetPortfolioTargetsToCurrent(householdId) {
  const rows = await currentHoldingsWeights(householdId);
  const total = rows.reduce((sum, row) => sum + number(row.value), 0);
  if (!total) return { saved: 0 };
  await pool.query(`DELETE FROM portfolio_target_allocations WHERE household_id=$1 AND target_scope='symbol'`, [householdId]);
  for (const row of rows) {
    await pool.query(`
      INSERT INTO portfolio_target_allocations
        (household_id, target_scope, target_key, target_percent)
      VALUES ($1,'symbol',$2,$3)`, [householdId, row.key, number(row.value) / total]);
  }
  await resolveAlertsNotIn(householdId, 'portfolio_drift', []);
  return { saved: rows.length };
}

export async function refreshPortfolioDriftAlerts(householdId) {
  const current = await currentHoldingsWeights(householdId);
  const targetResult = await pool.query(`
    SELECT target_key AS key, target_percent::float8 AS target_percent
    FROM portfolio_target_allocations
    WHERE household_id=$1 AND target_scope='symbol'`, [householdId]);
  if (!targetResult.rowCount && current.length) {
    await resetPortfolioTargetsToCurrent(householdId);
    return { seeded: true, alerts: [] };
  }
  const drift = calculatePortfolioDrift(current, targetResult.rows, config.agent.driftThresholdPct);
  const driftKeys = [];
  for (const row of drift) {
    const dedupeKey = `drift:${row.key}`;
    driftKeys.push(dedupeKey);
    await upsertAlert(householdId, {
      dedupeKey,
      alertType: 'portfolio_drift',
      severity: Math.abs(row.driftPct) >= config.agent.driftThresholdPct * 2 ? 'important' : 'watch',
      title: `${row.key} is ${row.driftPct > 0 ? 'above' : 'below'} its target mix`,
      summary: `${row.key} is ${(row.currentPercent * 100).toFixed(1)}% of priced holdings versus a ${(row.targetPercent * 100).toFixed(1)}% reference target, a ${Math.abs(row.driftPct).toFixed(1)} percentage-point drift.`,
      recommendation: 'Open Holdings to review concentration and run a reallocation what-if before changing positions.',
      actionView: 'holdings',
      actionTab: 'insights',
      payload: row
    });
  }
  await resolveAlertsNotIn(householdId, 'portfolio_drift', driftKeys);

  const concentrationKeys = [];
  const total = current.reduce((sum, row) => sum + number(row.value), 0);
  for (const row of current) {
    const weight = total ? number(row.value) / total : 0;
    if (weight < 0.25) continue;
    const dedupeKey = `concentration:${row.key}`;
    concentrationKeys.push(dedupeKey);
    await upsertAlert(householdId, {
      dedupeKey,
      alertType: 'portfolio_concentration',
      severity: weight >= 0.35 ? 'important' : 'watch',
      title: `${row.key} concentration reached ${(weight * 100).toFixed(1)}%`,
      summary: `This position represents ${(weight * 100).toFixed(1)}% of currently priced holdings.`,
      recommendation: 'Review overlapping ETFs and run a sell/reallocation what-if; no trade is executed.',
      actionView: 'holdings', actionTab: 'insights', payload: { ...row, weight }
    });
  }
  await resolveAlertsNotIn(householdId, 'portfolio_concentration', concentrationKeys);
  return { seeded: false, alerts: drift };
}

export async function refreshLargeExpenseAlerts(householdId) {
  const result = await pool.query(`
    SELECT id, name, category, annual_amount::float8 AS annual_amount,
           start_date, end_date
    FROM expenses WHERE household_id=$1`, [householdId]);
  const now = new Date();
  const cutoff = new Date(now);
  cutoff.setUTCDate(cutoff.getUTCDate() + 60);
  const activeKeys = [];
  for (const expense of result.rows) {
    const monthly = number(expense.annual_amount) / 12;
    const start = expense.start_date ? new Date(`${String(expense.start_date).slice(0, 10)}T00:00:00Z`) : null;
    const upcoming = start && start >= now && start <= cutoff;
    if (monthly < config.agent.largeExpenseThreshold && !upcoming) continue;
    const dedupeKey = `large-expense:${expense.id}`;
    activeKeys.push(dedupeKey);
    await upsertAlert(householdId, {
      dedupeKey,
      alertType: 'large_expense',
      severity: monthly >= config.agent.largeExpenseThreshold * 2 ? 'important' : 'watch',
      title: upcoming ? `${expense.name} starts soon` : `${expense.name} is a large planned expense`,
      summary: `${expense.name} is planned at approximately $${monthly.toLocaleString('en-US', { maximumFractionDigits: 0 })} per month${start ? ` beginning ${dateOnly(start)}` : ''}.`,
      recommendation: 'Open Spending Actuals to record the month and compare actual cost with plan.',
      actionView: 'insights', actionTab: 'spending', payload: expense
    });
  }
  await resolveAlertsNotIn(householdId, 'large_expense', activeKeys);
  return { alerts: activeKeys.length };
}

export async function loadGoalsWithProgress(householdId) {
  const [goalsResult, accountsResult] = await Promise.all([
    pool.query(`SELECT * FROM financial_goals WHERE household_id=$1 ORDER BY status, target_date NULLS LAST, priority DESC`, [householdId]),
    pool.query(`SELECT id, name, account_type, current_balance::float8 AS current_balance FROM accounts WHERE household_id=$1`, [householdId])
  ]);
  return goalsResult.rows.map((goal) => ({ ...goal, progress: calculateGoalProgress(goal, accountsResult.rows) }));
}

export async function refreshGoalAlerts(householdId) {
  const goals = await loadGoalsWithProgress(householdId);
  const activeKeys = [];
  for (const goal of goals.filter((row) => row.status === 'active')) {
    const progress = goal.progress;
    const urgent = progress.monthsRemaining != null && progress.monthsRemaining <= 12 && progress.progressPct < 80;
    const overdue = goal.target_date && new Date(`${goal.target_date}T00:00:00Z`) < new Date() && !progress.complete;
    if (!urgent && !overdue) continue;
    const dedupeKey = `goal:${goal.id}`;
    activeKeys.push(dedupeKey);
    await upsertAlert(householdId, {
      dedupeKey,
      alertType: 'goal_progress',
      severity: overdue ? 'important' : 'watch',
      title: overdue ? `${goal.name} is past its target date` : `${goal.name} needs attention`,
      summary: `${goal.name} is ${progress.progressPct.toFixed(1)}% funded with $${progress.remaining.toLocaleString('en-US', { maximumFractionDigits: 0 })} remaining.`,
      recommendation: progress.monthlyNeeded
        ? `Review the goal plan; the straight-line amount needed is about $${progress.monthlyNeeded.toLocaleString('en-US', { maximumFractionDigits: 0 })} per month.`
        : 'Review the target amount, date, and linked accounts.',
      actionView: 'goals', payload: { goalId: goal.id, progress }
    });
  }
  await resolveAlertsNotIn(householdId, 'goal_progress', activeKeys);
  return { alerts: activeKeys.length };
}

async function generateWeeklyPersonalBriefing(householdId, weekStart, context) {
  const systemPrompt = `You are Nirvana's weekly household financial briefing agent. Explain what changed, the ten-year plan direction, open drift or spending alerts, and goal progress. Be concise, factual, and educational. Do not give personalized securities recommendations. Return JSON only.
Schema: {"title":"Weekly financial briefing","summary":"...","wins":["..."],"risks":["..."],"nextActions":["..."]}`;
  let content;
  try {
    const result = await generateAiResponse({
      systemPrompt,
      userMessage: `Prepare the household financial briefing for the week beginning ${weekStart}.`,
      context,
      enableWebSearch: false
    });
    content = extractJson(result.text);
  } catch {}
  content ||= {
    title: 'Weekly financial briefing',
    summary: context.change?.explanation || 'Weekly financial data was refreshed.',
    wins: context.change?.netWorthChange > 0 ? ['Net worth increased in the comparison period.'] : [],
    risks: (context.alerts || []).slice(0, 3).map((row) => row.title),
    nextActions: ['Review open alerts and update any missing actual spending.']
  };
  await pool.query(`
    INSERT INTO financial_briefings
      (household_id, briefing_type, briefing_date, title, dek, content, sources, generated_at)
    VALUES ($1,'weekly_personal',$2,$3,$4,$5,'[]'::jsonb,now())
    ON CONFLICT (household_id, briefing_type, briefing_date) DO UPDATE SET
      title=EXCLUDED.title, dek=EXCLUDED.dek, content=EXCLUDED.content, generated_at=now()`, [
    householdId, weekStart, content.title || 'Weekly financial briefing', content.summary || null, JSON.stringify(content)
  ]);
  return content;
}

export async function runHoldingResearchAgent(householdId, options = {}) {
  const periodKey = options.periodKey || `manual-${new Date().toISOString()}`;
  const run = options.run || await claimAgentRun(householdId, 'holding_research_manual', periodKey);
  if (!run) return { skipped: true, reason: 'already completed or running' };
  try {
    const prices = await refreshStaleHoldingPrices(householdId, { staleDays: 1 });
    await captureFinancialState(householdId);
    const research = await refreshHoldingResearch(householdId);
    const payload = { prices, research };
    await finishAgentRun(run.id, 'completed', payload);
    return payload;
  } catch (error) {
    await finishAgentRun(run.id, 'failed', null, error);
    throw error;
  }
}

export async function runNightlyAgent(householdId, options = {}) {
  const date = options.date || dateOnly();
  const run = options.run || await claimAgentRun(householdId, 'nightly', date);
  if (!run) return { skipped: true, reason: 'already completed or running' };
  try {
    const snapshot = await captureFinancialState(householdId, date);
    const desk = await generateDeskBriefing(householdId, date);
    const expenses = await refreshLargeExpenseAlerts(householdId);
    const goals = await refreshGoalAlerts(householdId);
    const payload = { date, snapshot: { assets: snapshot.assets, liabilities: snapshot.liabilities, netWorth: snapshot.net_worth }, deskTitle: desk.title, expenses, goals };
    await finishAgentRun(run.id, 'completed', payload);
    return payload;
  } catch (error) {
    await finishAgentRun(run.id, 'failed', null, error);
    throw error;
  }
}

export async function runWeeklyAgent(householdId, options = {}) {
  const weekStart = options.weekStart || startOfWeek();
  const periodKey = options.periodKey || weekStart;
  const run = options.run || await claimAgentRun(householdId, 'weekly', periodKey);
  if (!run) return { skipped: true, reason: 'already completed or running' };
  try {
    const prices = await refreshStaleHoldingPrices(householdId);
    await captureFinancialState(householdId);
    const research = await refreshHoldingResearch(householdId);
    const desk = await generateDeskBriefing(householdId, dateOnly());
    const forecast = await generateTenYearForecast(householdId);
    const change = await buildWeeklyChange(householdId);
    const drift = await refreshPortfolioDriftAlerts(householdId);
    const expenses = await refreshLargeExpenseAlerts(householdId);
    const goals = await refreshGoalAlerts(householdId);
    const alertResult = await pool.query(`
      SELECT id, alert_type, severity, title, summary, recommendation, action_view, action_tab, updated_at
      FROM portfolio_alerts WHERE household_id=$1 AND status='open'
      ORDER BY CASE severity WHEN 'important' THEN 0 WHEN 'watch' THEN 1 ELSE 2 END, updated_at DESC
      LIMIT 20`, [householdId]);
    const goalRows = await loadGoalsWithProgress(householdId);
    const weeklyBriefing = await generateWeeklyPersonalBriefing(householdId, weekStart, {
      change, forecast: forecast.summary, alerts: alertResult.rows, goals: goalRows
    });
    const payload = { weekStart, prices, research, deskTitle: desk.title, forecast: forecast.summary, change, drift, expenses, goals, weeklyBriefing };
    await finishAgentRun(run.id, 'completed', payload);
    return payload;
  } catch (error) {
    await finishAgentRun(run.id, 'failed', null, error);
    throw error;
  }
}

export async function startAgentNow(householdId, runType = 'weekly') {
  const key = `manual-${new Date().toISOString()}`;
  const storedType = runType === 'nightly' ? 'nightly_manual' : 'weekly_manual';
  const run = await claimAgentRun(householdId, storedType, key);
  if (!run) return { runId: null, periodKey: key, completion: Promise.resolve({ skipped: true }) };
  const completion = runType === 'nightly'
    ? runNightlyAgent(householdId, { run, date: dateOnly() })
    : runWeeklyAgent(householdId, { run, periodKey: key, weekStart: startOfWeek() });
  return { runId: run.id, periodKey: key, completion };
}

export async function startHoldingResearchNow(householdId) {
  const key = `manual-${new Date().toISOString()}`;
  const run = await claimAgentRun(householdId, 'holding_research_manual', key);
  if (!run) return { runId: null, periodKey: key, completion: Promise.resolve({ skipped: true }) };
  return {
    runId: run.id,
    periodKey: key,
    completion: runHoldingResearchAgent(householdId, { run, periodKey: key })
  };
}
