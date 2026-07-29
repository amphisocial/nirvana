"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

type Item = {
  id: string;
  createdAt: string;
  goal: string;
  horizon: string;
  risk: string;
  amount: number;
  invested: number;
  holdings: number;
  topNames: string[];
  baseValue: number;
  currentValue: number | null;
  gainLossPct: number | null;
  updatedAt: string | null;
  engine: string;
};

const money = (n: number) => "$" + Math.round(n).toLocaleString();

export function SavedPortfolios() {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [refreshingAll, setRefreshingAll] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res = await fetch("/api/portfolio/list");
      const data = await res.json();
      setItems(data.portfolios || []);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { load(); }, []);

  async function refresh(id: string) {
    setBusy((b) => ({ ...b, [id]: true }));
    try {
      const res = await fetch(`/api/portfolio/${id}/update`, { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setItems((list) => list.map((p) => p.id === id ? {
          ...p, currentValue: data.snapshot.currentValue, baseValue: data.snapshot.baseValue,
          gainLossPct: data.snapshot.gainLossPct, updatedAt: data.snapshot.at,
        } : p));
      }
    } finally {
      setBusy((b) => ({ ...b, [id]: false }));
    }
  }

  async function refreshAll() {
    setRefreshingAll(true);
    for (const p of items) { await refresh(p.id); }
    setRefreshingAll(false);
  }

  async function del(id: string) {
    if (!confirm("Delete this saved portfolio? This can't be undone.")) return;
    setBusy((b) => ({ ...b, [id]: true }));
    const res = await fetch(`/api/portfolio/${id}`, { method: "DELETE" });
    if (res.ok) setItems((list) => list.filter((p) => p.id !== id));
    else setBusy((b) => ({ ...b, [id]: false }));
  }

  if (loading) return <div className="container-x py-20 text-center text-sage">Loading your portfolios…</div>;

  if (items.length === 0) {
    return (
      <div className="mt-8 rounded-xl2 border border-dashed border-line bg-white p-10 text-center">
        <p className="font-display text-lg">Nothing saved yet.</p>
        <p className="mt-1 text-sm text-sage">Build a portfolio and hit “Save &amp; follow” to track it here.</p>
        <Link href="/build" className="btn-brass mt-5">Build a portfolio</Link>
      </div>
    );
  }

  const totalInvested = items.reduce((a, p) => a + p.invested, 0);
  const tracked = items.filter((p) => p.currentValue != null);
  const totalNow = tracked.reduce((a, p) => a + (p.currentValue as number), 0) + items.filter((p) => p.currentValue == null).reduce((a, p) => a + p.invested, 0);
  const totalPct = totalInvested ? ((totalNow - totalInvested) / totalInvested) * 100 : 0;

  return (
    <div className="mt-6">
      {/* portfolio-wide summary */}
      <div className="mb-6 flex flex-col gap-4 rounded-xl2 border border-lineDark bg-forest2 p-6 text-ivory sm:flex-row sm:items-center sm:justify-between">
        <div className="grid grid-cols-3 gap-6">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-wider text-ivory/50">Portfolios</div>
            <div className="font-display text-2xl font-bold">{items.length}</div>
          </div>
          <div>
            <div className="font-mono text-[10px] uppercase tracking-wider text-ivory/50">Total invested</div>
            <div className="font-display text-2xl font-bold tabular">{money(totalInvested)}</div>
          </div>
          <div>
            <div className="font-mono text-[10px] uppercase tracking-wider text-ivory/50">Net gain / loss</div>
            <div className={`font-display text-2xl font-bold tabular ${totalPct >= 0 ? "text-brass2" : "text-loss"}`}>
              {totalPct >= 0 ? "+" : ""}{totalPct.toFixed(1)}%
            </div>
          </div>
        </div>
        <button onClick={refreshAll} disabled={refreshingAll} className="btn-brass whitespace-nowrap disabled:opacity-50">
          {refreshingAll ? "Refreshing…" : "Refresh all gains"}
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {items.map((p) => {
          const g = p.gainLossPct;
          const gv = p.currentValue != null ? p.currentValue - p.baseValue : null;
          const tracked = g != null;
          return (
            <div key={p.id} className="card flex flex-col p-5">
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-mono text-[11px] text-sage">{new Date(p.createdAt).toLocaleDateString()} · {p.id}</div>
                  <div className="mt-0.5 flex flex-wrap gap-1.5">
                    <span className="chip">{p.goal}</span>
                    <span className="chip">{p.horizon}-term</span>
                    <span className="chip">{p.risk} risk</span>
                  </div>
                </div>
                <button onClick={() => del(p.id)} disabled={busy[p.id]} aria-label="Delete portfolio"
                  className="rounded-lg p-2 text-sage transition-colors hover:bg-loss/10 hover:text-loss disabled:opacity-40">
                  <TrashIcon />
                </button>
              </div>

              {/* headline: initial investment + net gain/loss */}
              <div className="mt-4 grid grid-cols-2 gap-3">
                <div className="rounded-xl border border-line bg-ivory2/50 p-3">
                  <div className="font-mono text-[10px] uppercase tracking-wider text-sage">Initial investment</div>
                  <div className="mt-1 font-display text-2xl font-bold tabular">{money(p.invested)}</div>
                </div>
                <div className={`rounded-xl border p-3 ${!tracked ? "border-line bg-ivory2/50" : g! >= 0 ? "border-gain/30 bg-gain/5" : "border-loss/30 bg-loss/5"}`}>
                  <div className="font-mono text-[10px] uppercase tracking-wider text-sage">Net gain / loss</div>
                  {tracked ? (
                    <div className={`mt-1 font-display text-2xl font-bold tabular ${g! >= 0 ? "text-gain" : "text-loss"}`}>
                      {g! >= 0 ? "+" : ""}{g!.toFixed(1)}%
                      <span className="block text-xs font-medium text-sage">{gv! >= 0 ? "+" : ""}{money(gv!)} → {money(p.currentValue!)}</span>
                    </div>
                  ) : (
                    <div className="mt-1 text-sm text-sage">Not tracked yet</div>
                  )}
                </div>
              </div>

              <div className="mt-3 text-xs text-sage">
                {p.holdings} holdings · {p.topNames.join(", ")}{p.holdings > p.topNames.length ? "…" : ""}
                {p.updatedAt && <> · updated {new Date(p.updatedAt).toLocaleDateString()}</>}
              </div>

              <div className="mt-4 flex gap-2 border-t border-line pt-4">
                <Link href={`/portfolio/${p.id}`} className="btn-primary flex-1 text-sm">Open</Link>
                <button onClick={() => refresh(p.id)} disabled={busy[p.id]} className="btn-ghost text-sm disabled:opacity-50">
                  {busy[p.id] ? "…" : tracked ? "Refresh" : "Track now"}
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TrashIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18M8 6V4a1 1 0 011-1h6a1 1 0 011 1v2m2 0v14a1 1 0 01-1 1H7a1 1 0 01-1-1V6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}
