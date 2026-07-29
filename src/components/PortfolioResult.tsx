import type { PortfolioRecord } from "@/lib/types";
import { AllocationDonut, EquityCurve } from "./Charts";
import { GrowthBadge, RiskBadge, SectionLabel, Stat } from "./ui";
import { Avatar } from "./Avatar";
import { PERSONAS } from "@/lib/agents/personas";

const money = (n: number) => "$" + Math.round(n).toLocaleString();
const pct = (n: number) => `${n > 0 ? "+" : ""}${n.toFixed(1)}%`;

export function PortfolioResult({ rec }: { rec: PortfolioRecord }) {
  const { allocation: a, backtest: bt } = rec;
  const beats = bt.totalReturnPct - bt.benchmarkReturnPct;
  return (
    <div className="space-y-12">
      {/* headline stats */}
      <div>
        <SectionLabel n="01">The book Priya built</SectionLabel>
        <p className="mt-4 max-w-3xl text-[15px] leading-relaxed text-ink/80">{a.rationale}</p>
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Invested" value={money(rec.answers.amount - a.cashReserve)} sub={`${a.holdings.length} positions`} />
          <Stat label="Cash reserve" value={money(a.cashReserve)} tone="brass" />
          <Stat label="Est. annual return" value={pct(a.expectedReturnPct)} tone="gain" sub="modeled, not promised" />
          <Stat label="Est. volatility" value={`${a.expectedVolPct.toFixed(0)}%`} sub="annualized" />
        </div>
      </div>

      {/* allocation + donut */}
      <div className="grid gap-8 lg:grid-cols-[1fr_320px]">
        <div>
          <SectionLabel n="02">Holdings</SectionLabel>
          <div className="mt-4 overflow-hidden rounded-xl2 border border-line">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-forest2/95 font-mono text-[10px] uppercase tracking-wider text-ivory/80">
                  <th className="px-3 py-2 text-left">Name</th>
                  <th className="px-3 py-2 text-right">Weight</th>
                  <th className="px-3 py-2 text-right">Dollars</th>
                  <th className="px-3 py-2 text-right">Shares</th>
                  <th className="hidden px-3 py-2 text-left sm:table-cell">Profile</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {a.holdings.map((h) => (
                  <tr key={h.symbol} className="bg-white/50">
                    <td className="px-3 py-2.5">
                      <div className="font-mono font-medium">{h.symbol}</div>
                      <div className="text-xs text-sage">{h.name} · {h.sector}</div>
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono tabular">{(h.weight * 100).toFixed(1)}%</td>
                    <td className="px-3 py-2.5 text-right font-mono tabular">{money(h.dollars)}</td>
                    <td className="px-3 py-2.5 text-right font-mono tabular">{h.shares}</td>
                    <td className="hidden px-3 py-2.5 sm:table-cell">
                      <div className="flex flex-wrap gap-1">
                        <GrowthBadge tier={h.growthTier} />
                        <RiskBadge tier={h.riskTier} />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <div className="card p-4">
          <div className="eyebrow">Allocation</div>
          <AllocationDonut holdings={a.holdings} />
          <div className="mt-2 grid grid-cols-2 gap-1 text-xs">
            {a.holdings.map((h, i) => (
              <div key={h.symbol} className="flex items-center gap-1.5 text-ink/70">
                <span className="inline-block h-2 w-2 rounded-full" style={{ background: PIE[i % PIE.length] }} />
                <span className="font-mono">{h.symbol}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* backtest */}
      <div>
        <SectionLabel n="03">Ethan's backtest · {bt.period}</SectionLabel>
        <div className="mt-4 grid gap-6 lg:grid-cols-[1fr_300px]">
          <div className="card p-4">
            <div className="mb-2 flex items-center justify-between">
              <span className="eyebrow">Growth of $1 vs S&P 500</span>
              <span className={`font-mono text-xs ${beats >= 0 ? "text-gain" : "text-loss"}`}>
                {beats >= 0 ? "▲" : "▼"} {pct(beats)} vs benchmark
              </span>
            </div>
            <EquityCurve data={bt.equityCurve} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Total return" value={pct(bt.totalReturnPct)} tone={bt.totalReturnPct >= 0 ? "gain" : "loss"} />
            <Stat label="Max drawdown" value={`${bt.maxDrawdownPct.toFixed(1)}%`} tone="loss" />
            <Stat label="Sharpe" value={bt.sharpe.toFixed(2)} />
            <Stat label="Win rate" value={`${bt.winRatePct.toFixed(0)}%`} />
          </div>
        </div>
        <p className="mt-2 font-mono text-[11px] text-sage">
          Backtests are hypothetical and can overstate real-world results. Past performance never guarantees future returns.
        </p>
      </div>

      {/* debate */}
      <div>
        <SectionLabel n="04">Sofia's debate — bull vs bear</SectionLabel>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {rec.debate.map((d) => (
            <div key={d.symbol} className="card p-4">
              <div className="flex items-center justify-between">
                <span className="font-mono font-medium">{d.symbol}</span>
                <span className={`chip border ${d.score > 30 ? "border-gain/30 text-gain" : d.score > 0 ? "border-brass/30 text-brass" : "border-loss/30 text-loss"}`}>
                  net {d.score > 0 ? "+" : ""}{d.score}
                </span>
              </div>
              <div className="mt-3 space-y-2 text-sm">
                <div>
                  <span className="font-mono text-[10px] uppercase tracking-wider text-gain">Bull</span>
                  <ul className="mt-1 list-disc pl-4 text-ink/80">{d.bull.map((b, i) => <li key={i}>{b}</li>)}</ul>
                </div>
                <div>
                  <span className="font-mono text-[10px] uppercase tracking-wider text-loss">Bear</span>
                  <ul className="mt-1 list-disc pl-4 text-ink/80">{d.bear.map((b, i) => <li key={i}>{b}</li>)}</ul>
                </div>
              </div>
              <div className="mt-3 border-t border-line pt-2 text-sm italic text-ink/70">{d.verdict}</div>
            </div>
          ))}
        </div>
      </div>

      {/* research + risk detail */}
      <div>
        <SectionLabel n="05">Research notes & risk</SectionLabel>
        <div className="mt-4 space-y-3">
          {rec.research
            .filter((n) => a.holdings.some((h) => h.symbol === n.symbol))
            .map((n) => {
              const r = rec.risk.find((x) => x.symbol === n.symbol);
              return (
                <details key={n.symbol} className="card group p-4">
                  <summary className="flex cursor-pointer list-none items-center justify-between">
                    <span className="flex items-center gap-3">
                      <span className="font-mono font-medium">{n.symbol}</span>
                      <GrowthBadge tier={n.growthTier} />
                      {r && <RiskBadge tier={r.riskTier} />}
                    </span>
                    <span className="font-mono text-xs text-sage">conviction {n.conviction} · risk {r?.riskScore ?? "–"}</span>
                  </summary>
                  <div className="mt-3 grid gap-4 text-sm md:grid-cols-2">
                    <div>
                      <div className="flex items-center gap-2"><Avatar id="researcher" accent={PERSONAS.researcher.accent} size={22} ring={false} /><span className="font-mono text-[11px] text-sage">MAYA · RESEARCH</span></div>
                      <p className="mt-1 text-ink/80">{n.thesis}</p>
                      <p className="mt-2 text-xs text-sage">Catalysts: {n.catalysts.join("; ")}</p>
                      <p className="text-xs text-sage">Risks: {n.risks.join("; ")}</p>
                    </div>
                    {r && (
                      <div>
                        <div className="flex items-center gap-2"><Avatar id="risk" accent={PERSONAS.risk.accent} size={22} ring={false} /><span className="font-mono text-[11px] text-sage">MARCUS · RISK</span></div>
                        <p className="mt-1 text-ink/80">{r.notes}</p>
                        <div className="mt-2 grid grid-cols-3 gap-2 font-mono text-xs text-ink/70">
                          <span>vol {r.volatility}%</span><span>β {r.beta}</span><span>DD {r.maxDrawdown}%</span>
                        </div>
                      </div>
                    )}
                  </div>
                </details>
              );
            })}
        </div>
      </div>
    </div>
  );
}

const PIE = ["#173D30", "#2E7D46", "#B8892B", "#0F6E8C", "#6E7F6A", "#B23A32", "#D9B25A", "#254A3C"];
