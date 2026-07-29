"use client";
import { useState } from "react";
import type { AgentPersona } from "@/lib/types";
import { Avatar } from "./Avatar";
import { AgentConsole } from "./AgentConsole";

export function AgentsExplorer({ personas }: { personas: AgentPersona[] }) {
  const [active, setActive] = useState(personas[0]);
  return (
    <div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        {personas.map((p) => {
          const on = p.id === active.id;
          return (
            <button key={p.id} onClick={() => setActive(p)}
              className={`flex flex-col items-center gap-2 rounded-xl2 border p-4 text-center transition-all ${on ? "border-brass bg-brass/5 shadow-card" : "border-line hover:border-ink/30"}`}>
              <Avatar id={p.id} accent={p.accent} size={56} ring={on} />
              <div>
                <div className="font-display text-sm font-bold leading-tight">{p.name.split(" ").slice(-1)}</div>
                <div className="font-mono text-[9px] uppercase tracking-wider text-sage">{p.desk}</div>
              </div>
            </button>
          );
        })}
      </div>

      <div className="mt-8 rounded-xl2 border border-line bg-ivory2/40 p-5 sm:p-7">
        <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-center gap-4">
            <Avatar id={active.id} accent={active.accent} size={64} />
            <div>
              <h2 className="font-display text-2xl font-black">{active.name}</h2>
              <div className="font-mono text-[11px] uppercase tracking-wider text-sage">{active.title}</div>
              <p className="mt-1 max-w-md text-sm text-ink/70">{active.role}</p>
            </div>
          </div>
          <div className="max-w-xs text-xs text-sage">
            <div className="eyebrow mb-1">Method</div>
            <ol className="list-decimal space-y-0.5 pl-4">
              {active.method.slice(0, 4).map((m, i) => <li key={i}>{m}</li>)}
            </ol>
          </div>
        </div>
        <AgentConsole persona={active} />
      </div>
    </div>
  );
}
