import { Pool } from "pg";

// Singleton pool — Next can re-evaluate modules, so cache on globalThis to
// avoid exhausting Postgres connections across hot reloads / route handlers.
const g = globalThis as unknown as { _nirvanaPool?: Pool; _nirvanaSchema?: Promise<void> };

export function hasDatabase(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export function pool(): Pool {
  if (!g._nirvanaPool) {
    g._nirvanaPool = new Pool({
      connectionString: process.env.DATABASE_URL,
      // Enable TLS for managed Postgres; harmless for local if sslmode not required.
      ssl: process.env.PGSSL === "require" ? { rejectUnauthorized: false } : undefined,
      max: 5,
    });
  }
  return g._nirvanaPool;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS nirvana_portfolios (
  id          TEXT PRIMARY KEY,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  data        JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS nirvana_portfolios_created_idx
  ON nirvana_portfolios (created_at DESC);

CREATE TABLE IF NOT EXISTS nirvana_blog_posts (
  slug        TEXT PRIMARY KEY,
  date        TIMESTAMPTZ NOT NULL,
  data        JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS nirvana_blog_date_idx
  ON nirvana_blog_posts (date DESC);
`;

// Create tables on first use. Idempotent and cached so it runs once per process.
export function ensureSchema(): Promise<void> {
  if (!g._nirvanaSchema) {
    g._nirvanaSchema = pool()
      .query(SCHEMA)
      .then(() => undefined);
  }
  return g._nirvanaSchema;
}
