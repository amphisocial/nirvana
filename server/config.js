import 'dotenv/config';

function bool(value, fallback = false) {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
}

function int(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const nodeEnv = process.env.NODE_ENV || 'development';

export const config = {
  nodeEnv,
  port: int(process.env.PORT, 5015),
  appUrl: process.env.APP_URL || 'http://localhost:5015',
  sessionSecret: process.env.SESSION_SECRET || 'development-only-change-me',
  trustProxy: int(process.env.TRUST_PROXY, 1),
  demoMode: bool(process.env.DEMO_MODE, false),
  databaseUrl: process.env.DATABASE_URL,
  databaseSsl: bool(process.env.DATABASE_SSL, false),
  dbPoolMax: int(process.env.DB_POOL_MAX, 10),
  google: {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackUrl: process.env.GOOGLE_CALLBACK_URL || `${process.env.APP_URL || 'http://localhost:5015'}/auth/google/callback`
  },
  email: {
    enabled: bool(process.env.SMTP_ENABLED, false),
    host: process.env.SMTP_HOST || null,
    port: int(process.env.SMTP_PORT, 587),
    secure: bool(process.env.SMTP_SECURE, false),
    user: process.env.SMTP_USER || null,
    password: process.env.SMTP_PASSWORD || null,
    fromEmail: process.env.SMTP_FROM_EMAIL || process.env.SMTP_USER || null,
    fromName: process.env.SMTP_FROM_NAME || 'Nirvana',
    replyTo: process.env.SMTP_REPLY_TO || null
  },
  ai: {
    provider: (process.env.AI_PROVIDER || 'mock').toLowerCase(),
    model: process.env.AI_MODEL || 'gpt-5-mini',
    maxOutputTokens: int(process.env.AI_MAX_OUTPUT_TOKENS, 1600),
    openaiApiKey: process.env.OPENAI_API_KEY,
    geminiApiKey: process.env.GEMINI_API_KEY,
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
    anthropicVersion: process.env.ANTHROPIC_VERSION || '2023-06-01',
    webSearchEnabled: bool(process.env.AI_WEB_SEARCH_ENABLED, true),
    webSearchContextSize: process.env.AI_WEB_SEARCH_CONTEXT_SIZE || 'medium',
    skillsDir: process.env.AI_SKILLS_DIR || 'server/skills',
    enabledSkills: (process.env.AI_ENABLED_SKILLS || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean),
    systemMode: process.env.AI_SYSTEM_MODE || 'research_only',
    allowPersonalizedRecommendations: bool(process.env.ALLOW_PERSONALIZED_RECOMMENDATIONS, false),
    allowTradeExecution: bool(process.env.ALLOW_TRADE_EXECUTION, false)
  },
  market: {
    provider: (process.env.MARKET_DATA_PROVIDER || 'mock').toLowerCase(),
    alphaVantageApiKey: process.env.ALPHAVANTAGE_API_KEY,
    cacheMinutes: int(process.env.MARKET_CACHE_MINUTES, 30),
    researchCacheMinutes: int(process.env.MARKET_RESEARCH_CACHE_MINUTES, 720),
    newsCacheMinutes: int(process.env.MARKET_NEWS_CACHE_MINUTES, 30),
    newsLimit: int(process.env.MARKET_NEWS_LIMIT, 8),
    delayNotice: process.env.MARKET_DATA_DELAY_NOTICE || 'Market data may be delayed or incomplete.'
  },
  agent: {
    schedulerEnabled: bool(process.env.AGENT_SCHEDULER_ENABLED, nodeEnv === 'production'),
    timezone: process.env.AGENT_TIMEZONE || 'America/New_York',
    nightlyHour: int(process.env.AGENT_NIGHTLY_HOUR, 2),
    weeklyDay: int(process.env.AGENT_WEEKLY_DAY, 0),
    weeklyHour: int(process.env.AGENT_WEEKLY_HOUR, 3),
    maxSymbolsPerRun: int(process.env.AGENT_MAX_SYMBOLS_PER_RUN, 250),
    driftThresholdPct: number(process.env.AGENT_DRIFT_THRESHOLD_PCT, 5),
    largeExpenseThreshold: number(process.env.AGENT_LARGE_EXPENSE_THRESHOLD, 1000)
  },
  plaid: {
    enabled: bool(process.env.PLAID_ENABLED, false),
    aggregationMode: process.env.ACCOUNT_AGGREGATION_MODE || 'manual',
    environment: process.env.PLAID_ENV || 'sandbox',
    clientId: process.env.PLAID_CLIENT_ID,
    secret: process.env.PLAID_SECRET,
    products: (process.env.PLAID_PRODUCTS || 'transactions,investments,liabilities').split(',').map((x) => x.trim()),
    countryCodes: (process.env.PLAID_COUNTRY_CODES || 'US').split(',').map((x) => x.trim()),
    webhookUrl: process.env.PLAID_WEBHOOK_URL,
    redirectUri: process.env.PLAID_REDIRECT_URI
  },
  stripe: {
    enabled: bool(process.env.STRIPE_ENABLED, false),
    secretKey: process.env.STRIPE_SECRET_KEY,
    publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
    proPriceId: process.env.STRIPE_PRICE_PRO,
    successUrl: process.env.STRIPE_SUCCESS_URL,
    cancelUrl: process.env.STRIPE_CANCEL_URL
  },
  disclaimer: {
    title: process.env.FINANCIAL_DISCLAIMER_TITLE || 'Educational research only',
    text: process.env.FINANCIAL_DISCLAIMER_TEXT || 'These results are educational and are not investment, tax, legal, or retirement advice.'
  }
};

if (!config.databaseUrl) {
  console.warn('DATABASE_URL is not set. Database-backed endpoints will fail until configured.');
}
