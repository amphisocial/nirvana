import { annualize } from './retirement-cashflow-engine.js';

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function dateYear(value) {
  if (!value) return null;
  const date = value instanceof Date
    ? value
    : new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(date.getTime()) ? date.getUTCFullYear() : null;
}

export function contributionAtYear(schedule, year, currentYear = new Date().getUTCFullYear()) {
  const startYear = dateYear(schedule.start_date);
  const endYear = dateYear(schedule.end_date);
  if (startYear != null && year < startYear) return 0;
  if (endYear != null && year > endYear) return 0;
  const base = annualize(schedule.amount, schedule.frequency);
  const growthYears = Math.max(0, year - (startYear ?? currentYear));
  return base * ((1 + number(schedule.annual_increase_rate)) ** growthYears);
}

export function scheduleMonthlyAmount(schedule) {
  return annualize(schedule.amount, schedule.frequency) / 12;
}

export function linkedContributionForAccount(schedule, accountId, year, currentYear) {
  const amount = contributionAtYear(schedule, year, currentYear);
  if (!amount) return 0;
  let net = 0;
  if (schedule.target_account_id === accountId) net += amount;
  if (schedule.source_account_id === accountId) net -= amount;
  return net;
}
