"use client";
import { useState } from "react";

export function NightlyTrigger({ secretRequired }: { secretRequired: boolean }) {
  const [secret, setSecret] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function run() {
    setBusy(true); setStatus(null);
    try {
      const res = await fetch(`/api/cron/nightly${secretRequired ? `?secret=${encodeURIComponent(secret)}` : ""}`, { method: "POST" });
      const data = await res.json();
      setStatus(res.ok ? (data.skipped ? `Skipped: ${data.reason}` : `Posted: ${data.title} (${data.engine})`) : `Error: ${data.error}`);
    } catch (e: any) { setStatus(`Error: ${e.message}`); }
    finally { setBusy(false); }
  }
  return (
    <div className="card p-5">
      <div className="eyebrow">Manual trigger</div>
      <p className="mt-1 text-sm text-ink/70">Run tonight's "Analyst of the Day" now. In production this is called by your scheduler.</p>
      {secretRequired && (
        <input value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="CRON_SECRET"
          className="mt-3 w-full rounded-lg border border-line bg-white/60 px-3 py-2 font-mono text-sm outline-none focus:border-brass" />
      )}
      <button onClick={run} disabled={busy} className="btn-primary mt-3 disabled:opacity-50">{busy ? "Running…" : "Run nightly job now"}</button>
      {status && <p className="mt-3 font-mono text-xs text-ink/80">{status}</p>}
    </div>
  );
}
