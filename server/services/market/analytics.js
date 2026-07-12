function finiteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function round(value, digits = 2) {
  if (!Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function dateValue(value) {
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function pointNearOrBefore(points, targetDate) {
  let selected = null;
  for (const point of points) {
    const date = dateValue(point.date);
    if (!date) continue;
    if (date <= targetDate) selected = point;
    else break;
  }
  return selected || points[0] || null;
}

function percentReturn(start, end) {
  const startValue = finiteNumber(start);
  const endValue = finiteNumber(end);
  if (!startValue || endValue === null) return null;
  return round(((endValue / startValue) - 1) * 100);
}

function returnForDays(points, days) {
  if (points.length < 2) return null;
  const latest = points.at(-1);
  const latestDate = dateValue(latest.date);
  if (!latestDate) return null;
  const target = new Date(latestDate);
  target.setUTCDate(target.getUTCDate() - days);
  const start = pointNearOrBefore(points, target);
  return percentReturn(start?.close, latest.close);
}

function ytdReturn(points) {
  if (points.length < 2) return null;
  const latest = points.at(-1);
  const latestDate = dateValue(latest.date);
  if (!latestDate) return null;
  const target = new Date(Date.UTC(latestDate.getUTCFullYear(), 0, 1));
  const start = pointNearOrBefore(points, target);
  return percentReturn(start?.close, latest.close);
}

function movingAverage(points, count) {
  if (!points.length) return null;
  const sample = points.slice(-Math.min(count, points.length));
  const values = sample.map((point) => finiteNumber(point.close)).filter((value) => value !== null);
  if (!values.length) return null;
  return round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function maximumDrawdown(points) {
  let peak = null;
  let maxDrawdown = 0;
  for (const point of points) {
    const close = finiteNumber(point.close);
    if (close === null || close <= 0) continue;
    peak = peak === null ? close : Math.max(peak, close);
    const drawdown = ((close / peak) - 1) * 100;
    maxDrawdown = Math.min(maxDrawdown, drawdown);
  }
  return round(maxDrawdown);
}

function annualizedVolatility(points) {
  if (points.length < 3) return null;
  const returns = [];
  for (let index = 1; index < points.length; index += 1) {
    const prior = finiteNumber(points[index - 1].close);
    const current = finiteNumber(points[index].close);
    if (prior && current && prior > 0 && current > 0) returns.push(Math.log(current / prior));
  }
  if (returns.length < 2) return null;
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.reduce((sum, value) => sum + ((value - mean) ** 2), 0) / (returns.length - 1);
  const firstDate = dateValue(points[0].date);
  const lastDate = dateValue(points.at(-1).date);
  if (!firstDate || !lastDate) return null;
  const elapsedDays = Math.max(1, (lastDate - firstDate) / 86_400_000);
  const observationsPerYear = Math.max(1, ((points.length - 1) / elapsedDays) * 365.25);
  return round(Math.sqrt(variance) * Math.sqrt(observationsPerYear) * 100);
}

function rangePosition(low, high, price) {
  if (![low, high, price].every(Number.isFinite) || high <= low) return null;
  return round(((price - low) / (high - low)) * 100);
}

export function sliceHistoryForRange(history, range = '1y') {
  const points = Array.isArray(history?.points) ? history.points : [];
  if (!points.length || range === '1y') return { ...history, range, points };
  const latestDate = dateValue(points.at(-1).date);
  if (!latestDate) return { ...history, range, points };
  const start = new Date(latestDate);
  if (range === '3m') start.setUTCMonth(start.getUTCMonth() - 3);
  else if (range === '6m') start.setUTCMonth(start.getUTCMonth() - 6);
  else if (range === 'ytd') start.setUTCMonth(0, 1);
  const filtered = points.filter((point) => {
    const date = dateValue(point.date);
    return date && date >= start;
  });
  return { ...history, range, points: filtered.length ? filtered : points };
}

export function calculateMarketAnalytics(history, research = {}) {
  const points = (Array.isArray(history?.points) ? history.points : [])
    .map((point) => ({ date: point.date, close: finiteNumber(point.close) }))
    .filter((point) => point.date && point.close !== null)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (!points.length) return null;

  const latest = points.at(-1);
  const highs = points.map((point) => point.close);
  const high = Math.max(...highs);
  const low = Math.min(...highs);
  const quotePrice = finiteNumber(research?.quote?.price);
  const currentPrice = quotePrice ?? latest.close;
  const average13 = movingAverage(points, 13);
  const average26 = movingAverage(points, 26);
  const distanceToHighPct = high ? round(((currentPrice / high) - 1) * 100) : null;

  return {
    price: round(currentPrice),
    priceAsOf: research?.quote?.asOf || history?.asOf || latest.date,
    returnsPct: {
      oneMonth: returnForDays(points, 30),
      threeMonth: returnForDays(points, 91),
      sixMonth: returnForDays(points, 182),
      ytd: ytdReturn(points),
      oneYear: percentReturn(points[0].close, latest.close)
    },
    high52Week: round(high),
    low52Week: round(low),
    rangePositionPct: rangePosition(low, high, currentPrice),
    distanceFrom52WeekHighPct: distanceToHighPct,
    maximumDrawdownPct: maximumDrawdown(points),
    annualizedVolatilityPct: annualizedVolatility(points),
    average13Period: average13,
    average26Period: average26,
    priceVs13PeriodAveragePct: average13 ? round(((currentPrice / average13) - 1) * 100) : null,
    priceVs26PeriodAveragePct: average26 ? round(((currentPrice / average26) - 1) * 100) : null,
    observationCount: points.length,
    historyStart: points[0].date,
    historyEnd: latest.date
  };
}
