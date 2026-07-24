import { pool } from '../db.js';
import { config } from '../config.js';

function bool(value, fallback = true) {
  return value === null || value === undefined ? fallback : Boolean(value);
}

export function shouldRunScheduledAgent({ globalEnabled, householdEnabled, due }) {
  return Boolean(globalEnabled && householdEnabled && due);
}

export function resolveAgentSchedule(row = {}, options = {}) {
  const global = options.global || {
    schedulerEnabled: config.agent.schedulerEnabled,
    nightlyEnabled: config.agent.nightlyEnabled,
    weeklyEnabled: config.agent.weeklyEnabled
  };
  const household = {
    nightlyEnabled: bool(row.nightly_enabled, true),
    weeklyEnabled: bool(row.weekly_enabled, true),
    updatedAt: row.updated_at || null
  };

  return {
    canEdit: Boolean(options.canEdit),
    household,
    global: {
      schedulerEnabled: Boolean(global.schedulerEnabled),
      nightlyEnabled: Boolean(global.nightlyEnabled),
      weeklyEnabled: Boolean(global.weeklyEnabled),
      timezone: options.timezone || config.agent.timezone,
      nightlyHour: Number(options.nightlyHour ?? config.agent.nightlyHour),
      weeklyDay: Number(options.weeklyDay ?? config.agent.weeklyDay),
      weeklyHour: Number(options.weeklyHour ?? config.agent.weeklyHour)
    },
    effective: {
      nightlyEnabled: Boolean(global.schedulerEnabled && global.nightlyEnabled && household.nightlyEnabled),
      weeklyEnabled: Boolean(global.schedulerEnabled && global.weeklyEnabled && household.weeklyEnabled)
    },
    manualRunsEnabled: true,
    tradingDeskManagedSeparately: true
  };
}

export async function getHouseholdAgentSettings(householdId, options = {}) {
  const result = await pool.query(`
    SELECT nightly_enabled, weekly_enabled, updated_at
    FROM household_agent_settings
    WHERE household_id=$1`, [householdId]);
  return resolveAgentSchedule(result.rows[0] || {}, options);
}

export async function saveHouseholdAgentSettings(householdId, userId, value, options = {}) {
  const result = await pool.query(`
    INSERT INTO household_agent_settings
      (household_id, nightly_enabled, weekly_enabled, updated_by_user_id, updated_at)
    VALUES ($1,$2,$3,$4,now())
    ON CONFLICT (household_id) DO UPDATE SET
      nightly_enabled=EXCLUDED.nightly_enabled,
      weekly_enabled=EXCLUDED.weekly_enabled,
      updated_by_user_id=EXCLUDED.updated_by_user_id,
      updated_at=now()
    RETURNING nightly_enabled, weekly_enabled, updated_at`, [
    householdId,
    Boolean(value.nightlyEnabled),
    Boolean(value.weeklyEnabled),
    userId || null
  ]);
  return resolveAgentSchedule(result.rows[0], options);
}
