import pg from "pg";
import { readFileSync } from "fs";

// Load DATABASE_URL from .env.local if not already in the environment.
if (!process.env.DATABASE_URL) {
  try {
    for (const line of readFileSync(".env.local", "utf8").split("\n")) {
      const m = line.match(/^\s*DATABASE_URL\s*=\s*(.+)\s*$/);
      if (m) process.env.DATABASE_URL = m[1].replace(/^["']|["']$/g, "");
    }
  } catch {}
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Add it to .env.local or the environment.");
  process.exit(1);
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS nirvana_portfolios (
  id          TEXT PRIMARY KEY,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  data        JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS nirvana_portfolios_created_idx ON nirvana_portfolios (created_at DESC);
CREATE TABLE IF NOT EXISTS nirvana_blog_posts (
  slug        TEXT PRIMARY KEY,
  date        TIMESTAMPTZ NOT NULL,
  data        JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS nirvana_blog_date_idx ON nirvana_blog_posts (date DESC);
`;

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.PGSSL === "require" ? { rejectUnauthorized: false } : undefined,
});
await pool.query(SCHEMA);
console.log("✓ NIRVANA schema is ready (nirvana_portfolios, nirvana_blog_posts).");
await pool.end();
