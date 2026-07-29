import type { PerformanceSnapshot, PortfolioRecord } from "@/lib/types";
import { getQuote } from "@/lib/market";

// Leo Whitfield — Performance & Operations. On demand, re-prices every
// holding against the price recorded on the day of recommendation and
// reports total gain/loss from base value to current value.
export async function refreshPerformance(
  rec: PortfolioRecord
): Promise<PerformanceSnapshot> {
  const perHolding = await Promise.all(
    rec.allocation.holdings.map(async (h) => {
      const q = await getQuote(h.symbol);
      const changePct = h.basePrice
        ? ((q.price - h.basePrice) / h.basePrice) * 100
        : 0;
      const dollarsNow = h.basePrice ? h.dollars * (q.price / h.basePrice) : h.dollars;
      return {
        symbol: h.symbol,
        basePrice: h.basePrice,
        currentPrice: q.price,
        changePct: Math.round(changePct * 100) / 100,
        dollarsNow: Math.round(dollarsNow),
      };
    })
  );

  const baseValue = rec.allocation.holdings.reduce((a, h) => a + h.dollars, 0);
  const currentValue = perHolding.reduce((a, h) => a + h.dollarsNow, 0);
  const gainLossPct = baseValue
    ? Math.round(((currentValue - baseValue) / baseValue) * 10000) / 100
    : 0;

  return {
    at: new Date().toISOString(),
    baseValue: Math.round(baseValue),
    currentValue: Math.round(currentValue),
    gainLossPct,
    perHolding,
  };
}
