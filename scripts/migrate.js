import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../server/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.join(__dirname, '..', 'db');

async function ensureMigrationTable() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

async function run() {
  await ensureMigrationTable();
  const files = (await fs.readdir(migrationsDir))
    .filter((name) => /^\d+.*\.sql$/i.test(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  for (const filename of files) {
    const alreadyApplied = await pool.query(
      'SELECT 1 FROM schema_migrations WHERE filename = $1',
      [filename]
    );
    if (alreadyApplied.rowCount) {
      console.log(`Skipping ${filename}; already applied.`);
      continue;
    }

    const sql = await fs.readFile(path.join(migrationsDir, filename), 'utf8');
    console.log(`Applying ${filename}...`);
    await pool.query(sql);
    await pool.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [filename]);
    console.log(`Applied ${filename}.`);
  }

  console.log('Nirvana database migrations completed.');
}

try {
  await run();
} finally {
  await pool.end();
}
