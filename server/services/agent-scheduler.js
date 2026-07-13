import { pool } from '../db.js';
import { config } from '../config.js';
import { claimAgentRun, runNightlyAgent, runWeeklyAgent } from './agent-financial-center.js';

const HOUR_MS = 60 * 60 * 1000;
let timer = null;
let ticking = false;

function zonedParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: config.agent.timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', hour12: false, weekday: 'short'
  });
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
  const days = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour) === 24 ? 0 : Number(parts.hour),
    day: days[parts.weekday]
  };
}

function scheduledDateForCurrentWeek(dateKey, currentDay, scheduledDay) {
  const date = new Date(`${dateKey}T12:00:00Z`);
  const daysSinceSchedule = (currentDay - scheduledDay + 7) % 7;
  date.setUTCDate(date.getUTCDate() - daysSinceSchedule);
  return date.toISOString().slice(0, 10);
}

async function runClaimed(householdId, type, periodKey) {
  const run = await claimAgentRun(householdId, type, periodKey);
  if (!run) return;
  if (type === 'nightly') await runNightlyAgent(householdId, { run, date: periodKey });
  else await runWeeklyAgent(householdId, { run, periodKey, weekStart: periodKey });
}

export async function tickAgentScheduler(now = new Date()) {
  if (!config.agent.schedulerEnabled || ticking) return;
  ticking = true;
  try {
    const local = zonedParts(now);
    const nightlyDue = local.hour >= config.agent.nightlyHour;
    const weeklyPeriodKey = scheduledDateForCurrentWeek(local.dateKey, local.day, config.agent.weeklyDay);
    const weeklyDue = local.day !== config.agent.weeklyDay || local.hour >= config.agent.weeklyHour;
    const households = await pool.query('SELECT id FROM households ORDER BY created_at');

    for (const household of households.rows) {
      try {
        // Claims make these catch-up checks idempotent. A restart after the
        // scheduled hour still completes the current day's/week's work.
        if (nightlyDue) await runClaimed(household.id, 'nightly', local.dateKey);
        if (weeklyDue) await runClaimed(household.id, 'weekly', weeklyPeriodKey);
      } catch (error) {
        console.error(`Agent scheduler failed for household ${household.id}:`, error);
      }
    }
  } finally {
    ticking = false;
  }
}

export function startAgentScheduler() {
  if (!config.agent.schedulerEnabled) {
    console.log('Nirvana agent scheduler is disabled.');
    return () => {};
  }
  console.log(`Nirvana agent scheduler enabled for ${config.agent.timezone}; nightly after ${config.agent.nightlyHour}:00, weekly day ${config.agent.weeklyDay} after ${config.agent.weeklyHour}:00.`);
  const initial = setTimeout(() => tickAgentScheduler().catch((error) => console.error('Initial agent tick failed:', error)), 10_000);
  initial.unref();
  timer = setInterval(() => tickAgentScheduler().catch((error) => console.error('Agent tick failed:', error)), HOUR_MS);
  timer.unref();
  return () => {
    clearTimeout(initial);
    if (timer) clearInterval(timer);
    timer = null;
  };
}
