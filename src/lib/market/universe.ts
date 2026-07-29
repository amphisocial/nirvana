import type { Fundamentals } from "@/lib/types";

// A curated, diversified universe of large US names across NASDAQ + NYSE.
// marketCap in $B; dividendYield/beta approximate baselines used by the
// simulated engine and as fallbacks when live fundamentals are missing.
type Row = Omit<Fundamentals, "volatility" | "peRatio"> & {
  pe: number | null;
};

const U: Row[] = [
  // Technology
  { symbol: "AAPL", name: "Apple", sector: "Technology", listing: "NASDAQ", marketCap: 3400, pe: 34, dividendYield: 0.5, beta: 1.2 },
  { symbol: "MSFT", name: "Microsoft", sector: "Technology", listing: "NASDAQ", marketCap: 3100, pe: 36, dividendYield: 0.7, beta: 0.9 },
  { symbol: "NVDA", name: "NVIDIA", sector: "Technology", listing: "NASDAQ", marketCap: 3000, pe: 55, dividendYield: 0.03, beta: 1.7 },
  { symbol: "AVGO", name: "Broadcom", sector: "Technology", listing: "NASDAQ", marketCap: 780, pe: 45, dividendYield: 1.2, beta: 1.1 },
  { symbol: "ORCL", name: "Oracle", sector: "Technology", listing: "NYSE", marketCap: 400, pe: 30, dividendYield: 1.3, beta: 1.0 },
  { symbol: "CRM", name: "Salesforce", sector: "Technology", listing: "NYSE", marketCap: 260, pe: 42, dividendYield: 0.6, beta: 1.3 },
  { symbol: "AMD", name: "Advanced Micro Devices", sector: "Technology", listing: "NASDAQ", marketCap: 230, pe: 40, dividendYield: 0, beta: 1.8 },
  { symbol: "ADBE", name: "Adobe", sector: "Technology", listing: "NASDAQ", marketCap: 220, pe: 33, dividendYield: 0, beta: 1.3 },

  // Communication / Internet
  { symbol: "GOOGL", name: "Alphabet", sector: "Communication", listing: "NASDAQ", marketCap: 2100, pe: 24, dividendYield: 0.5, beta: 1.1 },
  { symbol: "META", name: "Meta Platforms", sector: "Communication", listing: "NASDAQ", marketCap: 1300, pe: 27, dividendYield: 0.4, beta: 1.3 },
  { symbol: "NFLX", name: "Netflix", sector: "Communication", listing: "NASDAQ", marketCap: 300, pe: 40, dividendYield: 0, beta: 1.3 },
  { symbol: "DIS", name: "Walt Disney", sector: "Communication", listing: "NYSE", marketCap: 200, pe: 22, dividendYield: 0.9, beta: 1.4 },

  // Consumer Discretionary
  { symbol: "AMZN", name: "Amazon", sector: "Consumer Cyclical", listing: "NASDAQ", marketCap: 2000, pe: 42, dividendYield: 0, beta: 1.2 },
  { symbol: "TSLA", name: "Tesla", sector: "Consumer Cyclical", listing: "NASDAQ", marketCap: 800, pe: 65, dividendYield: 0, beta: 2.0 },
  { symbol: "HD", name: "Home Depot", sector: "Consumer Cyclical", listing: "NYSE", marketCap: 380, pe: 25, dividendYield: 2.4, beta: 1.0 },
  { symbol: "NKE", name: "Nike", sector: "Consumer Cyclical", listing: "NYSE", marketCap: 120, pe: 22, dividendYield: 1.8, beta: 1.1 },
  { symbol: "SBUX", name: "Starbucks", sector: "Consumer Cyclical", listing: "NASDAQ", marketCap: 105, pe: 26, dividendYield: 2.6, beta: 1.0 },

  // Consumer Staples
  { symbol: "COST", name: "Costco", sector: "Consumer Defensive", listing: "NASDAQ", marketCap: 400, pe: 52, dividendYield: 0.5, beta: 0.8 },
  { symbol: "PG", name: "Procter & Gamble", sector: "Consumer Defensive", listing: "NYSE", marketCap: 390, pe: 27, dividendYield: 2.4, beta: 0.4 },
  { symbol: "KO", name: "Coca-Cola", sector: "Consumer Defensive", listing: "NYSE", marketCap: 280, pe: 25, dividendYield: 3.1, beta: 0.6 },
  { symbol: "WMT", name: "Walmart", sector: "Consumer Defensive", listing: "NYSE", marketCap: 620, pe: 38, dividendYield: 1.0, beta: 0.5 },

  // Healthcare
  { symbol: "LLY", name: "Eli Lilly", sector: "Healthcare", listing: "NYSE", marketCap: 800, pe: 60, dividendYield: 0.7, beta: 0.5 },
  { symbol: "UNH", name: "UnitedHealth", sector: "Healthcare", listing: "NYSE", marketCap: 520, pe: 22, dividendYield: 1.5, beta: 0.6 },
  { symbol: "JNJ", name: "Johnson & Johnson", sector: "Healthcare", listing: "NYSE", marketCap: 380, pe: 24, dividendYield: 3.1, beta: 0.5 },
  { symbol: "ABBV", name: "AbbVie", sector: "Healthcare", listing: "NYSE", marketCap: 320, pe: 20, dividendYield: 3.4, beta: 0.6 },
  { symbol: "ISRG", name: "Intuitive Surgical", sector: "Healthcare", listing: "NASDAQ", marketCap: 180, pe: 70, dividendYield: 0, beta: 1.1 },

  // Financials
  { symbol: "JPM", name: "JPMorgan Chase", sector: "Financials", listing: "NYSE", marketCap: 680, pe: 13, dividendYield: 2.1, beta: 1.1 },
  { symbol: "V", name: "Visa", sector: "Financials", listing: "NYSE", marketCap: 560, pe: 30, dividendYield: 0.8, beta: 0.9 },
  { symbol: "MA", name: "Mastercard", sector: "Financials", listing: "NYSE", marketCap: 440, pe: 35, dividendYield: 0.6, beta: 1.0 },
  { symbol: "BRK.B", name: "Berkshire Hathaway", sector: "Financials", listing: "NYSE", marketCap: 950, pe: 22, dividendYield: 0, beta: 0.8 },
  { symbol: "GS", name: "Goldman Sachs", sector: "Financials", listing: "NYSE", marketCap: 170, pe: 16, dividendYield: 2.2, beta: 1.3 },

  // Industrials
  { symbol: "CAT", name: "Caterpillar", sector: "Industrials", listing: "NYSE", marketCap: 175, pe: 17, dividendYield: 1.5, beta: 1.0 },
  { symbol: "BA", name: "Boeing", sector: "Industrials", listing: "NYSE", marketCap: 130, pe: null, dividendYield: 0, beta: 1.4 },
  { symbol: "GE", name: "GE Aerospace", sector: "Industrials", listing: "NYSE", marketCap: 200, pe: 35, dividendYield: 0.6, beta: 1.2 },
  { symbol: "UBER", name: "Uber Technologies", sector: "Industrials", listing: "NYSE", marketCap: 150, pe: 32, dividendYield: 0, beta: 1.4 },

  // Energy
  { symbol: "XOM", name: "Exxon Mobil", sector: "Energy", listing: "NYSE", marketCap: 480, pe: 14, dividendYield: 3.3, beta: 0.9 },
  { symbol: "CVX", name: "Chevron", sector: "Energy", listing: "NYSE", marketCap: 280, pe: 15, dividendYield: 4.1, beta: 1.0 },

  // Utilities / Real Estate (defensive ballast)
  { symbol: "NEE", name: "NextEra Energy", sector: "Utilities", listing: "NYSE", marketCap: 160, pe: 21, dividendYield: 2.9, beta: 0.5 },
  { symbol: "AMT", name: "American Tower", sector: "Real Estate", listing: "NYSE", marketCap: 100, pe: 40, dividendYield: 3.2, beta: 0.7 },
];

export const SECTORS = Array.from(new Set(U.map((r) => r.sector))).sort();

export function universe(
  listing: "nasdaq" | "nyse" | "both" = "both"
): Fundamentals[] {
  const filtered = U.filter((r) => {
    if (listing === "both") return true;
    return r.listing.toLowerCase() === listing;
  });
  return filtered.map((r) => ({
    symbol: r.symbol,
    name: r.name,
    sector: r.sector,
    listing: r.listing,
    marketCap: r.marketCap,
    peRatio: r.pe,
    dividendYield: r.dividendYield,
    beta: r.beta,
    // volatility is derived deterministically from beta as a stable baseline
    volatility: Math.round((12 + r.beta * 14) * 10) / 10,
  }));
}

export function findMeta(symbol: string): Fundamentals | undefined {
  return universe("both").find(
    (u) => u.symbol.toUpperCase() === symbol.toUpperCase()
  );
}
