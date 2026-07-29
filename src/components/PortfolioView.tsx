"use client";
import { useState } from "react";
import type { PerformanceSnapshot, PortfolioRecord } from "@/lib/types";
import { PortfolioResult } from "./PortfolioResult";
import { Avatar } from "./Avatar";
import { Stat } from "./ui";
import { UPDATER } from "@/lib/agents/personas";

const money = (n: number) => "$" + Math.round(n).toLocaleString();

export function PortfolioView({ initial }: { initial: PortfolioRecord }) {
  const [rec, setRec] = useState(initial);
  const [loading, setLoading] = useState(false);
  const latest: PerformanceSnapshot | undefined = rec.updates[0];

  async function refresh() {
    setLoading(true);
    try {
      const res = await fetch(`/api/portfolio/${rec.id}/update`, { method: "POST" });
      const data = await res.json();
      if (res.ok) setRec({ ...rec, updates: [data.snapshot, ...rec.updates] });
    } finally { setLoading(false); }
  }

  const days = Math.max(0, Math.round((Date.now() - new Date(rec.createdAt).getTime()) / 86400000));

  return (
    <div className="container-x py-10">
      <div className="mb-8 border-b border-line pb-6">
        <div className="eyebrow">Saved portfolio · {rec.id}</div>
        <h1 className="mt-1 font-display text-3xl font-black sm:text-4xl">
          Recommendation from {new Date(rec.createdAt).toLocaleDateString()}
        </h1>
        <p className="mt-1 text-sm text-sage">Day {days} of tracking · built for {rec.answers.goal}, {rec.answers.horizon}-term, {rec.answers.riskComfort} risk</p>
      </div>

      {/* Updater panel */}
      <div className="mb-12 overflow-hidden rounded-xl2 border border-lineDark bg-forest2 text-ivory">
        <div className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Avatar id="risk" accent={UPDATER.accent} size={44} />
            <div>
              <div className="font-display text-lg font-bold">{UPDATER.name}</div>
              <div className="font-mono text-[11px] uppercase tracking-wider text-ivory/60">{UPDATER.title}</div>
              <p className="mt-1 max-w-md text-sm text-ivory/70">{UPDATER.role}</p>
            </div>
          </div>
          <button onClick={refresh} disabled={loading} className="btn-brass whitespace-nowrap disabled:opacity-50">
            {loading ? "Re-pricing…" : latest ? "Refresh gain / loss" : "Run first update"}
          </button>
        </div>

        {latest && (
          <div className="border-t border-lineDark bg-ink/30 p-6">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-xl border border-lineDark bg-forest2 p-4">
                <div className="font-mono text-[10px] uppercase tracking-wider text-ivory/50">Base value</div>
                <div className="mt-1 font-display text-2xl font-black tabular">{money(latest.baseValue)}</div>
              </div>
              <div className="rounded-xl border border-lineDark bg-forest2 p-4">
                <div className="font-mono text-[10px] uppercase tracking-wider text-ivory/50">Current value</div>
                <div className="mt-1 font-display text-2xl font-black tabular">{money(latest.currentValue)}</div>
              </div>
              <div className="col-span-2 rounded-xl border border-lineDark bg-forest2 p-4">
                <div className="font-mono text-[10px] uppercase tracking-wider text-ivory/50">Total gain / loss</div>
                <div className={`mt-1 font-display text-3xl font-black tabular ${latest.gainLossPct >= 0 ? "text-brass2" : "text-loss"}`}>
                  {latest.gainLossPct >= 0 ? "+" : ""}{latest.gainLossPct}%
                  <span className="ml-2 text-base text-ivory/60">
                    ({latest.currentValue - latest.baseValue >= 0 ? "+" : ""}{money(latest.currentValue - latest.baseValue)})
                  </span>
                </div>
              </div>
            </div>

            <div className="mt-4 overflow-hidden rounded-xl border border-lineDark">
              <table className="w-full text-sm">
                <thead><tr className="bg-ink/40 font-mono text-[10px] uppercase tracking-wider text-ivory/60">
                  <th className="px-3 py-2 text-left">Symbol</th>
                  <th className="px-3 py-2 text-right">Base</th>
                  <th className="px-3 py-2 text-right">Now</th>
                  <th className="px-3 py-2 text-right">Change</th>
                  <th className="px-3 py-2 text-right">Value now</th>
                </tr></thead>
                <tbody className="divide-y divide-lineDark">
                  {latest.perHolding.map((h) => (
                    <tr key={h.symbol}>
                      <td className="px-3 py-2 font-mono">{h.symbol}</td>
                      <td className="px-3 py-2 text-right font-mono tabular text-ivory/70">${h.basePrice}</td>
                      <td className="px-3 py-2 text-right font-mono tabular">${h.currentPrice}</td>
                      <td className={`px-3 py-2 text-right font-mono tabular ${h.changePct >= 0 ? "text-brass2" : "text-loss"}`}>{h.changePct >= 0 ? "+" : ""}{h.changePct}%</td>
                      <td className="px-3 py-2 text-right font-mono tabular">{money(h.dollarsNow)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-3 font-mono text-[11px] text-ivory/40">
              Last refreshed {new Date(latest.at).toLocaleString()} · {rec.updates.length} update{rec.updates.length === 1 ? "" : "s"} on record
            </p>
          </div>
        )}
        {!latest && (
          <div className="border-t border-lineDark p-6 text-sm text-ivory/60">
            No performance snapshot yet. Run the first update to lock in today's prices against the day-one base value.
          </div>
        )}
      </div>

      <PortfolioResult rec={rec} />
    </div>
  );
}
