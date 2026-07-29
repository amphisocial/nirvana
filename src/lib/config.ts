// Central runtime config, resolved from environment.

const KEYS = {
  anthropic: process.env.ANTHROPIC_API_KEY || "",
  openai: process.env.OPENAI_API_KEY || "",
  gemini: process.env.GEMINI_API_KEY || "",
};

// Resolve provider: explicit AI_PROVIDER wins; otherwise infer from whichever
// key is present; otherwise "mock" (the deterministic simulation engine).
function resolveProvider(): "anthropic" | "openai" | "gemini" | "mock" {
  const explicit = (process.env.AI_PROVIDER || "").toLowerCase();
  if (["anthropic", "openai", "gemini", "mock"].includes(explicit)) return explicit as any;
  if (KEYS.anthropic) return "anthropic";
  if (KEYS.openai) return "openai";
  if (KEYS.gemini) return "gemini";
  return "mock";
}

const provider = resolveProvider();

const DEFAULT_MODEL: Record<string, string> = {
  anthropic: "claude-sonnet-4-6",
  openai: "gpt-4o-mini",
  gemini: "gemini-1.5-flash",
};

export const config = {
  ai: {
    provider,
    keys: KEYS,
    // AI_MODEL must match the chosen provider (as in your old app). Falls back
    // to a sane per-provider default when unset.
    model: process.env.AI_MODEL || DEFAULT_MODEL[provider] || "",
    key(): string {
      return provider === "mock" ? "" : (KEYS as any)[provider] || "";
    },
    get enabled(): boolean {
      return provider !== "mock" && Boolean(this.key());
    },
  },
  market: {
    provider: (process.env.MARKET_DATA_PROVIDER || "mock").toLowerCase(),
    finnhubKey: process.env.FINNHUB_API_KEY || "",
    alphavantageKey: process.env.ALPHAVANTAGE_API_KEY || "",
    listing: (process.env.MARKET_LISTING || "both").toLowerCase() as "nasdaq" | "nyse" | "both",
  },
  nightly: {
    enabled: (process.env.NIGHTLY_ENABLED || "true").toLowerCase() === "true",
    secret: process.env.CRON_SECRET || "",
  },
  admin: {
    // Comma-separated Google emails allowed into /admin. Falls back to the
    // single ADMIN_EMAIL. If empty, admin is locked until you set it.
    emails: (process.env.ADMIN_EMAILS || process.env.ADMIN_EMAIL || "")
      .split(",")
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  },
};

// "ai" when any real LLM provider is active, "simulated" otherwise.
export const engineName = (): "ai" | "simulated" =>
  config.ai.enabled ? "ai" : "simulated";

export function isAdmin(email?: string | null): boolean {
  return Boolean(email) && config.admin.emails.includes((email as string).toLowerCase());
}
export function adminConfigured(): boolean {
  return config.admin.emails.length > 0;
}
