import type { Candle, NewsItem, Quote } from "@/lib/types";
import { config } from "@/lib/config";
import { mockHistory, mockNews, mockQuote } from "./mock";
import { finnhubHistory, finnhubNews, finnhubQuote } from "./finnhub";
import { avHistory, avNews, avQuote } from "./alphavantage";
import { universe } from "./universe";
import { cached } from "./cache";

// Which live provider (if any) is active. Anything unrecognized → mock.
type Live = "finnhub" | "alphavantage" | null;
function liveProvider(): Live {
  const p = config.market.provider;
  if (p === "finnhub" && config.market.finnhubKey) return "finnhub";
  if (p === "alphavantage" && config.market.alphavantageKey) return "alphavantage";
  return null;
}

export async function getQuote(symbol: string): Promise<Quote> {
  return cached(`q:${symbol}`, 120000, async () => {
    const p = liveProvider();
    if (p === "finnhub") return finnhubQuote(symbol);
    if (p === "alphavantage") return avQuote(symbol);
    return mockQuote(symbol);
  });
}

export async function getHistory(symbol: string, days = 1260): Promise<Candle[]> {
  return cached(`h:${symbol}:${days}`, 120000, async () => {
    const p = liveProvider();
    if (p === "finnhub") return finnhubHistory(symbol, days);
    if (p === "alphavantage") return avHistory(symbol, days);
    return mockHistory(symbol, days);
  });
}

export async function getNews(limit = 3): Promise<NewsItem[]> {
  const p = liveProvider();
  if (p === "finnhub") return finnhubNews(limit);
  if (p === "alphavantage") return avNews(limit);
  return mockNews(limit);
}

// ---- derived analytics --------------------------------------------

export function annualizedVol(candles: Candle[]): number {
  const rets: number[] = [];
  for (let i = 1; i < candles.length; i++) rets.push(Math.log(candles[i].close / candles[i - 1].close));
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const varc = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / rets.length;
  return Math.round(Math.sqrt(varc) * Math.sqrt(252) * 1000) / 10; // %
}

export function maxDrawdown(series: number[]): number {
  let peak = series[0] ?? 0;
  let mdd = 0;
  for (const v of series) {
    if (v > peak) peak = v;
    const dd = (v - peak) / peak;
    if (dd < mdd) mdd = dd;
  }
  return Math.round(mdd * 1000) / 10; // % (negative)
}

// Top movers across the universe. Live providers are capped to respect free
// tiers (Alpha Vantage's daily cap is small, so it's capped hardest).
export async function getMovers(listing = config.market.listing) {
  const syms = universe(listing).map((u) => u.symbol);
  const p = liveProvider();
  const cap = p === "alphavantage" ? 8 : p === "finnhub" ? 20 : syms.length;
  const quotes = await Promise.all(syms.slice(0, cap).map((s) => getQuote(s)));
  const sorted = [...quotes].sort((a, b) => b.changePct - a.changePct);
  return { gainers: sorted.slice(0, 5), losers: sorted.slice(-5).reverse() };
}
