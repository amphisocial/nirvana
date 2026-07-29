import { promises as fs } from "fs";
import path from "path";
import type { BlogPost, PortfolioRecord } from "@/lib/types";
import { ensureSchema, hasDatabase, pool } from "@/lib/db";

// ─────────────────────────────────────────────────────────────
// The store keeps one interface with two backends:
//   • Postgres  — used automatically when DATABASE_URL is set
//   • JSON files (data/*.json) — zero-config fallback for local dev
// Swapping backends requires no changes anywhere else in the app.
// ─────────────────────────────────────────────────────────────

const usePg = hasDatabase();

// ---------- JSON fallback ----------
const DIR = path.join(process.cwd(), "data");
const PORTFOLIOS = path.join(DIR, "portfolios.json");
const BLOG = path.join(DIR, "blog.json");
async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}
async function writeJson(file: string, data: unknown) {
  await fs.mkdir(DIR, { recursive: true });
  await fs.writeFile(file, JSON.stringify(data, null, 2), "utf8");
}

// ---------- portfolios ----------
export async function listPortfolios(): Promise<PortfolioRecord[]> {
  if (usePg) {
    await ensureSchema();
    const { rows } = await pool().query(
      "SELECT data FROM nirvana_portfolios ORDER BY created_at DESC LIMIT 200"
    );
    return rows.map((r) => r.data as PortfolioRecord);
  }
  return readJson<PortfolioRecord[]>(PORTFOLIOS, []);
}

export async function listPortfoliosByUser(email: string): Promise<PortfolioRecord[]> {
  if (usePg) {
    await ensureSchema();
    const { rows } = await pool().query(
      "SELECT data FROM nirvana_portfolios WHERE data->>'userEmail' = $1 ORDER BY created_at DESC LIMIT 200",
      [email]
    );
    return rows.map((r) => r.data as PortfolioRecord);
  }
  const all = await listPortfolios();
  return all.filter((p) => p.userEmail === email);
}

export async function getPortfolio(id: string): Promise<PortfolioRecord | null> {
  if (usePg) {
    await ensureSchema();
    const { rows } = await pool().query("SELECT data FROM nirvana_portfolios WHERE id = $1", [id]);
    return rows[0] ? (rows[0].data as PortfolioRecord) : null;
  }
  const all = await listPortfolios();
  return all.find((p) => p.id === id) ?? null;
}

export async function savePortfolio(rec: PortfolioRecord): Promise<void> {
  if (usePg) {
    await ensureSchema();
    await pool().query(
      `INSERT INTO nirvana_portfolios (id, created_at, data)
       VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET data = EXCLUDED.data`,
      [rec.id, rec.createdAt, rec]
    );
    return;
  }
  const all = await readJson<PortfolioRecord[]>(PORTFOLIOS, []);
  const idx = all.findIndex((p) => p.id === rec.id);
  if (idx >= 0) all[idx] = rec;
  else all.unshift(rec);
  await writeJson(PORTFOLIOS, all.slice(0, 200));
}

export async function deletePortfolio(id: string, email: string): Promise<void> {
  if (usePg) {
    await ensureSchema();
    await pool().query("DELETE FROM nirvana_portfolios WHERE id = $1 AND data->>'userEmail' = $2", [id, email]);
    return;
  }
  const all = await readJson<PortfolioRecord[]>(PORTFOLIOS, []);
  await writeJson(PORTFOLIOS, all.filter((p) => !(p.id === id && p.userEmail === email)));
}

// ---------- blog ----------
export async function listBlog(): Promise<BlogPost[]> {
  if (usePg) {
    await ensureSchema();
    const { rows } = await pool().query(
      "SELECT data FROM nirvana_blog_posts ORDER BY date DESC LIMIT 120"
    );
    return rows.map((r) => r.data as BlogPost);
  }
  const all = await readJson<BlogPost[]>(BLOG, []);
  return all.sort((a, b) => b.date.localeCompare(a.date));
}

export async function getBlog(slug: string): Promise<BlogPost | null> {
  if (usePg) {
    await ensureSchema();
    const { rows } = await pool().query("SELECT data FROM nirvana_blog_posts WHERE slug = $1", [slug]);
    return rows[0] ? (rows[0].data as BlogPost) : null;
  }
  const all = await listBlog();
  return all.find((p) => p.slug === slug) ?? null;
}

export async function saveBlog(post: BlogPost, overwrite = false): Promise<void> {
  if (usePg) {
    await ensureSchema();
    if (overwrite) {
      // Replace any post already dated today, so a manual refresh wins.
      await pool().query("DELETE FROM nirvana_blog_posts WHERE date::date = $1::date", [post.date]);
    }
    await pool().query(
      `INSERT INTO nirvana_blog_posts (slug, date, data)
       VALUES ($1, $2, $3)
       ON CONFLICT (slug) DO ${overwrite ? "UPDATE SET date = EXCLUDED.date, data = EXCLUDED.data" : "NOTHING"}`,
      [post.slug, post.date, post]
    );
    return;
  }
  const all = await readJson<BlogPost[]>(BLOG, []);
  if (overwrite) {
    const day = post.date.slice(0, 10);
    const filtered = all.filter((p) => p.date.slice(0, 10) !== day);
    filtered.unshift(post);
    await writeJson(BLOG, filtered.slice(0, 120));
    return;
  }
  if (all.some((p) => p.slug === post.slug)) return;
  all.unshift(post);
  await writeJson(BLOG, all.slice(0, 120));
}
