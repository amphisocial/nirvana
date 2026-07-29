// Seeds a few "Analyst of the Day" posts so the homepage isn't empty on first
// run. Writes to Postgres when DATABASE_URL is set (loaded from .env.local),
// otherwise to data/blog.json.
import { promises as fs } from "fs";
import { readFileSync } from "fs";
import path from "path";

if (!process.env.DATABASE_URL) {
  try {
    for (const line of readFileSync(".env.local", "utf8").split("\n")) {
      const m = line.match(/^\s*DATABASE_URL\s*=\s*(.+)\s*$/);
      if (m) process.env.DATABASE_URL = m[1].replace(/^["']|["']$/g, "");
    }
  } catch {}
}

const picks = [
  { symbol: "NVDA", name: "NVIDIA", tier: "high", sector: "Technology" },
  { symbol: "COST", name: "Costco", tier: "medium", sector: "Consumer Defensive" },
  { symbol: "LLY", name: "Eli Lilly", tier: "medium", sector: "Healthcare" },
];
const posts = picks.map((p, i) => {
  const d = new Date(Date.now() - i * 86400000);
  const date = d.toISOString().slice(0, 10);
  return {
    slug: `${date}-${p.symbol.toLowerCase()}`,
    date: d.toISOString(),
    title: `Analyst of the Day: ${p.name} (${p.symbol})`,
    dek: `Overnight screen · ${p.sector}`,
    pick: { symbol: p.symbol, name: p.name, growthTier: p.tier },
    body: [
      `Overnight the desk re-ran the NASDAQ and NYSE large-cap screen. ${p.name} (${p.symbol}) carried the strongest net conviction after debate.`,
      `Research classifies it ${p.tier} growth within ${p.sector}. The bull case rests on durable demand and pricing power; the bear case is a full valuation that leaves little room for a stumble.`,
      `The risk desk would size it deliberately rather than chase it. This is a research note for education, not personal investment advice.`,
    ],
    author: "debater",
    engine: "simulated",
  };
});

if (process.env.DATABASE_URL) {
  const pg = (await import("pg")).default;
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.PGSSL === "require" ? { rejectUnauthorized: false } : undefined,
  });
  await pool.query(`CREATE TABLE IF NOT EXISTS nirvana_blog_posts (slug TEXT PRIMARY KEY, date TIMESTAMPTZ NOT NULL, data JSONB NOT NULL);`);
  for (const post of posts) {
    await pool.query(
      `INSERT INTO nirvana_blog_posts (slug, date, data) VALUES ($1,$2,$3) ON CONFLICT (slug) DO NOTHING`,
      [post.slug, post.date, post]
    );
  }
  await pool.end();
  console.log(`Seeded ${posts.length} posts → Postgres (nirvana_blog_posts)`);
} else {
  const DIR = path.join(process.cwd(), "data");
  const BLOG = path.join(DIR, "blog.json");
  await fs.mkdir(DIR, { recursive: true });
  let existing = [];
  try { existing = JSON.parse(await fs.readFile(BLOG, "utf8")); } catch {}
  const bySlug = new Map(existing.map((p) => [p.slug, p]));
  for (const p of posts) if (!bySlug.has(p.slug)) existing.unshift(p);
  existing.sort((a, b) => b.date.localeCompare(a.date));
  await fs.writeFile(BLOG, JSON.stringify(existing, null, 2));
  console.log(`Seeded ${posts.length} posts → data/blog.json`);
}
