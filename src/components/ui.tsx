import type { GrowthTier, RiskTier } from "@/lib/types";

export function Stat({
  label,
  value,
  sub,
  tone = "ink",
}: {
  label: string;
  value: React.ReactNode;
  sub?: string;
  tone?: "ink" | "gain" | "loss" | "brass";
}) {
  const c =
    tone === "gain" ? "text-gain" : tone === "loss" ? "text-loss" : tone === "brass" ? "text-brass" : "text-ink";
  return (
    <div className="card p-4">
      <div className="eyebrow">{label}</div>
      <div className={`mt-1 font-display text-2xl font-black tabular ${c}`}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-sage">{sub}</div>}
    </div>
  );
}

const growthColor: Record<GrowthTier, string> = {
  high: "bg-gain/10 text-gain border-gain/30",
  medium: "bg-brass/10 text-brass border-brass/30",
  low: "bg-sage/10 text-sage border-sage/30",
};
export function GrowthBadge({ tier }: { tier: GrowthTier }) {
  return (
    <span className={`chip border ${growthColor[tier]}`}>
      {tier} growth
    </span>
  );
}

const riskColor: Record<RiskTier, string> = {
  aggressive: "bg-loss/10 text-loss border-loss/30",
  balanced: "bg-brass/10 text-brass border-brass/30",
  defensive: "bg-gain/10 text-gain border-gain/30",
};
export function RiskBadge({ tier }: { tier: RiskTier }) {
  return <span className={`chip border ${riskColor[tier]}`}>{tier}</span>;
}

export function SectionLabel({ n, children }: { n?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3">
      {n && <span className="font-mono text-xs text-brass">{n}</span>}
      <span className="eyebrow">{children}</span>
      <span className="rule flex-1" />
    </div>
  );
}
