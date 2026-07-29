"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession, signIn } from "next-auth/react";
import { nextQuestions, totalSteps, phraseFor, type Question } from "@/lib/questionnaire";
import type { Answers, PortfolioRecord } from "@/lib/types";
import { PERSONAS } from "@/lib/agents/personas";
import { Avatar } from "./Avatar";
import { PortfolioResult } from "./PortfolioResult";

const byName: Record<string, keyof typeof PERSONAS> = {
  "Dr. Maya Chen": "researcher",
  "Marcus Reed": "risk",
  "Sofia Alvarez": "debater",
  "Ethan Brooks": "tester",
  "Priya Nair": "optimizer",
};

type DeskEvent = { stage: string; line: string; kind?: "context" | "cut" | "info" };
const AGENTS = ["researcher", "risk", "debater", "tester", "optimizer"] as const;
// which stream stage marks each agent's work complete
const AGENT_DONE: Record<string, string> = {
  researcher: "research",
  risk: "risk",
  debater: "debate_done",
  tester: "backtest",
  optimizer: "optimize",
};
const PIPELINE = ["research", "risk", "debate_done", "optimize", "backtest"];

export function Wizard() {
  const router = useRouter();
  const search = useSearchParams();
  const { status } = useSession();
  const [resuming, setResuming] = useState(search.get("resume") === "1");
  const [seed] = useState(() => Math.floor(Math.random() * 100000));
  const [answers, setAnswers] = useState<Partial<Answers>>({});
  const [multi, setMulti] = useState<string[]>([]);
  const [sectorPref, setSectorPref] = useState<Record<string, "want" | "avoid">>({});
  const [phase, setPhase] = useState<"interview" | "working" | "done">("interview");
  const [log, setLog] = useState<DeskEvent[]>([]);
  const [doneStages, setDoneStages] = useState<Set<string>>(new Set());
  const [engine, setEngine] = useState<"ai" | "simulated" | null>(null);
  const [record, setRecord] = useState<PortfolioRecord | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const started = useMemo(() => ({ current: false }), []);

  const queue = useMemo(() => nextQuestions(answers), [answers]);
  const q: Question | undefined = queue[0];
  const asked = Object.keys(answers).length;
  const progress = Math.min(100, Math.round((asked / totalSteps()) * 100));

  function answer(value: string | number | string[]) {
    if (!q) return;
    setAnswers((prev) => ({ ...prev, [q.id]: value }));
    setMulti([]);
  }

  function cycleSector(s: string) {
    setSectorPref((prev) => {
      const cur = prev[s];
      const next = { ...prev };
      if (!cur) next[s] = "want";
      else if (cur === "want") next[s] = "avoid";
      else delete next[s];
      return next;
    });
  }

  function submitSectorPref() {
    const want = Object.entries(sectorPref).filter(([, v]) => v === "want").map(([k]) => k);
    const avoid = Object.entries(sectorPref).filter(([, v]) => v === "avoid").map(([k]) => k);
    setAnswers((prev) => ({ ...prev, sectorsWant: want, sectorsAvoid: avoid }));
    setSectorPref({});
  }

  function pushLine(stage: string, line: string, kind?: DeskEvent["kind"]) {
    setLog((l) => [...l, { stage, line, kind }]);
    setDoneStages((s) => new Set(s).add(stage));
  }

  // Consume the NDJSON stream — every line is a REAL step as it lands.
  function describe(e: any): { line: string; kind?: DeskEvent["kind"] } | null {
    switch (e.stage) {
      case "context_start":
        return { line: "Reading today's tape — indices, sector rotation, and the morning's headlines…", kind: "context" };
      case "context": {
        const heads = (e.headlines || []).slice(0, 2).join(" · ");
        return {
          line: `Market is ${e.breadth}. Leading: ${e.leaders.join(", ")}. Lagging: ${e.laggards.join(", ")}.${heads ? ` Headlines: ${heads}` : ""}`,
          kind: "context",
        };
      }
      case "propose_start":
        return { line: "Maya is scanning the market for candidates that fit today's setup and your profile…", kind: "info" };
      case "propose":
        return { line: `Proposed ${e.count} candidates${e.fallback ? " (built-in screen)" : " from across the market"}: ${e.symbols.slice(0, 10).join(", ")}${e.symbols.length > 10 ? "…" : ""}` };
      case "validate":
        return { line: `Validated on the live terminal → ${e.kept.length} confirmed${e.dropped.length ? `, dropped ${e.dropped.length} (${e.dropped.slice(0, 4).join(", ")}${e.dropped.length > 4 ? "…" : ""})` : ""}.` };
      case "research": {
        const c = (t: string) => e.notes.filter((n: any) => n.growthTier === t).length;
        return { line: `Maya wrote ${e.notes.length} theses — ${c("high")} high-growth, ${c("medium")} medium, ${c("low")} low.` };
      }
      case "risk": {
        const avg = Math.round(e.risk.reduce((a: number, r: any) => a + r.volatility, 0) / e.risk.length);
        return { line: `Marcus scored risk on ${e.risk.length} names — average volatility ~${avg}%.` };
      }
      case "debate_start":
        return { line: `Sofia opens the debate — ${e.starting} names enter the knockout.`, kind: "info" };
      case "debate_round": {
        const cuts = (e.cut || []).map((c: any) => `${c.symbol} (${c.reason})`).join("; ");
        return { line: `Round ${e.round}/${e.totalRounds} — ${e.focus}. Cut ${cuts}. ${e.remaining.length} remain.`, kind: "cut" };
      }
      case "debate_done":
        return { line: `Debate settled. Survivors: ${e.survivors.join(", ")}.` };
      case "optimize":
        return { line: `Priya sized ${e.holdings.length} positions into the final book.` };
      case "backtest":
        return { line: `Ethan backtested vs the S&P 500 → ${e.totalReturnPct}% vs ${e.benchmarkReturnPct}%.` };
      default:
        return null;
    }
  }

  async function build(next: Partial<Answers>) {
    setPhase("working");
    setError(null);
    setLog([]);
    setDoneStages(new Set());
    try {
      const res = await fetch("/api/portfolio/stream", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: next }),
      });
      if (!res.ok || !res.body) throw new Error("Couldn't reach the desk.");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const e = JSON.parse(line);
          if (e.stage === "error") throw new Error(e.error);
          if (e.stage === "begin") setEngine(e.engine);
          if (e.stage === "done") {
            setRecord(e.record);
            setPhase("done");
          } else {
            const d = describe(e);
            if (d) pushLine(e.stage, d.line, d.kind);
          }
        }
      }
    } catch (e: any) {
      setError(e.message || "Something went wrong.");
      setPhase("interview");
    }
  }

  // when interview completes, kick off the build once
  const complete = queue.length === 0 && phase === "interview" && Object.keys(answers).length > 0;
  if (complete && !started.current) {
    started.current = true;
    build(answers as Answers);
  }

  const PENDING_KEY = "nirvana:pendingPortfolio";

  async function persist(rec: PortfolioRecord): Promise<boolean> {
    const res = await fetch("/api/portfolio/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ record: rec }),
    });
    if (res.ok) {
      router.push(`/portfolio/${rec.id}`);
      return true;
    }
    return false;
  }

  async function saveAndTrack() {
    if (!record) return;
    if (status !== "authenticated") {
      // Stash the built portfolio and send the user through Google sign-in;
      // we finish the save automatically when they return.
      try {
        sessionStorage.setItem(PENDING_KEY, JSON.stringify(record));
      } catch {}
      signIn("google", { callbackUrl: "/build?resume=1" });
      return;
    }
    setSaved(true);
    const ok = await persist(record);
    if (!ok) { setSaved(false); setError("Could not save — please try again."); }
  }

  // Resume: after returning from Google sign-in, finish the pending save.
  useEffect(() => {
    if (!resuming) return;
    if (status === "loading") return;
    (async () => {
      try {
        const raw = sessionStorage.getItem(PENDING_KEY);
        if (status === "authenticated" && raw) {
          const rec = JSON.parse(raw) as PortfolioRecord;
          sessionStorage.removeItem(PENDING_KEY);
          const ok = await persist(rec);
          if (ok) return; // navigating away
        }
      } catch {}
      setResuming(false); // nothing to resume; show the interview
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, resuming]);

  // ---------- RESUMING AFTER SIGN-IN ----------
  if (resuming) {
    return (
      <div className="container-x py-28 text-center">
        <div className="mx-auto max-w-sm">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-line border-t-brass" />
          <h2 className="mt-6 font-display text-2xl font-bold">Finishing sign-in…</h2>
          <p className="mt-1 text-sm text-sage">Saving your portfolio and opening your tracker.</p>
        </div>
      </div>
    );
  }

  // ---------- WORKING ----------
  if (phase === "working") {
    const agentStatus = (id: string) => {
      const stage = AGENT_DONE[id];
      if (doneStages.has(stage)) return "done";
      const firstPending = PIPELINE.find((s) => !doneStages.has(s));
      return stage === firstPending ? "active" : "queued";
    };
    return (
      <div className="container-x py-16">
        <div className="mx-auto max-w-2xl">
          <div className="text-center">
            <h2 className="font-display text-2xl font-extrabold">The desk is working</h2>
            <p className="mt-1 text-sm text-sage">
              {engine === "simulated"
                ? "Demo mode — a rule-based engine, so this is fast. Add a model provider for live research."
                : "Each analyst reports in as they finish. This is live — it takes as long as the work takes."}
            </p>
          </div>

          {/* agent status row */}
          <div className="mt-8 grid grid-cols-5 gap-2">
            {AGENTS.map((id) => {
              const st = agentStatus(id);
              return (
                <div key={id} className={`flex flex-col items-center gap-2 rounded-xl border p-3 transition-colors ${st === "done" ? "border-gain/40 bg-gain/5" : st === "active" ? "border-brand/40 bg-brand/5" : "border-line"}`}>
                  <div className={st === "active" ? "animate-pulse" : ""}>
                    <Avatar id={id} accent={PERSONAS[id].accent} size={40} ring={st !== "queued"} />
                  </div>
                  <div className="text-center">
                    <div className="text-[11px] font-medium leading-tight">{PERSONAS[id].name.split(" ").slice(-1)}</div>
                    <div className={`font-mono text-[9px] uppercase ${st === "done" ? "text-gain" : st === "active" ? "text-brand" : "text-sage"}`}>
                      {st === "done" ? "done" : st === "active" ? "working" : "queued"}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* live desk log — real results as they arrive */}
          <div className="mt-6 rounded-xl2 border border-lineDark bg-forest2 p-4 font-mono text-[13px] text-ivory/90">
            <div className="mb-2 flex items-center gap-2 text-[10px] uppercase tracking-widest text-ivory/50">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-gain" /> Desk feed · live thinking
            </div>
            <div className="term-scroll max-h-[340px] space-y-1.5 overflow-y-auto">
              {log.length === 0 && <div className="text-ivory/50">Connecting to the desk…</div>}
              {log.map((e, i) => (
                <div key={i} className="flex gap-2">
                  <span className={e.kind === "cut" ? "text-loss" : e.kind === "context" ? "text-brass2" : "text-brass2"}>
                    {e.kind === "cut" ? "✕" : "›"}
                  </span>
                  <span className={e.kind === "context" ? "text-ivory/70" : ""}>{e.line}</span>
                </div>
              ))}
              {phase === "working" && log.length > 0 && !doneStages.has("backtest") && (
                <div className="flex gap-2 text-ivory/50"><span className="text-brass2">›</span><span className="animate-pulse">thinking…</span></div>
              )}
            </div>
          </div>
          <p className="mt-3 text-center font-mono text-[11px] text-sage">
            {engine === "simulated"
              ? "Demo mode — rule-based, so it's fast."
              : "This runs live: reading today's market, proposing names, and debating them out. It takes as long as real analysis takes."}
          </p>
        </div>
      </div>
    );
  }

  // ---------- DONE ----------
  if (phase === "done" && record) {
    return (
      <div className="container-x py-10">
        <div className="mb-8 flex flex-col items-start justify-between gap-4 border-b border-line pb-6 sm:flex-row sm:items-end">
          <div>
            <div className="eyebrow">Recommendation · {new Date(record.createdAt).toLocaleDateString()}</div>
            <h1 className="mt-1 font-display text-3xl font-black sm:text-4xl">Your portfolio is ready</h1>
            <p className="mt-1 text-sm text-sage">
              Built for {record.answers.goal} · {record.answers.horizon}-term · {record.answers.riskComfort} risk ·
              {record.engine === "ai" ? " powered by AI" : " simulation mode"}
            </p>
          </div>
          <div className="flex gap-2">
            <button onClick={saveAndTrack} className="btn-brass" disabled={saved}>
              {saved ? "Saving…" : status === "authenticated" ? "Save & follow for a week" : "Sign in to save & follow"}
            </button>
            <button onClick={() => { setAnswers({}); setRecord(null); setPhase("interview"); setLog([]); setDoneStages(new Set()); started.current = false; }} className="btn-ghost">
              Start over
            </button>
          </div>
        </div>
        <PortfolioResult rec={record} />
        <div className="mt-10 rounded-xl2 border border-brass/30 bg-brass/5 p-5 text-sm text-ink/80">
          <strong className="font-display">Want to know if this actually works?</strong> Save it, and Leo — our
          performance analyst — will track it against the day-one prices. Come back any time and hit <em>Refresh</em> to
          see the gain or loss.
        </div>
      </div>
    );
  }

  // ---------- INTERVIEW ----------
  const persona = q ? PERSONAS[byName[q.by]] : null;
  return (
    <div className="container-x py-12">
      <div className="mx-auto max-w-2xl">
        <div className="mb-6 flex items-center justify-between">
          <span className="eyebrow">Intake interview</span>
          <span className="font-mono text-xs text-sage">{progress}%</span>
        </div>
        <div className="mb-8 h-1 w-full overflow-hidden rounded-full bg-line">
          <div className="h-full bg-brass transition-all duration-500" style={{ width: `${progress}%` }} />
        </div>

        {error && <div className="mb-4 rounded-lg border border-loss/30 bg-loss/5 p-3 text-sm text-loss">{error}</div>}

        {q && persona && (
          <div className="card p-6 sm:p-8">
            <div className="flex items-center gap-3">
              <Avatar id={persona.id} accent={persona.accent} size={52} />
              <div>
                <div className="font-display text-lg font-bold">{persona.name}</div>
                <div className="font-mono text-[11px] uppercase tracking-wider text-sage">{persona.title}</div>
              </div>
            </div>
            <h2 className="mt-6 font-display text-2xl font-extrabold leading-tight">{phraseFor(q.id, q.prompt, seed)}</h2>
            {q.help && <p className="mt-2 text-sm text-sage">{q.help}</p>}

            <div className="mt-6">
              {q.kind === "number" && <NumberInput onSubmit={(v) => answer(v)} />}
              {q.kind === "single" && (
                <div className="grid gap-2">
                  {q.options!.map((o) => (
                    <button key={o.value} onClick={() => answer(o.value)}
                      className="group flex items-center justify-between rounded-xl border border-line bg-white/50 px-4 py-3 text-left transition-all hover:border-brass hover:bg-brass/5">
                      <span className="text-[15px]">{o.label}</span>
                      {o.note && <span className="chip">{o.note}</span>}
                    </button>
                  ))}
                </div>
              )}
              {q.kind === "multi" && (
                <div>
                  <div className="flex flex-wrap gap-2">
                    {q.options!.map((o) => {
                      const on = multi.includes(o.value);
                      return (
                        <button key={o.value} onClick={() => setMulti((m) => on ? m.filter((x) => x !== o.value) : [...m, o.value])}
                          className={`chip border transition-colors ${on ? "border-brass bg-brass/10 text-ink" : "hover:border-brass"}`}>
                          {o.label}
                        </button>
                      );
                    })}
                  </div>
                  <button onClick={() => answer(multi)} className="btn-primary mt-4">
                    {multi.length ? `Continue with ${multi.length} selected` : "Skip — let the desk decide"}
                  </button>
                </div>
              )}
              {q.kind === "want_avoid" && (
                <div>
                  <div className="mb-3 flex flex-wrap items-center gap-4 text-xs text-sage">
                    <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-gain" /> Want</span>
                    <span className="flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full bg-loss" /> Avoid</span>
                    <span className="text-sage/70">Tap a sector to cycle: Want → Avoid → clear</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {q.options!.map((o) => {
                      const st = sectorPref[o.value];
                      const cls =
                        st === "want"
                          ? "border-gain bg-gain/10 text-gain"
                          : st === "avoid"
                          ? "border-loss bg-loss/10 text-loss line-through decoration-loss/50"
                          : "border-line hover:border-brand";
                      return (
                        <button key={o.value} onClick={() => cycleSector(o.value)}
                          className={`chip border transition-colors ${cls}`}>
                          {st === "want" && <span aria-hidden>✓ </span>}
                          {st === "avoid" && <span aria-hidden>✕ </span>}
                          {o.label}
                        </button>
                      );
                    })}
                  </div>
                  <button onClick={submitSectorPref} className="btn-primary mt-4">
                    {Object.keys(sectorPref).length
                      ? `Continue — ${Object.values(sectorPref).filter((v) => v === "want").length} want, ${Object.values(sectorPref).filter((v) => v === "avoid").length} avoid`
                      : "Skip — let the desk decide"}
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        <p className="mt-6 text-center font-mono text-[11px] text-sage">
          The desk adapts its questions to your answers — just like a real analyst would.
        </p>
      </div>
    </div>
  );
}

function NumberInput({ onSubmit }: { onSubmit: (v: number) => void }) {
  const [val, setVal] = useState("");
  const presets = [5000, 10000, 25000, 100000];
  return (
    <div>
      <div className="flex items-center rounded-xl border border-line bg-white/50 px-4 py-3">
        <span className="font-display text-2xl font-black text-sage">$</span>
        <input
          autoFocus type="number" inputMode="numeric" value={val}
          onChange={(e) => setVal(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && Number(val) > 0 && onSubmit(Number(val))}
          placeholder="10,000"
          className="w-full bg-transparent pl-2 font-display text-2xl font-black outline-none tabular"
        />
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {presets.map((p) => (
          <button key={p} onClick={() => setVal(String(p))} className="chip hover:border-brass">${p.toLocaleString()}</button>
        ))}
      </div>
      <button onClick={() => Number(val) > 0 && onSubmit(Number(val))} disabled={!(Number(val) > 0)}
        className="btn-primary mt-4 w-full disabled:opacity-40">
        Begin the interview
      </button>
    </div>
  );
}
