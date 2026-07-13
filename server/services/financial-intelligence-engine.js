function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round((number(value) + Number.EPSILON) * factor) / factor;
}

export function consensusFromRatings(ratings = {}) {
  const strongBuy = number(ratings.strongBuy ?? ratings.strong_buy);
  const buy = number(ratings.buy);
  const hold = number(ratings.hold);
  const sell = number(ratings.sell);
  const strongSell = number(ratings.strongSell ?? ratings.strong_sell);
  const total = strongBuy + buy + hold + sell + strongSell;
  if (!total) return 'Unrated';
  const score = (strongBuy * 2 + buy - sell - strongSell * 2) / total;
  if (score >= 0.8) return 'Strong Buy';
  if (score >= 0.25) return 'Buy';
  if (score <= -0.8) return 'Strong Sell';
  if (score <= -0.25) return 'Sell';
  return 'Hold';
}

function rowsById(rows = []) {
  return new Map(rows.map((row) => [String(row.id), row]));
}

export function compareFinancialSnapshots(current, prior) {
  if (!current) return null;
  const currentAssets = number(current.assets);
  const currentLiabilities = number(current.liabilities);
  const currentNetWorth = number(current.net_worth ?? current.netWorth, currentAssets - currentLiabilities);
  if (!prior) {
    return {
      daysCompared: 0,
      assetsChange: 0,
      liabilitiesChange: 0,
      netWorthChange: 0,
      accountMovements: [],
      liabilityMovements: [],
      explanation: 'A starting snapshot was captured. Weekly movement will appear after additional daily snapshots are available.'
    };
  }

  const priorAssets = number(prior.assets);
  const priorLiabilities = number(prior.liabilities);
  const priorNetWorth = number(prior.net_worth ?? prior.netWorth, priorAssets - priorLiabilities);
  const currentAccounts = rowsById(current.account_breakdown || current.accountBreakdown || []);
  const priorAccounts = rowsById(prior.account_breakdown || prior.accountBreakdown || []);
  const currentDebts = rowsById(current.liability_breakdown || current.liabilityBreakdown || []);
  const priorDebts = rowsById(prior.liability_breakdown || prior.liabilityBreakdown || []);

  const movements = (currentMap, priorMap) => {
    const ids = new Set([...currentMap.keys(), ...priorMap.keys()]);
    return [...ids].map((id) => {
      const now = currentMap.get(id) || {};
      const before = priorMap.get(id) || {};
      const currentBalance = number(now.balance ?? now.current_balance);
      const priorBalance = number(before.balance ?? before.current_balance);
      return {
        id,
        name: now.name || before.name || 'Unknown',
        type: now.type || before.type || now.account_type || before.account_type || now.liability_type || before.liability_type || 'other',
        current: currentBalance,
        prior: priorBalance,
        change: round(currentBalance - priorBalance)
      };
    }).filter((row) => Math.abs(row.change) >= 0.01)
      .sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
  };

  const accountMovements = movements(currentAccounts, priorAccounts);
  const liabilityMovements = movements(currentDebts, priorDebts);
  const netWorthChange = round(currentNetWorth - priorNetWorth);
  const assetsChange = round(currentAssets - priorAssets);
  const liabilitiesChange = round(currentLiabilities - priorLiabilities);
  const parts = [];
  if (assetsChange) parts.push(`assets ${assetsChange > 0 ? 'increased' : 'decreased'} by $${Math.abs(assetsChange).toLocaleString('en-US', { maximumFractionDigits: 0 })}`);
  if (liabilitiesChange) parts.push(`debt ${liabilitiesChange < 0 ? 'declined' : 'increased'} by $${Math.abs(liabilitiesChange).toLocaleString('en-US', { maximumFractionDigits: 0 })}`);

  return {
    daysCompared: Math.max(0, Math.round((new Date(current.snapshot_date) - new Date(prior.snapshot_date)) / 86_400_000)),
    assetsChange,
    liabilitiesChange,
    netWorthChange,
    accountMovements: accountMovements.slice(0, 8),
    liabilityMovements: liabilityMovements.slice(0, 8),
    explanation: parts.length
      ? `Net worth ${netWorthChange >= 0 ? 'rose' : 'fell'} by $${Math.abs(netWorthChange).toLocaleString('en-US', { maximumFractionDigits: 0 })}; ${parts.join(' and ')}.`
      : 'No material change was detected between the available snapshots.'
  };
}

export function calculatePortfolioDrift(currentRows = [], targets = [], thresholdPct = 5) {
  const total = currentRows.reduce((sum, row) => sum + Math.max(0, number(row.value)), 0);
  const targetMap = new Map(targets.map((row) => [String(row.key ?? row.target_key).toUpperCase(), number(row.targetPercent ?? row.target_percent)]));
  if (!total) return [];
  const keys = new Set([...currentRows.map((row) => String(row.key ?? row.symbol).toUpperCase()), ...targetMap.keys()]);
  return [...keys].map((key) => {
    const value = currentRows.filter((row) => String(row.key ?? row.symbol).toUpperCase() === key)
      .reduce((sum, row) => sum + Math.max(0, number(row.value)), 0);
    const currentPercent = value / total;
    const targetPercent = targetMap.get(key) ?? 0;
    const driftPct = (currentPercent - targetPercent) * 100;
    return { key, value: round(value), currentPercent, targetPercent, driftPct: round(driftPct) };
  }).filter((row) => Math.abs(row.driftPct) >= thresholdPct)
    .sort((a, b) => Math.abs(b.driftPct) - Math.abs(a.driftPct));
}

export function monthlyPlannedExpense(expense, monthDate) {
  const month = new Date(`${String(monthDate).slice(0, 7)}-01T00:00:00Z`);
  const start = expense.start_date ? new Date(`${String(expense.start_date).slice(0, 10)}T00:00:00Z`) : null;
  const end = expense.end_date ? new Date(`${String(expense.end_date).slice(0, 10)}T00:00:00Z`) : null;
  if (start && month < new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1))) return 0;
  if (end && month > new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), 1))) return 0;
  return round(number(expense.annual_amount) / 12);
}

export function calculateGoalProgress(goal, linkedAccounts = []) {
  const linkedIds = new Set((goal.linked_account_ids || goal.linkedAccountIds || []).map(String));
  const linkedValue = linkedAccounts.filter((row) => linkedIds.has(String(row.id)))
    .reduce((sum, row) => sum + number(row.current_balance ?? row.balance), 0);
  const current = linkedIds.size ? linkedValue : number(goal.manual_current_amount ?? goal.manualCurrentAmount);
  const target = Math.max(0, number(goal.target_amount ?? goal.targetAmount));
  const progressPct = target > 0 ? Math.min(100, current / target * 100) : 0;
  const remaining = Math.max(0, target - current);
  const targetDate = goal.target_date ? new Date(`${String(goal.target_date).slice(0, 10)}T00:00:00Z`) : null;
  const monthsRemaining = targetDate ? Math.max(0, Math.ceil((targetDate - new Date()) / (30.4375 * 86_400_000))) : null;
  return {
    current: round(current),
    target: round(target),
    remaining: round(remaining),
    progressPct: round(progressPct, 1),
    monthsRemaining,
    monthlyNeeded: monthsRemaining && remaining > 0 ? round(remaining / monthsRemaining) : null,
    complete: target > 0 && current >= target
  };
}

export function tenYearForecastSlice(projection, horizonYears = 10) {
  const timeline = Array.isArray(projection?.timeline) ? projection.timeline : [];
  if (!timeline.length) return [];
  const currentAge = number(projection.currentAge, number(timeline[0]?.age));
  return timeline.filter((row) => number(row.age) <= currentAge + horizonYears).map((row) => ({
    age: number(row.age),
    yearOffset: number(row.age) - currentAge,
    netWorth: round(row.netWorth ?? row.net_worth),
    assets: round((row.savingsInvestments ?? 0) + (row.realEstate ?? 0) + (row.otherAssets ?? 0)),
    debt: round(row.debt),
    monthlyIncome: round(row.monthlyIncome),
    monthlyExpenses: round(row.monthlyExpenses),
    fundingDeficit: round(row.cumulativeShortfall ?? row.fundingDeficit)
  }));
}
