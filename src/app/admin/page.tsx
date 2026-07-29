import { config } from "@/lib/config";
import { marketHealth } from "@/lib/market/health";
import { NightlyTrigger } from "@/components/AdminControls";
import { SectionLabel } from "@/components/ui";
export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const health = await marketHealth();
  const marketLive =
    (config.market.provider === "finnhub" && !!config.market.finnhubKey) ||
    (config.market.provider === "alphavantage" && !!config.market.alphavantageKey);
  const rows: [string, string, boolean][] = [
    ["Agent engine", config.ai.enabled ? `${config.ai.provider} (live)` : "Simulation (no key)", config.ai.enabled],
    ["AI model", config.ai.enabled ? config.ai.model : "—", config.ai.enabled],
    ["Market data", `${config.market.provider}${marketLive ? " (configured)" : " (mock)"}`, marketLive],
    ["Live data check", health.ok ? `OK — ${health.detail}` : `NOT LIVE — ${health.detail}`, health.ok],
    ["Listing universe", config.market.listing.toUpperCase(), true],
    ["Nightly blog run", config.nightly.enabled ? "ENABLED" : "DISABLED", config.nightly.enabled],
    ["Cron secret set", config.nightly.secret ? "yes" : "no", !!config.nightly.secret],
  ];
  return (
    <div className="container-x max-w-4xl py-12">
      <span className="eyebrow">Control room</span>
      <h1 className="mt-3 font-display text-4xl font-black">Admin — the one human in the loop.</h1>
      <p className="mt-2 max-w-xl text-ink/70">
        Everything here is driven by environment variables. NIRVANA runs fully in simulation with no keys;
        add an <code className="font-mono">ANTHROPIC_API_KEY</code> and a market provider to go live.
      </p>

      <div className="mt-8"><SectionLabel n="—">System status</SectionLabel></div>
      <div className="mt-4 overflow-hidden rounded-xl2 border border-line">
        {rows.map(([k, v, ok], i) => (
          <div key={k} className={`flex items-center justify-between px-5 py-3 ${i % 2 ? "bg-white/40" : "bg-white/60"}`}>
            <span className="text-sm text-ink/70">{k}</span>
            <span className="flex items-center gap-2 font-mono text-sm">
              <span className={`h-2 w-2 rounded-full ${ok ? "bg-gain" : "bg-sage"}`} />{v}
            </span>
          </div>
        ))}
      </div>

      <div className="mt-8"><SectionLabel n="—">Nightly run</SectionLabel></div>
      <div className="mt-4"><NightlyTrigger secretRequired={!!config.nightly.secret} /></div>

      <div className="mt-8 rounded-xl2 border border-brass/30 bg-brass/5 p-5 text-sm text-ink/80">
        <div className="eyebrow mb-2">How "live" actually works</div>
        <p>When <strong>Live data check</strong> is OK, quotes, movers, news and single-ticker lookups are real.
        If it says NOT LIVE, the app silently falls back to synthetic data even though a key is set — usually a
        blocked outbound connection, an invalid key, or a rate limit.</p>
        <p className="mt-2">Note: the <strong>portfolio builder screens a curated candidate list</strong> (large/mid-cap
        NASDAQ + NYSE names), then prices and analyzes them with live data. It does not scan the entire market on
        every request. Single-agent lookups (the Agents page) resolve <em>any</em> real US ticker via the provider.</p>
      </div>

      <div className="mt-8 rounded-xl2 border border-line bg-ivory2/50 p-5 text-sm text-ink/70">
        <div className="eyebrow mb-2">Schedule it</div>
        <p>Point any scheduler (cron, Vercel Cron, GitHub Actions) at:</p>
        <pre className="mt-2 overflow-x-auto rounded-lg bg-ink p-3 font-mono text-xs text-ivory">POST /api/cron/nightly{"\n"}Authorization: Bearer &lt;CRON_SECRET&gt;</pre>
        <p className="mt-2">Toggle it off any time with <code className="font-mono">NIGHTLY_ENABLED=false</code>.</p>
      </div>
    </div>
  );
}
