import { config } from "@/lib/config";

export interface MarketHealth {
  provider: string;
  ok: boolean;
  detail: string;
}

// Directly probes the configured provider WITHOUT the mock fallback, so admin
// can tell whether live data actually works (vs. silently serving mock).
export async function marketHealth(): Promise<MarketHealth> {
  const p = config.market.provider;
  try {
    if (p === "finnhub") {
      if (!config.market.finnhubKey) return { provider: p, ok: false, detail: "no FINNHUB_API_KEY" };
      const r = await fetch(`https://finnhub.io/api/v1/quote?symbol=AAPL&token=${config.market.finnhubKey}`, { cache: "no-store" });
      if (!r.ok) return { provider: p, ok: false, detail: `HTTP ${r.status} from finnhub` };
      const d = await r.json();
      if (typeof d.c !== "number" || d.c === 0) return { provider: p, ok: false, detail: "empty quote (bad key or rate-limited)" };
      return { provider: p, ok: true, detail: `live · AAPL $${d.c}` };
    }
    if (p === "alphavantage") {
      if (!config.market.alphavantageKey) return { provider: p, ok: false, detail: "no ALPHAVANTAGE_API_KEY" };
      const r = await fetch(`https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=AAPL&apikey=${config.market.alphavantageKey}`, { cache: "no-store" });
      const d = await r.json();
      if (d.Note || d.Information) return { provider: p, ok: false, detail: "rate-limited (daily cap)" };
      const price = Number(d["Global Quote"]?.["05. price"]);
      if (!price) return { provider: p, ok: false, detail: "empty quote (bad key)" };
      return { provider: p, ok: true, detail: `live · AAPL $${price}` };
    }
    return { provider: "mock", ok: false, detail: "using synthetic data (no live provider)" };
  } catch (e: any) {
    return { provider: p, ok: false, detail: `unreachable: ${e?.message ?? "network error"} — check egress/firewall` };
  }
}
