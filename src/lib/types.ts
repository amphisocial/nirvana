// ─────────────────────────────────────────────────────────────
// NIRVANA — shared types
// ─────────────────────────────────────────────────────────────

export type AgentId =
  | "researcher"
  | "risk"
  | "debater"
  | "tester"
  | "optimizer";

export interface AgentPersona {
  id: AgentId;
  name: string;          // human name (leadership)
  title: string;         // job title
  role: string;          // one-line what they do
  desk: string;          // short label used on the "desk"
  bio: string;           // About Us leadership bio
  focus: string[];       // skills / responsibilities (phase-1 hardcoded)
  method: string[];      // the steps this agent follows
  accent: string;        // hex accent used in UI + avatar
  seed: number;          // avatar seed
}

export type GrowthTier = "high" | "medium" | "low";
export type RiskTier = "aggressive" | "balanced" | "defensive";

export interface Quote {
  symbol: string;
  name: string;
  price: number;
  changePct: number;      // day change %
  currency: string;
}

export interface Candle {
  t: number;              // epoch ms
  close: number;
}

export interface Fundamentals {
  symbol: string;
  name: string;
  sector: string;
  listing: "NASDAQ" | "NYSE";
  marketCap: number;      // in $B
  peRatio: number | null;
  dividendYield: number;  // %
  beta: number;
  volatility: number;     // annualized %, derived
}

// ---- Agent outputs -------------------------------------------------

export interface ResearchNote {
  symbol: string;
  name: string;
  sector: string;
  thesis: string;
  catalysts: string[];
  risks: string[];
  growthTier: GrowthTier;
  conviction: number;     // 0-100
}

export interface RiskAssessment {
  symbol: string;
  riskTier: RiskTier;
  volatility: number;     // %
  beta: number;
  maxDrawdown: number;    // % (negative)
  notes: string;
  riskScore: number;      // 0-100 (higher = riskier)
}

export interface DebatePoint {
  by: "bull" | "bear";
  point: string;
}

export interface DebateVerdict {
  symbol: string;
  bull: string[];
  bear: string[];
  verdict: string;
  score: number;          // -100..100 (net conviction after debate)
}

export interface BacktestResult {
  totalReturnPct: number;
  benchmarkReturnPct: number; // SPY
  maxDrawdownPct: number;
  sharpe: number;
  winRatePct: number;
  profitFactor: number;
  equityCurve: { t: number; strategy: number; benchmark: number }[];
  period: string;
}

export interface Holding {
  symbol: string;
  name: string;
  sector: string;
  weight: number;         // 0-1
  dollars: number;
  shares: number;
  basePrice: number;      // price at recommendation
  growthTier: GrowthTier;
  riskTier: RiskTier;
  thesis: string;
}

export interface Allocation {
  holdings: Holding[];
  cashReserve: number;
  rationale: string;
  expectedReturnPct: number;
  expectedVolPct: number;
}

// ---- Questionnaire -------------------------------------------------

export interface Answers {
  amount: number;
  horizon: "short" | "medium" | "long";
  goal: "growth" | "income" | "preserve" | "balanced";
  riskComfort: "low" | "medium" | "high";
  drawdownTolerance?: "5" | "15" | "30";
  sectors?: string[];
  experience?: "new" | "some" | "seasoned";
  incomeNeed?: "yes" | "no";
  existingConcentration?: "none" | "tech" | "diversified";
  esg?: "yes" | "no";
}

// ---- Portfolio record (saved) -------------------------------------

export interface PortfolioRecord {
  id: string;
  createdAt: string;      // ISO
  userEmail?: string;     // owner (set when saved by a signed-in user)
  answers: Answers;
  allocation: Allocation;
  backtest: BacktestResult;
  research: ResearchNote[];
  risk: RiskAssessment[];
  debate: DebateVerdict[];
  updates: PerformanceSnapshot[];
  engine: "ai" | "simulated";
}

export interface PerformanceSnapshot {
  at: string;             // ISO
  baseValue: number;
  currentValue: number;
  gainLossPct: number;
  perHolding: {
    symbol: string;
    basePrice: number;
    currentPrice: number;
    changePct: number;
    dollarsNow: number;
  }[];
}

// ---- Blog ----------------------------------------------------------

export interface BlogPost {
  slug: string;
  date: string;           // ISO
  title: string;
  dek: string;            // subhead
  pick: { symbol: string; name: string; growthTier: GrowthTier };
  body: string[];         // paragraphs
  author: AgentId;
  engine: "ai" | "simulated";
}

export interface NewsItem {
  id: string;
  headline: string;
  source: string;
  url: string;
  datetime: number;
}

export interface MarketContext {
  asOf: string;
  indices: { symbol: string; name: string; changePct: number }[];
  sectors: { etf: string; name: string; changePct: number }[];
  headlines: { headline: string; source: string }[];
  breadth: "risk-on" | "mixed" | "risk-off";
  leaders: string[];   // leading sectors today
  laggards: string[];  // lagging sectors today
}
