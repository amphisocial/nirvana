import type { Candle, NewsItem, Quote } from "@/lib/types";
import { config } from "@/lib/config";
import { findMeta } from "./universe";
import { mockHistory, mockNews, mockQuote } from "./mock";

const BASE = "https://finnhub.io/api/v1";

async function fh(path: string, params: Record<string, string | number>) {
  const url = new URL(BASE + path);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));
  url.searchParams.set("token", config.market.finnhubKey);
  const res = await fetch(url.toString(), { next: { revalidate: 60 } });
  if (!res.ok) throw new Error(`Finnhub ${res.status}`);
  return res.json();
}

export async function finnhubQuote(symbol: string): Promise<Quote> {
  try {
    const q = await fh("/quote", { symbol });
    if (typeof q.c !== "number" || q.c === 0) throw new Error("empty");
    const meta = findMeta(symbol);
    return {
      symbol,
      name: meta?.name ?? symbol,
      price: q.c,
      changePct: typeof q.dp === "number" ? q.dp : 0,
      currency: "USD",
    };
  } catch {
    return mockQuote(symbol); // graceful fallback keeps the app working
  }
}

// Finnhub candles are premium on the free tier; we synthesize history from
// the live quote by anchoring the mock walk to the real current price so the
// shape is realistic and the endpoint stays free-tier friendly.
export async function finnhubHistory(symbol: string, days = 1260): Promise<Candle[]> {
  const hist = mockHistory(symbol, days);
  try {
    const q = await finnhubQuote(symbol);
    const last = hist[hist.length - 1].close;
    const scale = q.price / last;
    return hist.map((c) => ({ t: c.t, close: Math.round(c.close * scale * 100) / 100 }));
  } catch {
    return hist;
  }
}

export async function finnhubNews(limit = 3): Promise<NewsItem[]> {
  try {
    const items = await fh("/news", { category: "general" });
    if (!Array.isArray(items) || !items.length) throw new Error("empty");
    return items.slice(0, limit).map((n: any, i: number) => ({
      id: String(n.id ?? i),
      headline: n.headline as string,
      source: n.source as string,
      url: n.url as string,
      datetime: (n.datetime ?? 0) * 1000,
    }));
  } catch {
    return mockNews(limit);
  }
}
