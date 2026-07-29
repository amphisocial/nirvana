import type { Candle, Quote } from "@/lib/types";
import { config } from "@/lib/config";
import { mockHistory, mockNews, mockQuote } from "./mock";
import { finnhubHistory, finnhubNews, finnhubQuote } from "./finnhub";
import { universe } from "./universe";

const useFinnhub = () =>
  config.market.provider === "finnhub" && Boolean(config.market.finnhubKey);

export async function getQuote(symbol: string): Promise<Quote> {
  return useFinnhub() ? finnhubQuote(symbol) : mockQuote(symbol);
}

export async function getHistory(symbol: string, days = 1260): Promise<Candle[]> {
  return useFinnhub() ? finnhubHistory(symbol, days) : mockHistory(symbol, days);
}

export async function getNews(limit = 3) {
  return useFinnhub() ? finnhubNews(limit) : mockNews(limit);
}

// ---- derived analytics --------------------------------------------

export function annualizedVol(candles: Candle[]): number {
  const rets: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    rets.push(Math.log(candles[i].close / candles[i - 1].close));
  }
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

// Top movers computed across the universe (mock: instant; finnhub: capped).
export async function getMovers(listing = config.market.listing) {
  const syms = universe(listing).map((u) => u.symbol);
  const cap = useFinnhub() ? 20 : syms.length; // stay under free-tier limits
  const quotes = await Promise.all(syms.slice(0, cap).map((s) => getQuote(s)));
  const sorted = [...quotes].sort((a, b) => b.changePct - a.changePct);
  return {
    gainers: sorted.slice(0, 5),
    losers: sorted.slice(-5).reverse(),
  };
}
