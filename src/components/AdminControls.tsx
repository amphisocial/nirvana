"use client";
import { useState } from "react";

export function NightlyTrigger({ secretRequired }: { secretRequired: boolean }) {
  const [secret, setSecret] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(force: boolean) {
    setBusy(true); setStatus(null);
    try {
      const qs = new URLSearchParams();
      if (force) qs.set("force", "1");
      if (secretRequired && secret) qs.set("secret", secret);
      const res = await fetch(`/api/cron/nightly?${qs.toString()}`, { method: "POST" });
      const data = await res.json();
      setStatus(
        res.ok
          ? data.skipped
            ? `Skipped: ${data.reason}`
            : `✓ Posted "${data.title}" — pick ${data.pick} (${data.engine})${data.forced ? " · overwrote today's post" : ""}`
          : `Error: ${data.error}`
      );
    } catch (e: any) {
      setStatus(`Error: ${e.message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-5">
      <div className="eyebrow">Refresh the homepage now</div>
      <p className="mt-1 text-sm text-ink/70">
        Runs the "Analyst of the Day" now and replaces today's post — works even if the nightly job is disabled.
        The homepage market data (movers, headlines) already refreshes on every page load.
      </p>
      {secretRequired && (
        <input value={secret} onChange={(e) => setSecret(e.target.value)} placeholder="CRON_SECRET"
          className="mt-3 w-full rounded-lg border border-line bg-white px-3 py-2 font-mono text-sm outline-none focus:border-brand" />
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button onClick={() => run(true)} disabled={busy} className="btn-brass disabled:opacity-50">
          {busy ? "Running…" : "Refresh Analyst of the Day"}
        </button>
        <button onClick={() => run(false)} disabled={busy} className="btn-ghost disabled:opacity-50">
          Run scheduled job (respects toggle)
        </button>
      </div>
      {status && <p className="mt-3 font-mono text-xs text-ink/80">{status}</p>}
    </div>
  );
}
