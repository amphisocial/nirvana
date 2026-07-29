import type { Fundamentals } from "@/lib/types";
import { config } from "@/lib/config";
import { findMeta } from "./universe";
import { throttle, cached } from "./cache";

// Resolve fundamentals for ANY US-listed ticker — not just the curated list.
// Order: curated table (instant, offline) → live provider profile → null.
// Returns null when the symbol can't be found as a US equity so callers can
// give an honest "couldn't find it" instead of pretending.
export async function resolveFundamentals(symbolRaw: string): Promise<Fundamentals | null> {
  const symbol = symbolRaw.trim().toUpperCase();
  if (!symbol) return null;
  return cached(`fund:${symbol}`, 600000, () => resolveInner(symbol));
}

async function resolveInner(symbol: string): Promise<Fundamentals | null> {

  const curated = findMeta(symbol);
  if (curated) return curated;

  const provider = config.market.provider;
  if (provider === "finnhub" && config.market.finnhubKey) return finnhubResolve(symbol);
  if (provider === "alphavantage" && config.market.alphavantageKey) return avResolve(symbol);

  // No live provider configured and not in the curated list → genuinely unknown.
  return null;
}

function classifyExchange(ex = ""): "NASDAQ" | "NYSE" | null {
  const e = ex.toUpperCase();
  if (e.includes("NASDAQ")) return "NASDAQ";
  if (e.includes("NEW YORK") || e.includes("NYSE") || e.includes("ARCA") || e.includes("AMEX")) return "NYSE";
  return null;
}

async function finnhubResolve(symbol: string): Promise<Fundamentals | null> {
  try {
    const base = "https://finnhub.io/api/v1";
    const key = config.market.finnhubKey;
    const [pRes, mRes] = await Promise.all([
      throttle(1050, () => fetch(`${base}/stock/profile2?symbol=${symbol}&token=${key}`)),
      throttle(1050, () => fetch(`${base}/stock/metric?symbol=${symbol}&metric=all&token=${key}`)),
    ]);
    const profile = await pRes.json();
    if (!profile || !profile.name) return null; // unknown ticker
    const listing = classifyExchange(profile.exchange) ?? "NYSE";
    const metric = (await mRes.json())?.metric ?? {};
    const beta = num(metric.beta) ?? 1;
    const divYield = num(metric.currentDividendYieldTTM) ?? num(metric.dividendYieldIndicatedAnnual) ?? 0;
    return {
      symbol,
      name: profile.name,
      sector: profile.finnhubIndustry || "Other",
      listing,
      marketCap: Math.round((num(profile.marketCapitalization) ?? 0) / 1000), // millions → $B
      peRatio: num(metric.peTTM),
      dividendYield: Math.round(divYield * 10) / 10,
      beta: Math.round(beta * 100) / 100,
      volatility: Math.round((12 + beta * 14) * 10) / 10,
    };
  } catch {
    return null;
  }
}

async function avResolve(symbol: string): Promise<Fundamentals | null> {
  try {
    const url = `https://www.alphavantage.co/query?function=OVERVIEW&symbol=${symbol}&apikey=${config.market.alphavantageKey}`;
    const d = await (await throttle(1050, () => fetch(url))).json();
    if (!d || !d.Name || d.Note || d.Information) return null;
    const beta = num(d.Beta) ?? 1;
    return {
      symbol,
      name: d.Name,
      sector: d.Sector ? title(d.Sector) : "Other",
      listing: classifyExchange(d.Exchange) ?? "NYSE",
      marketCap: Math.round((num(d.MarketCapitalization) ?? 0) / 1e9),
      peRatio: num(d.PERatio),
      dividendYield: Math.round((num(d.DividendYield) ?? 0) * 1000) / 10,
      beta: Math.round(beta * 100) / 100,
      volatility: Math.round((12 + beta * 14) * 10) / 10,
    };
  } catch {
    return null;
  }
}

function num(v: any): number | null {
  if (v === undefined || v === null || v === "" || v === "None" || v === "-") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
function title(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}
