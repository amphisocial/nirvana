import type { PortfolioRecord, SessionEvent } from "@/lib/types";
import { PERSONAS } from "@/lib/agents/personas";
import { Avatar } from "./Avatar";
import { GrowthBadge, RiskBadge, SectionLabel } from "./ui";

function ev(session: SessionEvent[] | undefined, stage: string): SessionEvent | undefined {
  return session?.find((e) => e.stage === stage);
}
function evAll(session: SessionEvent[] | undefined, stage: string): SessionEvent[] {
  return session?.filter((e) => e.stage === stage) ?? [];
}

export function AgentWorkLog({ rec }: { rec: PortfolioRecord }) {
  const s = rec.session;
  const held = new Set(rec.allocation.holdings.map((h) => h.symbol));
  const ctx = ev(s, "context");
  const propose = ev(s, "propose");
  const validate = ev(s, "validate");
  const rounds = evAll(s, "debate_round");

  return (
    <div>
      <SectionLabel n="06">The desk's working papers</SectionLabel>
      <p className="mt-3 max-w-2xl text-sm text-ink/70">
        The full session — every employee's actual work, in order. Expand any analyst to review what they did.
      </p>

      <div className="mt-5 space-y-3">
        {/* MAYA — Research */}
        <AgentPanel id="researcher" defaultOpen summary="Read the market, proposed candidates, wrote the theses">
          {ctx && (
            <Block label="Market read">
              <p>
                Tape was <b>{ctx.breadth}</b>. Leading sectors: {(ctx.leaders || []).join(", ")}. Lagging: {(ctx.laggards || []).join(", ")}.
              </p>
              {Array.isArray(ctx.headlines) && ctx.headlines.length > 0 && (
                <ul className="mt-1 list-disc pl-5 text-ink/70">
                  {ctx.headlines.map((h: string, i: number) => <li key={i}>{h}</li>)}
                </ul>
              )}
            </Block>
          )}
          {propose && (
            <Block label="Candidates proposed">
              <p className="font-mono text-xs">{(propose.symbols || []).join(", ")}</p>
            </Block>
          )}
          {validate && (
            <Block label="Validated on the live terminal">
              <p>
                Confirmed {(validate.kept || []).length}
                {(validate.dropped || []).length ? <> · dropped {(validate.dropped || []).length}: <span className="font-mono text-xs text-loss">{(validate.dropped || []).join(", ")}</span></> : null}
              </p>
            </Block>
          )}
          <Block label="Research notes">
            <div className="space-y-2">
              {rec.research.map((n) => (
                <div key={n.symbol} className={`rounded-lg border border-line p-3 ${held.has(n.symbol) ? "bg-white" : "bg-ink/[0.02] opacity-70"}`}>
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-medium">{n.symbol}</span>
                    <GrowthBadge tier={n.growthTier} />
                    <span className="chip">conviction {n.conviction}</span>
                    {!held.has(n.symbol) && <span className="chip text-loss">cut</span>}
                  </div>
                  <p className="mt-1 text-ink/80">{n.thesis}</p>
                  <p className="mt-1 text-xs text-sage">Catalysts: {n.catalysts.join("; ")}</p>
                  <p className="text-xs text-sage">Risks: {n.risks.join("; ")}</p>
                </div>
              ))}
            </div>
          </Block>
        </AgentPanel>

        {/* MARCUS — Risk */}
        <AgentPanel id="risk" summary="Scored volatility, beta and drawdown on every candidate">
          <div className="overflow-hidden rounded-lg border border-line">
            <table className="w-full text-sm">
              <thead><tr className="bg-ink/[0.03] font-mono text-[10px] uppercase tracking-wider text-sage">
                <th className="px-3 py-2 text-left">Symbol</th><th className="px-3 py-2 text-left">Tier</th>
                <th className="px-3 py-2 text-right">Vol</th><th className="px-3 py-2 text-right">β</th>
                <th className="px-3 py-2 text-right">Max DD</th><th className="px-3 py-2 text-right">Score</th>
              </tr></thead>
              <tbody className="divide-y divide-line">
                {rec.risk.map((r) => (
                  <tr key={r.symbol} className={held.has(r.symbol) ? "" : "opacity-60"}>
                    <td className="px-3 py-2 font-mono">{r.symbol}</td>
                    <td className="px-3 py-2"><RiskBadge tier={r.riskTier} /></td>
                    <td className="px-3 py-2 text-right font-mono tabular">{r.volatility}%</td>
                    <td className="px-3 py-2 text-right font-mono tabular">{r.beta}</td>
                    <td className="px-3 py-2 text-right font-mono tabular">{r.maxDrawdown}%</td>
                    <td className="px-3 py-2 text-right font-mono tabular">{r.riskScore}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </AgentPanel>

        {/* SOFIA — Debate */}
        <AgentPanel id="debater" summary={`Ran ${rounds.length || "the"} knockout round${rounds.length === 1 ? "" : "s"}, then delivered verdicts`}>
          {rounds.length > 0 && (
            <Block label="Knockout rounds">
              <ol className="space-y-2">
                {rounds.map((r, i) => (
                  <li key={i} className="rounded-lg border border-line bg-white p-3">
                    <div className="font-mono text-[11px] uppercase tracking-wider text-brand">Round {r.round}/{r.totalRounds} · {r.focus}</div>
                    <ul className="mt-1 space-y-0.5">
                      {(r.cut || []).map((c: any, j: number) => (
                        <li key={j} className="text-ink/80"><span className="font-mono text-loss">✕ {c.symbol}</span> — {c.reason}</li>
                      ))}
                    </ul>
                    <div className="mt-1 font-mono text-[11px] text-sage">{(r.remaining || []).length} still standing</div>
                  </li>
                ))}
              </ol>
            </Block>
          )}
          <Block label="Final verdicts">
            <div className="space-y-2">
              {rec.debate.map((d) => (
                <div key={d.symbol} className="rounded-lg border border-line bg-white p-3">
                  <div className="flex items-center justify-between">
                    <span className="font-mono font-medium">{d.symbol}</span>
                    <span className={`chip ${d.score > 0 ? "text-gain" : "text-loss"}`}>net {d.score > 0 ? "+" : ""}{d.score}</span>
                  </div>
                  <p className="mt-1 text-xs"><span className="font-mono text-[10px] uppercase text-gain">Bull</span> {d.bull.join(" ")}</p>
                  <p className="text-xs"><span className="font-mono text-[10px] uppercase text-loss">Bear</span> {d.bear.join(" ")}</p>
                  <p className="mt-1 text-sm italic text-ink/70">{d.verdict}</p>
                </div>
              ))}
            </div>
          </Block>
        </AgentPanel>

        {/* ETHAN — Testing */}
        <AgentPanel id="tester" summary="Backtested the final book against the S&P 500">
          <Block label={`Backtest · ${rec.backtest.period}`}>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <Metric k="Total return" v={`${rec.backtest.totalReturnPct}%`} />
              <Metric k="vs S&P 500" v={`${rec.backtest.benchmarkReturnPct}%`} />
              <Metric k="Max drawdown" v={`${rec.backtest.maxDrawdownPct}%`} />
              <Metric k="Sharpe" v={rec.backtest.sharpe.toFixed(2)} />
              <Metric k="Win rate" v={`${rec.backtest.winRatePct}%`} />
              <Metric k="Profit factor" v={rec.backtest.profitFactor.toFixed(2)} />
            </div>
            <p className="mt-2 font-mono text-[11px] text-sage">Hypothetical; past performance never guarantees future results.</p>
          </Block>
        </AgentPanel>

        {/* PRIYA — Construction */}
        <AgentPanel id="optimizer" summary="Sized the survivors into the final book">
          <Block label="Construction rationale"><p>{rec.allocation.rationale}</p></Block>
          <Block label="Final weights">
            <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
              {rec.allocation.holdings.map((h) => (
                <div key={h.symbol} className="flex justify-between rounded border border-line px-2 py-1 font-mono text-xs">
                  <span>{h.symbol}</span><span>{(h.weight * 100).toFixed(1)}%</span>
                </div>
              ))}
            </div>
          </Block>
        </AgentPanel>
      </div>
    </div>
  );
}

function AgentPanel({ id, summary, children, defaultOpen = false }: { id: keyof typeof PERSONAS; summary: string; children: React.ReactNode; defaultOpen?: boolean }) {
  const p = PERSONAS[id];
  return (
    <details open={defaultOpen} className="card overflow-hidden">
      <summary className="flex cursor-pointer list-none items-center gap-3 p-4">
        <Avatar id={p.id} accent={p.accent} size={40} />
        <div className="flex-1">
          <div className="font-display font-bold leading-tight">{p.name} <span className="text-sage">· {p.title}</span></div>
          <div className="text-xs text-sage">{summary}</div>
        </div>
        <span className="font-mono text-xs text-sage">▾</span>
      </summary>
      <div className="space-y-4 border-t border-line p-4 text-sm">{children}</div>
    </details>
  );
}
function Block({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="eyebrow mb-1.5">{label}</div>
      {children}
    </div>
  );
}
function Metric({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-lg border border-line bg-white p-2 text-center">
      <div className="font-mono text-[10px] uppercase tracking-wider text-sage">{k}</div>
      <div className="font-display text-lg font-bold tabular">{v}</div>
    </div>
  );
}
