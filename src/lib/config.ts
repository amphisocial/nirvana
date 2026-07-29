// Central runtime config, resolved from environment.
export const config = {
  ai: {
    key: process.env.ANTHROPIC_API_KEY || "",
    model: process.env.AI_MODEL || "claude-sonnet-4-6",
    get enabled() {
      return Boolean(process.env.ANTHROPIC_API_KEY);
    },
  },
  market: {
    provider: (process.env.MARKET_DATA_PROVIDER || "mock").toLowerCase(),
    finnhubKey: process.env.FINNHUB_API_KEY || "",
    listing: (process.env.MARKET_LISTING || "both").toLowerCase() as
      | "nasdaq"
      | "nyse"
      | "both",
  },
  nightly: {
    enabled: (process.env.NIGHTLY_ENABLED || "true").toLowerCase() === "true",
    secret: process.env.CRON_SECRET || "",
  },
  admin: {
    email: process.env.ADMIN_EMAIL || "admin@nirvana.capital",
  },
};

export const engineName = (): "claude" | "simulated" =>
  config.ai.enabled ? "claude" : "simulated";
