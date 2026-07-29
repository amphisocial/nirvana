"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { nextQuestions, totalSteps, type Question } from "@/lib/questionnaire";
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

const WORKING_STEPS = [
  "Maya screens the NASDAQ + NYSE universe",
  "Marcus stress-tests every candidate",
  "Sofia runs the bull against the bear",
  "Ethan backtests the plan vs the S&P 500",
  "Priya assembles your book",
];

export function Wizard() {
  const router = useRouter();
  const [answers, setAnswers] = useState<Partial<Answers>>({});
  const [multi, setMulti] = useState<string[]>([]);
  const [phase, setPhase] = useState<"interview" | "working" | "done">("interview");
  const [workStep, setWorkStep] = useState(0);
  const [record, setRecord] = useState<PortfolioRecord | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const queue = useMemo(() => nextQuestions(answers), [answers]);
  const q: Question | undefined = queue[0];
  const asked = Object.keys(answers).length;
  const progress = Math.min(100, Math.round((asked / totalSteps()) * 100));

  function answer(value: string | number | string[]) {
    if (!q) return;
    setAnswers((prev) => ({ ...prev, [q.id]: value }));
    setMulti([]);
  }

  async function build(next: Partial<Answers>) {
    setPhase("working");
    setError(null);
    const timer = setInterval(() => setWorkStep((s) => Math.min(s + 1, WORKING_STEPS.length - 1)), 900);
    try {
      const res = await fetch("/api/portfolio/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ answers: next, save: false }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to build");
      setRecord(data.record);
      setPhase("done");
    } catch (e: any) {
      setError(e.message);
      setPhase("interview");
    } finally {
      clearInterval(timer);
    }
  }

  // when interview completes, kick off the build
  const complete = queue.length === 0 && phase === "interview" && Object.keys(answers).length > 0;
  if (complete) build(answers as Answers);

  async function saveAndTrack() {
    if (!record) return;
    const res = await fetch("/api/portfolio/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ record }),
    });
    if (res.ok) {
      setSaved(true);
      router.push(`/portfolio/${record.id}`);
    }
  }

  // ---------- WORKING ----------
  if (phase === "working") {
    return (
      <div className="container-x py-24">
        <div className="mx-auto max-w-lg text-center">
          <div className="flex justify-center -space-x-3">
            {(["researcher", "risk", "debater", "tester", "optimizer"] as const).map((id, i) => (
              <div key={id} className="animate-pulse" style={{ animationDelay: `${i * 120}ms` }}>
                <Avatar id={id} accent={PERSONAS[id].accent} size={48} />
              </div>
            ))}
          </div>
          <h2 className="mt-6 font-display text-2xl font-black">The desk is working</h2>
          <p className="mt-1 text-sm text-sage">Five analysts, one portfolio. This takes a moment.</p>
          <div className="mt-6 space-y-2 text-left">
            {WORKING_STEPS.map((s, i) => (
              <div key={i} className={`flex items-center gap-3 rounded-lg border px-3 py-2 text-sm transition-colors ${i <= workStep ? "border-forest/30 bg-forest/5 text-ink" : "border-line text-sage"}`}>
                <span className={`inline-block h-2 w-2 rounded-full ${i < workStep ? "bg-gain" : i === workStep ? "bg-brass animate-pulse" : "bg-line"}`} />
                {s}
              </div>
            ))}
          </div>
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
              {record.engine === "claude" ? " powered by Claude" : " simulation mode"}
            </p>
          </div>
          <div className="flex gap-2">
            <button onClick={saveAndTrack} className="btn-brass" disabled={saved}>
              {saved ? "Saved ✓" : "Save & follow for a week"}
            </button>
            <button onClick={() => { setAnswers({}); setRecord(null); setPhase("interview"); setWorkStep(0); }} className="btn-ghost">
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
            <h2 className="mt-6 font-display text-2xl font-black leading-tight">{q.prompt}</h2>
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
