-- NIRVANA schema. Run against your database:
--   psql "$DATABASE_URL" -f db/schema.sql
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
