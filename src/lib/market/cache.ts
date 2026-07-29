// Small in-memory cache + a global throttle for market-data calls.
// Purpose: a full portfolio build re-requests the same symbols across the
// research/risk/optimize/backtest stages and can fire 60+ calls in under a
// minute — which blows Finnhub's free 60/min limit and silently degrades to
// synthetic prices. Caching de-dupes within a build; the throttle paces calls
// so we stay under the limit and keep prices REAL (at the cost of some speed).

type Entry = { t: number; v: unknown };
const store = new Map<string, Entry>();

export async function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const hit = store.get(key);
  if (hit && Date.now() - hit.t < ttlMs) return hit.v as T;
  const v = await fn();
  store.set(key, { t: Date.now(), v });
  return v;
}

// Serialised throttle: ensures at least `minGapMs` between wrapped calls.
let lastRun = 0;
let chain: Promise<unknown> = Promise.resolve();

export function throttle<T>(minGapMs: number, fn: () => Promise<T>): Promise<T> {
  const run = async (): Promise<T> => {
    const wait = Math.max(0, lastRun + minGapMs - Date.now());
    if (wait) await new Promise((r) => setTimeout(r, wait));
    lastRun = Date.now();
    return fn();
  };
  const p = chain.then(run, run);
  chain = p.catch(() => {});
  return p as Promise<T>;
}
