import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { config, isAdmin, adminConfigured } from "@/lib/config";
import { marketHealth } from "@/lib/market/health";
import { aiHealth } from "@/lib/aihealth";
import { NightlyTrigger } from "@/components/AdminControls";
import { SectionLabel } from "@/components/ui";
import { SignInPrompt } from "@/components/SignInPrompt";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin — NIRVANA" };

export default async function AdminPage() {
  const session = await getServerSession(authOptions);
  const email = session?.user?.email ?? null;

  // ---- access control ----
  if (!email) {
    return (
      <div className="container-x max-w-lg py-20 text-center">
        <span className="eyebrow">Control room</span>
        <h1 className="mt-3 font-display text-3xl font-bold">Admin access</h1>
        <p className="mt-2 text-ink/70">This area is restricted to administrators. Sign in with an authorized Google account.</p>
        <div className="mt-6 flex justify-center"><SignInPrompt callbackUrl="/admin" /></div>
      </div>
    );
  }
  if (!adminConfigured()) {
    return (
      <div className="container-x max-w-xl py-20 text-center">
        <span className="eyebrow">Control room</span>
        <h1 className="mt-3 font-display text-3xl font-bold">No admin configured</h1>
        <p className="mt-3 text-ink/70">
          No one is an admin yet. Set <code className="font-mono">ADMIN_EMAILS</code> in your <code className="font-mono">.env.local</code> to
          the Google email(s) that should have access, then restart. You're signed in as
          <span className="font-mono"> {email}</span>.
        </p>
        <pre className="mt-4 overflow-x-auto rounded-lg bg-ink p-3 text-left font-mono text-xs text-ivory">ADMIN_EMAILS={email}</pre>
      </div>
    );
  }
  if (!isAdmin(email)) {
    return (
      <div className="container-x max-w-lg py-20 text-center">
        <span className="eyebrow">Control room</span>
        <h1 className="mt-3 font-display text-3xl font-bold">Not authorized</h1>
        <p className="mt-2 text-ink/70">
          You're signed in as <span className="font-mono">{email}</span>, which isn't on the admin list. Ask an
          administrator to add your email to <code className="font-mono">ADMIN_EMAILS</code>.
        </p>
      </div>
    );
  }

  // ---- admin view ----
  const [health, ai] = await Promise.all([marketHealth(), aiHealth()]);
  const marketLive =
    (config.market.provider === "finnhub" && !!config.market.finnhubKey) ||
    (config.market.provider === "alphavantage" && !!config.market.alphavantageKey);

  const rows: [string, string, boolean][] = [
    ["Agent engine", config.ai.enabled ? `${config.ai.provider} (live)` : "Simulation (no key)", config.ai.enabled],
    ["AI model", config.ai.enabled ? config.ai.model : "—", config.ai.enabled],
    ["AI live check", ai.ok ? `OK — ${ai.detail}` : `NOT LIVE — ${ai.detail}`, ai.ok],
    ["Market data", `${config.market.provider}${marketLive ? " (configured)" : " (mock)"}`, marketLive],
    ["Live data check", health.ok ? `OK — ${health.detail}` : `NOT LIVE — ${health.detail}`, health.ok],
    ["Listing universe", config.market.listing.toUpperCase(), true],
    ["Nightly blog run", config.nightly.enabled ? "ENABLED" : "DISABLED", config.nightly.enabled],
    ["Cron secret set", config.nightly.secret ? "yes" : "no", !!config.nightly.secret],
  ];

  return (
    <div className="container-x max-w-4xl py-12">
      <span className="eyebrow">Control room</span>
      <h1 className="mt-3 font-display text-4xl font-extrabold">Admin</h1>
      <p className="mt-2 max-w-xl text-ink/70">
        Signed in as <span className="font-mono">{email}</span> · you have admin access.
      </p>

      <div className="mt-8"><SectionLabel n="—">Administrators</SectionLabel></div>
      <div className="mt-4 flex flex-wrap gap-2">
        {config.admin.emails.map((e) => (
          <span key={e} className={`chip ${e === email.toLowerCase() ? "border-brand text-brand" : ""}`}>{e}{e === email.toLowerCase() ? " · you" : ""}</span>
        ))}
      </div>
      <p className="mt-2 text-xs text-sage">The admin list is set by <code className="font-mono">ADMIN_EMAILS</code> in your environment.</p>

      <div className="mt-8"><SectionLabel n="—">System status</SectionLabel></div>
      <div className="mt-4 overflow-hidden rounded-xl2 border border-line">
        {rows.map(([k, v, ok], i) => (
          <div key={k} className={`flex items-center justify-between px-5 py-3 ${i % 2 ? "bg-white/60" : "bg-white"}`}>
            <span className="text-sm text-ink/70">{k}</span>
            <span className="flex items-center gap-2 font-mono text-sm">
              <span className={`h-2 w-2 rounded-full ${ok ? "bg-gain" : "bg-sage"}`} />{v}
            </span>
          </div>
        ))}
      </div>

      <div className="mt-8"><SectionLabel n="—">Homepage & nightly</SectionLabel></div>
      <div className="mt-4"><NightlyTrigger /></div>

      <div className="mt-8 rounded-xl2 border border-line bg-ivory2/50 p-5 text-sm text-ink/70">
        <div className="eyebrow mb-2">Schedule the nightly job</div>
        <p>Point any scheduler at:</p>
        <pre className="mt-2 overflow-x-auto rounded-lg bg-ink p-3 font-mono text-xs text-ivory">POST /api/cron/nightly{"\n"}Authorization: Bearer &lt;CRON_SECRET&gt;</pre>
        <p className="mt-2">Toggle it with <code className="font-mono">NIGHTLY_ENABLED</code>.</p>
      </div>
    </div>
  );
}
