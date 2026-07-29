"use client";
import { useState } from "react";
import type { AgentPersona } from "@/lib/types";
import { Avatar } from "./Avatar";
import { GrowthBadge, RiskBadge } from "./ui";
import { EquityCurve } from "./Charts";

const SUGGESTED = ["AAPL", "NVDA", "COST", "LLY", "JPM", "XOM"];

export function AgentConsole({ persona }: { persona: AgentPersona }) {
  const [symbol, setSymbol] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  const [messages, setMessages] = useState<{ role: "user" | "assistant"; content: string }[]>([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);

  async function run(sym: string) {
    const s = sym.trim().toUpperCase();
    if (!s) return;
    setRunning(true); setError(null); setResult(null);
    try {
      const res = await fetch("/api/agents/run", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: persona.id, symbol: s }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");
      setResult({ symbol: s, ...data.result });
    } catch (e: any) { setError(e.message); }
    finally { setRunning(false); }
  }

  async function send() {
    const content = input.trim();
    if (!content) return;
    const next = [...messages, { role: "user" as const, content }];
    setMessages(next); setInput(""); setThinking(true);
    try {
      const res = await fetch("/api/agents/chat", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: persona.id, messages: next, symbol: result?.symbol }),
      });
      const data = await res.json();
      setMessages([...next, { role: "assistant", content: data.reply || data.error || "…" }]);
    } catch { setMessages([...next, { role: "assistant", content: "Line dropped — try again." }]); }
    finally { setThinking(false); }
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_380px]">
      {/* left — run */}
      <div>
        <div className="flex items-center gap-2">
          <input
            value={symbol} onChange={(e) => setSymbol(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && run(symbol)}
            placeholder="Ticker, e.g. AAPL"
            className="w-full rounded-full border border-line bg-white/60 px-5 py-3 font-mono uppercase tracking-wider outline-none focus:border-brass"
          />
          <button onClick={() => run(symbol)} disabled={running} className="btn-primary whitespace-nowrap disabled:opacity-50">
            {running ? "Working…" : `Run ${persona.desk}`}
          </button>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          <span className="font-mono text-[11px] text-sage">Try:</span>
          {SUGGESTED.map((s) => (
            <button key={s} onClick={() => { setSymbol(s); run(s); }} className="chip hover:border-brass">{s}</button>
          ))}
        </div>

        {error && <div className="mt-4 rounded-lg border border-loss/30 bg-loss/5 p-3 text-sm text-loss">{error}</div>}

        {running && (
          <div className="mt-6 animate-pulse rounded-xl2 border border-line bg-white/40 p-6 text-sm text-sage">
            {persona.name} is reviewing the name…
          </div>
        )}

        {result && !running && (
          <div className="mt-6 card p-5">
            <div className="mb-3 flex items-center justify-between">
              <span className="font-mono text-lg font-medium">{result.symbol}</span>
              <span className="eyebrow">{persona.desk} desk note</span>
            </div>
            <AgentOutput result={result} />
          </div>
        )}
      </div>

      {/* right — chat */}
      <div className="flex h-[560px] flex-col rounded-xl2 border border-lineDark bg-forest2 text-ivory">
        <div className="flex items-center gap-3 border-b border-lineDark p-4">
          <Avatar id={persona.id} accent={persona.accent} size={40} />
          <div>
            <div className="font-display font-bold leading-none">{persona.name}</div>
            <div className="font-mono text-[10px] uppercase tracking-wider text-ivory/60">{persona.title}</div>
          </div>
          <span className="ml-auto flex items-center gap-1.5 font-mono text-[10px] text-gain">
            <span className="h-1.5 w-1.5 rounded-full bg-gain" /> online
          </span>
        </div>
        <div className="term-scroll flex-1 space-y-3 overflow-y-auto p-4 text-sm">
          {messages.length === 0 && (
            <p className="text-ivory/50">Ask {persona.name.split(" ")[0]} anything — {persona.role.toLowerCase()}</p>
          )}
          {messages.map((m, i) => (
            <div key={i} className={m.role === "user" ? "text-right" : ""}>
              <div className={`inline-block max-w-[85%] whitespace-pre-wrap rounded-2xl px-3 py-2 ${m.role === "user" ? "bg-brass text-ink" : "bg-ink/40 text-ivory"}`}>
                {m.content}
              </div>
            </div>
          ))}
          {thinking && <div className="text-ivory/50">{persona.name.split(" ")[0]} is typing…</div>}
        </div>
        <div className="flex gap-2 border-t border-lineDark p-3">
          <input
            value={input} onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder="Type a message…"
            className="w-full rounded-full bg-ink/50 px-4 py-2 text-sm outline-none placeholder:text-ivory/40"
          />
          <button onClick={send} className="btn-brass px-4 py-2 text-sm">Send</button>
        </div>
      </div>
    </div>
  );
}

function AgentOutput({ result }: { result: any }) {
  if (result.research) {
    const n = result.research;
    return (
      <div className="space-y-3 text-sm">
        <div className="flex gap-2"><GrowthBadge tier={n.growthTier} /><span className="chip">conviction {n.conviction}</span></div>
        <p className="text-ink/85">{n.thesis}</p>
        <p className="text-xs text-sage">Catalysts: {n.catalysts.join("; ")}</p>
        <p className="text-xs text-sage">Risks: {n.risks.join("; ")}</p>
      </div>
    );
  }
  if (result.risk) {
    const r = result.risk;
    return (
      <div className="space-y-3 text-sm">
        <RiskBadge tier={r.riskTier} />
        <p className="text-ink/85">{r.notes}</p>
        <div className="grid grid-cols-4 gap-2 font-mono text-xs text-ink/70">
          <span>vol {r.volatility}%</span><span>β {r.beta}</span><span>DD {r.maxDrawdown}%</span><span>score {r.riskScore}</span>
        </div>
      </div>
    );
  }
  if (result.debate) {
    const d = result.debate;
    return (
      <div className="space-y-3 text-sm">
        <span className={`chip border ${d.score > 0 ? "border-gain/30 text-gain" : "border-loss/30 text-loss"}`}>net {d.score > 0 ? "+" : ""}{d.score}</span>
        <div><span className="font-mono text-[10px] uppercase text-gain">Bull</span><ul className="list-disc pl-4 text-ink/80">{d.bull.map((b: string, i: number) => <li key={i}>{b}</li>)}</ul></div>
        <div><span className="font-mono text-[10px] uppercase text-loss">Bear</span><ul className="list-disc pl-4 text-ink/80">{d.bear.map((b: string, i: number) => <li key={i}>{b}</li>)}</ul></div>
        <p className="italic text-ink/70">{d.verdict}</p>
      </div>
    );
  }
  if (result.backtest) {
    const b = result.backtest;
    return (
      <div className="space-y-3 text-sm">
        <div className="grid grid-cols-3 gap-2 font-mono text-xs">
          <span>return {b.totalReturnPct}%</span><span>vs SPY {b.benchmarkReturnPct}%</span><span>Sharpe {b.sharpe}</span>
        </div>
        <EquityCurve data={b.equityCurve} />
        <p className="text-[11px] text-sage">Hypothetical single-name backtest. Not a prediction.</p>
      </div>
    );
  }
  if (result.allocation) {
    const a = result.allocation;
    return (
      <div className="space-y-2 text-sm">
        <p className="text-ink/85">{a.rationale}</p>
        {a.holdings.map((h: any) => (
          <div key={h.symbol} className="flex justify-between font-mono text-xs"><span>{h.symbol}</span><span>{(h.weight * 100).toFixed(0)}%</span></div>
        ))}
      </div>
    );
  }
  return <p className="text-sm text-sage">No output.</p>;
}
