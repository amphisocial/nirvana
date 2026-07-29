import type {
  Allocation,
  Answers,
  BacktestResult,
  BlogPost,
  DebateVerdict,
  Fundamentals,
  GrowthTier,
  Holding,
  ResearchNote,
  RiskAssessment,
  RiskTier,
} from "@/lib/types";
import { config, engineName } from "@/lib/config";
import { askJson, ask } from "@/lib/anthropic";
import { systemFor } from "./prompts";
import { universe, findMeta } from "@/lib/market/universe";
import {
  annualizedVol,
  getHistory,
  getQuote,
  maxDrawdown,
} from "@/lib/market";

// ─────────────────────────────────────────────────────────────
// Candidate selection — fit each name to the client's answers.
// ─────────────────────────────────────────────────────────────
function fitScore(f: Fundamentals, a: Answers): number {
  let s = 50;
  const growthy = f.beta >= 1.3 || (f.peRatio ?? 0) >= 40;
  const defensive = f.beta <= 0.7 || f.dividendYield >= 3;

  if (a.goal === "growth") s += growthy ? 22 : -12;
  if (a.goal === "preserve") s += defensive ? 22 : -14;
  if (a.goal === "income") s += f.dividendYield * 6;
  if (a.goal === "balanced") s += Math.abs(f.beta - 1) < 0.35 ? 12 : 0;

  if (a.horizon === "long") s += growthy ? 10 : 0;
  if (a.horizon === "short") s += defensive ? 12 : -8;

  if (a.riskComfort === "high") s += (f.beta - 1) * 14;
  if (a.riskComfort === "low") s += (1 - f.beta) * 16;

  if (a.sectors?.length) s += a.sectors.includes(f.sector) ? 18 : -6;
  if (a.existingConcentration === "tech" && f.sector === "Technology") s -= 20;
  if (a.esg === "yes" && (f.sector === "Energy" || f.symbol === "BA")) s -= 14;

  // quality nudge: mega caps get a small stability premium
  if (f.marketCap > 500) s += 4;
  return s;
}

export function selectCandidates(a: Answers, n = 12): Fundamentals[] {
  return universe(config.market.listing)
    .map((f) => ({ f, s: fitScore(f, a) }))
    .sort((x, y) => y.s - x.s)
    .slice(0, n)
    .map((x) => x.f);
}

// ─────────────────────────────────────────────────────────────
// Classifiers (deterministic, always available)
// ─────────────────────────────────────────────────────────────
export function growthTier(f: Fundamentals): GrowthTier {
  if (f.beta >= 1.4 || (f.peRatio ?? 0) >= 45) return "high";
  if (f.beta <= 0.75 || f.dividendYield >= 3) return "low";
  return "medium";
}
function riskTierFrom(vol: number, beta: number): RiskTier {
  const r = vol / 2 + beta * 12;
  if (r >= 34) return "aggressive";
  if (r <= 22) return "defensive";
  return "balanced";
}

// ─────────────────────────────────────────────────────────────
// AGENT 1 — Research
// ─────────────────────────────────────────────────────────────
export async function research(cands: Fundamentals[], a: Answers): Promise<ResearchNote[]> {
  const base: ResearchNote[] = cands.map((f) => ({
    symbol: f.symbol,
    name: f.name,
    sector: f.sector,
    thesis: simThesis(f, a),
    catalysts: simCatalysts(f),
    risks: simRisks(f),
    growthTier: growthTier(f),
    conviction: Math.max(35, Math.min(92, Math.round(fitScore(f, a)))),
  }));

  if (!config.ai.enabled) return base;
  try {
    const facts = cands
      .map(
        (f) =>
          `${f.symbol} (${f.name}) — ${f.sector}, ${f.listing}, ~$${f.marketCap}B cap, beta ${f.beta}, P/E ${f.peRatio ?? "n/a"}, div ${f.dividendYield}%`
      )
      .join("\n");
    const out = await askJson<{ notes: ResearchNote[] }>(
      systemFor("researcher"),
      `Client: ${clientLine(a)}.\nWrite a research note for each name below. For each, give a 1–2 sentence thesis, 2–3 catalysts, 2 risks, a growthTier of "high"|"medium"|"low", and a conviction 0–100.\nReturn {"notes":[{symbol,name,sector,thesis,catalysts:[],risks:[],growthTier,conviction}]}.\n\n${facts}`,
      2600
    );
    // merge: keep code-derived symbol/sector, take model narrative
    return base.map((b) => {
      const m = out.notes?.find((x) => x.symbol === b.symbol);
      return m ? { ...b, thesis: m.thesis, catalysts: m.catalysts, risks: m.risks, growthTier: m.growthTier ?? b.growthTier, conviction: m.conviction ?? b.conviction } : b;
    });
  } catch {
    return base;
  }
}

// ─────────────────────────────────────────────────────────────
// AGENT 2 — Risk (numbers always computed in code)
// ─────────────────────────────────────────────────────────────
export async function riskReview(cands: Fundamentals[]): Promise<RiskAssessment[]> {
  const out: RiskAssessment[] = [];
  for (const f of cands) {
    const hist = await getHistory(f.symbol, 1260);
    const vol = annualizedVol(hist);
    const mdd = maxDrawdown(hist.map((c) => c.close));
    const tier = riskTierFrom(vol, f.beta);
    const riskScore = Math.max(
      5,
      Math.min(98, Math.round(vol * 1.4 + f.beta * 14 - f.dividendYield * 3))
    );
    out.push({
      symbol: f.symbol,
      riskTier: tier,
      volatility: vol,
      beta: f.beta,
      maxDrawdown: mdd,
      riskScore,
      notes: simRiskNote(f, vol, mdd, tier),
    });
  }
  return out;
}

// ─────────────────────────────────────────────────────────────
// AGENT 3 — Debate
// ─────────────────────────────────────────────────────────────
export async function debate(
  notes: ResearchNote[],
  risks: RiskAssessment[]
): Promise<DebateVerdict[]> {
  const top = [...notes].sort((a, b) => b.conviction - a.conviction).slice(0, 5);
  const sim: DebateVerdict[] = top.map((n) => {
    const r = risks.find((x) => x.symbol === n.symbol);
    const score = Math.round(n.conviction - (r ? r.riskScore * 0.35 : 12));
    return {
      symbol: n.symbol,
      bull: [
        `The core thesis: ${n.thesis}`,
        `Catalyst on the table — ${n.catalysts[0] ?? "durable demand"}.`,
      ],
      bear: [
        `The bear pushes back — ${n.risks[0] ?? "valuation leaves little margin for error"}.`,
        r ? `Risk desk flags ${r.volatility}% volatility and a ${Math.abs(r.maxDrawdown)}% historical drawdown.` : "Crowded positioning could unwind fast.",
      ],
      verdict:
        score > 45
          ? `Survives cross-examination. Net conviction holds — a fund it.`
          : score > 20
          ? `Passes, but sized modestly. The bear case is real.`
          : `Interesting, not funded at size. The crux is unproven.`,
      score: Math.max(-100, Math.min(100, score)),
    };
  });

  if (!config.ai.enabled) return sim;
  try {
    const brief = top
      .map((n) => `${n.symbol}: thesis "${n.thesis}" | risks: ${n.risks.join("; ")}`)
      .join("\n");
    const out = await askJson<{ debates: DebateVerdict[] }>(
      systemFor("debater"),
      `Run the bull vs bear on each name. Give 2 bull points, 2 bear points, a one-line verdict, and a net score −100..100.\nReturn {"debates":[{symbol,bull:[],bear:[],verdict,score}]}.\n\n${brief}`,
      2200
    );
    return sim.map((s) => {
      const m = out.debates?.find((x) => x.symbol === s.symbol);
      return m ? { ...s, bull: m.bull ?? s.bull, bear: m.bear ?? s.bear, verdict: m.verdict ?? s.verdict, score: m.score ?? s.score } : s;
    });
  } catch {
    return sim;
  }
}

// ─────────────────────────────────────────────────────────────
// AGENT 5 — Optimizer (build the book). Numbers in code.
// ─────────────────────────────────────────────────────────────
export async function optimize(
  notes: ResearchNote[],
  risks: RiskAssessment[],
  a: Answers
): Promise<Allocation> {
  const riskById = new Map(risks.map((r) => [r.symbol, r]));

  // Score = conviction, penalised by risk when the client is cautious.
  const cautious = a.riskComfort === "low" || a.goal === "preserve";
  const aggressive = a.riskComfort === "high" || a.goal === "growth";
  const scored = notes
    .map((n) => {
      const r = riskById.get(n.symbol);
      const rp = r ? r.riskScore : 40;
      let s = n.conviction - (cautious ? rp * 0.6 : rp * 0.15);
      if (aggressive && n.growthTier === "high") s += 12;
      if (cautious && n.growthTier === "low") s += 12;
      return { n, r, s };
    })
    .sort((x, y) => y.s - x.s);

  const count = cautious ? 8 : aggressive ? 7 : 8;
  let picked = scored.slice(0, count);

  // Sector cap: no more than ~40% concept from one sector at selection stage.
  picked = enforceSectorSpread(picked, notes);

  // Raw weights from score, then cap single-name concentration.
  const maxWeight = aggressive ? 0.22 : cautious ? 0.16 : 0.18;
  const raw = picked.map((p) => Math.max(0.02, p.s));
  const sum = raw.reduce((a, b) => a + b, 0);
  let weights = raw.map((w) => Math.min(maxWeight, w / sum));
  // renormalise after capping
  const wsum = weights.reduce((a, b) => a + b, 0);
  weights = weights.map((w) => w / wsum);

  // Cash reserve for shorter horizons / lower risk comfort.
  const cashReserve =
    a.horizon === "short" ? 0.15 : cautious ? 0.1 : a.horizon === "long" ? 0.02 : 0.05;
  const investable = a.amount * (1 - cashReserve);

  const holdings: Holding[] = [];
  for (let i = 0; i < picked.length; i++) {
    const p = picked[i];
    const q = await getQuote(p.n.symbol);
    const dollars = Math.round(investable * weights[i]);
    const shares = Math.round((dollars / q.price) * 100) / 100;
    holdings.push({
      symbol: p.n.symbol,
      name: p.n.name,
      sector: p.n.sector,
      weight: Math.round(weights[i] * 1000) / 1000,
      dollars,
      shares,
      basePrice: q.price,
      growthTier: p.n.growthTier,
      riskTier: p.r?.riskTier ?? "balanced",
      thesis: p.n.thesis,
    });
  }

  const expReturn = expectedReturn(holdings, a);
  const expVol = Math.round(
    holdings.reduce((acc, h) => {
      const r = riskById.get(h.symbol);
      return acc + (r?.volatility ?? 20) * h.weight;
    }, 0) * 10
  ) / 10;

  let rationale = simRationale(holdings, a, cashReserve);
  if (config.ai.enabled) {
    try {
      const list = holdings
        .map((h) => `${h.symbol} ${(h.weight * 100).toFixed(0)}% (${h.growthTier} growth, ${h.riskTier} risk)`)
        .join(", ");
      rationale = await ask(
        systemFor("optimizer"),
        `Client: ${clientLine(a)}. I built this book: ${list}, with a ${(cashReserve * 100).toFixed(0)}% cash reserve. In 2 short paragraphs, explain to the client in plain English why this shape fits their goals and risk budget, and how it's diversified. No bullet points.`,
        700
      );
    } catch {
      /* keep sim rationale */
    }
  }

  return {
    holdings,
    cashReserve: Math.round(a.amount * cashReserve),
    rationale,
    expectedReturnPct: expReturn,
    expectedVolPct: expVol,
  };
}

function enforceSectorSpread<T extends { n: ResearchNote }>(picked: T[], _all: ResearchNote[]): T[] {
  const perSector: Record<string, number> = {};
  const out: T[] = [];
  for (const p of picked) {
    const c = perSector[p.n.sector] ?? 0;
    if (c >= 3) continue; // at most 3 names per sector
    perSector[p.n.sector] = c + 1;
    out.push(p);
  }
  return out;
}

function expectedReturn(holdings: Holding[], a: Answers): number {
  const tierBase: Record<GrowthTier, number> = { high: 14, medium: 9, low: 6 };
  const gross = holdings.reduce((acc, h) => acc + tierBase[h.growthTier] * h.weight, 0);
  const tilt = a.goal === "income" ? -1 : a.goal === "growth" ? 1.5 : 0;
  return Math.round((gross + tilt) * 10) / 10;
}

// ─────────────────────────────────────────────────────────────
// AGENT 4 — Tester (backtest allocation vs SPY buy & hold)
// ─────────────────────────────────────────────────────────────
export async function backtest(alloc: Allocation): Promise<BacktestResult> {
  const years = 5;
  const days = years * 252;
  const histories = await Promise.all(
    alloc.holdings.map(async (h) => ({
      weight: h.weight,
      hist: await getHistory(h.symbol, days),
    }))
  );
  const spy = await getHistory("SPY", days);
  const len = Math.min(spy.length, ...histories.map((h) => h.hist.length));

  const stratNorm: number[] = [];
  const benchNorm: number[] = [];
  for (let i = 0; i < len; i++) {
    let s = 0;
    for (const h of histories) {
      const base = h.hist[h.hist.length - len].close;
      s += (h.hist[h.hist.length - len + i].close / base) * h.weight;
    }
    const spyBase = spy[spy.length - len].close;
    stratNorm.push(s);
    benchNorm.push(spy[spy.length - len + i].close / spyBase);
  }

  const total = (stratNorm[stratNorm.length - 1] - 1) * 100;
  const bench = (benchNorm[benchNorm.length - 1] - 1) * 100;
  const mdd = maxDrawdown(stratNorm);

  // Sharpe from monthly returns of the strategy series
  const step = Math.max(1, Math.floor(len / 60));
  const monthly: number[] = [];
  for (let i = step; i < len; i += step) {
    monthly.push(stratNorm[i] / stratNorm[i - step] - 1);
  }
  const mean = monthly.reduce((a, b) => a + b, 0) / monthly.length;
  const sd = Math.sqrt(monthly.reduce((a, b) => a + (b - mean) ** 2, 0) / monthly.length);
  const periodsPerYear = 12;
  const sharpe = sd ? (mean * periodsPerYear) / (sd * Math.sqrt(periodsPerYear)) : 0;
  const winRate = (monthly.filter((r) => r > 0).length / monthly.length) * 100;
  const gains = monthly.filter((r) => r > 0).reduce((a, b) => a + b, 0);
  const losses = Math.abs(monthly.filter((r) => r < 0).reduce((a, b) => a + b, 0));
  const profitFactor = losses ? gains / losses : gains ? 9.9 : 1;

  // downsample equity curve to ~60 points for charts
  const curve: BacktestResult["equityCurve"] = [];
  for (let i = 0; i < len; i += step) {
    curve.push({
      t: spy[spy.length - len + i].t,
      strategy: Math.round(stratNorm[i] * 1000) / 1000,
      benchmark: Math.round(benchNorm[i] * 1000) / 1000,
    });
  }

  return {
    totalReturnPct: Math.round(total * 10) / 10,
    benchmarkReturnPct: Math.round(bench * 10) / 10,
    maxDrawdownPct: mdd,
    sharpe: Math.round(sharpe * 100) / 100,
    winRatePct: Math.round(winRate * 10) / 10,
    profitFactor: Math.round(profitFactor * 100) / 100,
    equityCurve: curve,
    period: `${new Date().getFullYear() - years}–${new Date().getFullYear()} · 5y out-of-sample`,
  };
}

// ─────────────────────────────────────────────────────────────
// Full pipeline
// ─────────────────────────────────────────────────────────────
export async function runFirm(a: Answers) {
  const cands = selectCandidates(a);
  const [notes, risks] = await Promise.all([research(cands, a), riskReview(cands)]);
  const verdicts = await debate(notes, risks);
  const allocation = await optimize(notes, risks, a);
  const bt = await backtest(allocation);
  return {
    engine: engineName(),
    research: notes,
    risk: risks,
    debate: verdicts,
    allocation,
    backtest: bt,
  };
}

// Run a single agent against one ticker (for the "talk to one" mode).
export async function runSingleAgent(agentId: string, symbol: string, a?: Answers) {
  const meta = findMeta(symbol);
  if (!meta) throw new Error(`Unknown symbol ${symbol}`);
  const answers: Answers = a ?? defaultAnswers();
  switch (agentId) {
    case "researcher":
      return { research: (await research([meta], answers))[0] };
    case "risk":
      return { risk: (await riskReview([meta]))[0] };
    case "debater": {
      const n = await research([meta], answers);
      const r = await riskReview([meta]);
      return { debate: (await debate(n, r))[0] };
    }
    case "tester": {
      // single-name backtest vs SPY
      const alloc: Allocation = {
        holdings: [
          {
            symbol: meta.symbol, name: meta.name, sector: meta.sector,
            weight: 1, dollars: 10000, shares: 0, basePrice: 0,
            growthTier: growthTier(meta), riskTier: "balanced", thesis: "",
          },
        ],
        cashReserve: 0, rationale: "", expectedReturnPct: 0, expectedVolPct: 0,
      };
      return { backtest: await backtest(alloc) };
    }
    case "optimizer": {
      const n = await research([meta], answers);
      const r = await riskReview([meta]);
      return { allocation: await optimize(n, r, answers) };
    }
    default:
      throw new Error("Unknown agent");
  }
}

// ─────────────────────────────────────────────────────────────
// Daily pick → blog
// ─────────────────────────────────────────────────────────────
export async function dailyPick(): Promise<BlogPost> {
  const a = defaultAnswers();
  const cands = selectCandidates(a, 10);
  const notes = await research(cands, a);
  const risks = await riskReview(cands);
  const verdicts = await debate(notes, risks);
  const best = [...verdicts].sort((x, y) => y.score - x.score)[0];
  const note = notes.find((n) => n.symbol === best.symbol)!;
  const date = new Date().toISOString().slice(0, 10);

  let body: string[] = [
    `Overnight, the desk screened the NASDAQ and NYSE large-cap universe and re-ran the debate. Today the strongest net conviction landed on ${note.name} (${note.symbol}).`,
    `Research view: ${note.thesis} Growth is classified ${note.growthTier}. Catalysts we're watching: ${note.catalysts.join("; ")}.`,
    `The bull case: ${best.bull.join(" ")} The bear case: ${best.bear.join(" ")}`,
    `Verdict: ${best.verdict} This is a research note, not personal advice — every investor's risk budget is different.`,
  ];
  let title = `${note.name} tops the desk's overnight screen`;
  let dek = `Net conviction ${best.score} after debate · ${note.sector}`;

  if (config.ai.enabled) {
    try {
      const md = await ask(
        systemFor("debater"),
        `Write a short "AI Analyst of the Day" blog post for retail investors about ${note.name} (${note.symbol}), sector ${note.sector}, growth tier ${note.growthTier}. Thesis: ${note.thesis}. Bull: ${best.bull.join(" ")} Bear: ${best.bear.join(" ")}. 3–4 short paragraphs, plain English, end with a one-line reminder that it's education not advice. Return just the prose, blank line between paragraphs.`,
        900
      );
      const paras = md.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
      if (paras.length) body = paras;
      title = `Analyst of the Day: ${note.name} (${note.symbol})`;
    } catch {
      /* keep sim body */
    }
  }

  return {
    slug: `${date}-${note.symbol.toLowerCase().replace(/[^a-z0-9]/g, "")}`,
    date: new Date().toISOString(),
    title,
    dek,
    pick: { symbol: note.symbol, name: note.name, growthTier: note.growthTier },
    body,
    author: "debater",
    engine: engineName(),
  };
}

// ─────────────────────────────────────────────────────────────
// helpers — simulated narrative + defaults
// ─────────────────────────────────────────────────────────────
export function defaultAnswers(): Answers {
  return { amount: 10000, horizon: "long", goal: "balanced", riskComfort: "medium" };
}
function clientLine(a: Answers): string {
  return `$${a.amount.toLocaleString()}, ${a.horizon}-term, goal=${a.goal}, risk comfort=${a.riskComfort}${a.sectors?.length ? `, sectors: ${a.sectors.join("/")}` : ""}`;
}
function simThesis(f: Fundamentals, a: Answers): string {
  const g = growthTier(f);
  const lead =
    g === "high"
      ? `${f.name} is a growth engine in ${f.sector.toLowerCase()}`
      : g === "low"
      ? `${f.name} is a steady, cash-generative anchor in ${f.sector.toLowerCase()}`
      : `${f.name} is a quality compounder in ${f.sector.toLowerCase()}`;
  const tail =
    a.goal === "income" && f.dividendYield >= 2
      ? ` It pays a ${f.dividendYield}% dividend that supports the income goal.`
      : a.horizon === "long"
      ? " The multi-year setup rewards patience."
      : " It fits the near-term, lower-drama part of the plan.";
  return `${lead}, with a ~$${f.marketCap}B franchise and beta ${f.beta}.${tail}`;
}
function simCatalysts(f: Fundamentals): string[] {
  const c: Record<string, string[]> = {
    Technology: ["AI-driven product cycle", "operating-margin expansion", "buyback support"],
    Communication: ["ad-market recovery", "engagement and pricing power", "cost discipline"],
    "Consumer Cyclical": ["consumer resilience", "share gains", "margin normalization"],
    "Consumer Defensive": ["pricing power", "volume stabilization", "dividend growth"],
    Healthcare: ["pipeline milestones", "demographic demand", "pricing durability"],
    Financials: ["net-interest tailwinds", "capital return", "credit normalization"],
    Industrials: ["reshoring and capex cycle", "backlog conversion", "pricing"],
    Energy: ["disciplined capex", "shareholder returns", "commodity leverage"],
    Utilities: ["rate-base growth", "electrification demand", "regulated returns"],
    "Real Estate": ["secular demand for towers", "escalators in leases", "rate relief"],
  };
  return (c[f.sector] ?? ["durable demand", "margin expansion", "capital return"]).slice(0, 3);
}
function simRisks(f: Fundamentals): string[] {
  const base = [
    f.beta >= 1.3 ? "high volatility can produce sharp drawdowns" : "slower growth than the market",
    (f.peRatio ?? 0) >= 40 ? "a rich multiple leaves little margin for error" : "cyclical demand swings",
  ];
  if (f.sector === "Energy") base.push("commodity-price sensitivity");
  return base.slice(0, 2);
}
function simRiskNote(f: Fundamentals, vol: number, mdd: number, tier: RiskTier): string {
  return `${f.name} runs ~${vol}% annualized volatility with a beta of ${f.beta}; its worst historical drawdown in the window was about ${Math.abs(mdd)}%. I classify it ${tier}. Size it accordingly — conviction never overrides position size.`;
}
function simRationale(holdings: Holding[], a: Answers, cash: number): string {
  const sectors = Array.from(new Set(holdings.map((h) => h.sector)));
  const high = holdings.filter((h) => h.growthTier === "high").length;
  return `This book holds ${holdings.length} names across ${sectors.length} sectors (${sectors.join(", ")}), with a ${(cash * 100).toFixed(0)}% cash reserve. It's shaped to your ${a.goal} goal over a ${a.horizon} horizon and a ${a.riskComfort} tolerance for volatility — ${high} higher-growth positions for upside, balanced by steadier names so a single bad print can't sink the whole plan. No single position dominates; that's deliberate. We'd rather be consistent than heroic.`;
}
