import type { MarketContext } from "@/lib/types";
import { getNews, getQuote } from "@/lib/market";

// The sector ETFs the desk reads every morning to see where money is rotating.
const SECTOR_ETFS: { etf: string; name: string }[] = [
  { etf: "XLK", name: "Technology" },
  { etf: "XLF", name: "Financials" },
  { etf: "XLE", name: "Energy" },
  { etf: "XLV", name: "Healthcare" },
  { etf: "XLY", name: "Consumer Cyclical" },
  { etf: "XLP", name: "Consumer Defensive" },
  { etf: "XLI", name: "Industrials" },
  { etf: "XLU", name: "Utilities" },
  { etf: "XLB", name: "Materials" },
  { etf: "XLRE", name: "Real Estate" },
  { etf: "XLC", name: "Communication" },
];
const INDICES: { symbol: string; name: string }[] = [
  { symbol: "SPY", name: "S&P 500" },
  { symbol: "QQQ", name: "Nasdaq 100" },
  { symbol: "DIA", name: "Dow Jones" },
  { symbol: "IWM", name: "Russell 2000" },
];

// Gathers the real, current market picture the agents reason over. Uses live
// quotes/news when a provider is configured; degrades to synthetic otherwise.
export async function gatherContext(): Promise<MarketContext> {
  const [indexQuotes, sectorQuotes, news] = await Promise.all([
    Promise.all(INDICES.map(async (i) => ({ ...i, changePct: (await getQuote(i.symbol)).changePct }))),
    Promise.all(SECTOR_ETFS.map(async (s) => ({ ...s, changePct: (await getQuote(s.etf)).changePct }))),
    getNews(6),
  ]);

  const sorted = [...sectorQuotes].sort((a, b) => b.changePct - a.changePct);
  const leaders = sorted.slice(0, 3).map((s) => s.name);
  const laggards = sorted.slice(-3).map((s) => s.name);
  const spx = indexQuotes.find((i) => i.symbol === "SPY")?.changePct ?? 0;
  const breadth = spx > 0.3 ? "risk-on" : spx < -0.3 ? "risk-off" : "mixed";

  return {
    asOf: new Date().toISOString(),
    indices: indexQuotes.map((i) => ({ symbol: i.symbol, name: i.name, changePct: i.changePct })),
    sectors: sectorQuotes.map((s) => ({ etf: s.etf, name: s.name, changePct: s.changePct })),
    headlines: news.map((n) => ({ headline: n.headline, source: n.source })),
    breadth,
    leaders,
    laggards,
  };
}

// A compact text brief the LLM agents receive as grounding.
export function contextBrief(ctx: MarketContext): string {
  const idx = ctx.indices.map((i) => `${i.name} ${fmt(i.changePct)}`).join(", ");
  const sec = ctx.sectors.map((s) => `${s.name} ${fmt(s.changePct)}`).join(", ");
  const news = ctx.headlines.map((h) => `- ${h.headline} (${h.source})`).join("\n");
  return `TODAY'S MARKET (as of ${new Date(ctx.asOf).toUTCString()}):
Tone: ${ctx.breadth}. Indices: ${idx}.
Sector rotation: ${sec}.
Leading sectors: ${ctx.leaders.join(", ")}. Lagging: ${ctx.laggards.join(", ")}.
Recent headlines:
${news}`;
}

function fmt(n: number): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
}
