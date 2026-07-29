import type { Candle, NewsItem, Quote } from "@/lib/types";
import { findMeta } from "./universe";

// Deterministic pseudo-random from a string seed so charts/quotes are
// stable across renders (no flicker) yet realistic per-symbol.
function hash(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function rng(seed: number) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

// A base price bucket per symbol, stable.
function basePrice(symbol: string): number {
  const r = rng(hash(symbol) + 7);
  const buckets = [42, 88, 120, 175, 230, 310, 420, 540];
  return buckets[Math.floor(r() * buckets.length)] + Math.round(r() * 40);
}

export function mockQuote(symbol: string): Quote {
  const meta = findMeta(symbol);
  const price = basePrice(symbol);
  // day change biased by beta, seeded on symbol+day so it's stable within a day
  const day = new Date().toISOString().slice(0, 10);
  const r = rng(hash(symbol + day));
  const beta = meta?.beta ?? 1;
  const changePct = Math.round((r() * 2 - 1) * beta * 2.4 * 100) / 100;
  return {
    symbol,
    name: meta?.name ?? symbol,
    price: Math.round(price * (1 + changePct / 100) * 100) / 100,
    changePct,
    currency: "USD",
  };
}

// Daily closes over `days` trading days ending today, geometric random walk
// with drift + vol scaled by beta. Deterministic per symbol.
export function mockHistory(symbol: string, days = 1260): Candle[] {
  const meta = findMeta(symbol);
  const beta = meta?.beta ?? 1;
  const start = basePrice(symbol) * 0.42; // ~5y ago
  const r = rng(hash(symbol + "hist"));
  const dailyVol = (0.008 + beta * 0.006); // per-day sigma
  const drift = 0.0004 + (meta?.dividendYield ?? 0) * 0.00002; // small upward
  const out: Candle[] = [];
  let p = start;
  const now = Date.now();
  for (let i = days; i >= 0; i--) {
    // box-muller-ish from two uniforms
    const u1 = Math.max(1e-9, r());
    const u2 = r();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    p = p * Math.exp(drift + dailyVol * z);
    out.push({ t: now - i * 86400000, close: Math.round(p * 100) / 100 });
  }
  return out;
}

const NEWS = [
  { h: "Fed holds rates steady, signals patience on cuts", s: "Reuters" },
  { h: "Megacap tech leads broad rally as breadth improves", s: "Bloomberg" },
  { h: "Semiconductor demand outlook lifts chip names", s: "WSJ" },
  { h: "Consumer spending data comes in ahead of estimates", s: "CNBC" },
  { h: "Energy pares gains as crude retreats from highs", s: "MarketWatch" },
  { h: "Healthcare rotates in as investors seek defensives", s: "Barron's" },
  { h: "Earnings season kicks off with banks in focus", s: "FT" },
  { h: "Volatility index eases as macro fears cool", s: "Reuters" },
];

export function mockNews(limit = 3): NewsItem[] {
  const day = new Date().toISOString().slice(0, 10);
  const r = rng(hash(day));
  const pool = [...NEWS].sort(() => r() - 0.5);
  return pool.slice(0, limit).map((n, i) => ({
    id: `${day}-${i}`,
    headline: n.h,
    source: n.s,
    url: "#",
    datetime: Date.now() - i * 3600000,
  }));
}
