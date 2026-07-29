import type { Candle, NewsItem, Quote } from "@/lib/types";
import { config } from "@/lib/config";
import { findMeta } from "./universe";
import { mockHistory, mockNews, mockQuote } from "./mock";

const BASE = "https://www.alphavantage.co/query";

async function av(params: Record<string, string>) {
  const url = new URL(BASE);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  url.searchParams.set("apikey", config.market.alphavantageKey);
  const res = await fetch(url.toString(), { next: { revalidate: 60 } });
  if (!res.ok) throw new Error(`AlphaVantage ${res.status}`);
  const data = await res.json();
  // AV returns a "Note"/"Information" string when the daily/min rate cap is hit.
  if (data.Note || data.Information) throw new Error("AlphaVantage rate limit");
  return data;
}

export async function avQuote(symbol: string): Promise<Quote> {
  try {
    const d = await av({ function: "GLOBAL_QUOTE", symbol });
    const q = d["Global Quote"] || {};
    const price = Number(q["05. price"]);
    if (!price) throw new Error("empty");
    const meta = findMeta(symbol);
    return {
      symbol,
      name: meta?.name ?? symbol,
      price,
      changePct: Number(String(q["10. change percent"] || "0").replace("%", "")) || 0,
      currency: "USD",
    };
  } catch {
    return mockQuote(symbol); // graceful fallback keeps the app working
  }
}

// AV historical series are limited on the free tier; synthesize a realistic
// walk anchored to the live price (same approach as the Finnhub provider).
export async function avHistory(symbol: string, days = 1260): Promise<Candle[]> {
  const hist = mockHistory(symbol, days);
  try {
    const q = await avQuote(symbol);
    const last = hist[hist.length - 1].close;
    const scale = q.price / last;
    return hist.map((c) => ({ t: c.t, close: Math.round(c.close * scale * 100) / 100 }));
  } catch {
    return hist;
  }
}

export async function avNews(limit = 3): Promise<NewsItem[]> {
  try {
    const d = await av({ function: "NEWS_SENTIMENT", topics: "financial_markets", sort: "LATEST" });
    const feed = Array.isArray(d.feed) ? d.feed : [];
    if (!feed.length) throw new Error("empty");
    return feed.slice(0, limit).map((n: any, i: number) => ({
      id: String(i),
      headline: n.title as string,
      source: n.source as string,
      url: n.url as string,
      datetime: Date.parse(n.time_published?.replace(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/, "$1-$2-$3T$4:$5:$6")) || Date.now(),
    }));
  } catch {
    return mockNews(limit);
  }
}
