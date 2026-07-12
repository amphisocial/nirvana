import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from '../server/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sql = await fs.readFile(path.join(__dirname, '..', 'db', '001_init.sql'), 'utf8');

try {
  await pool.query(sql);
  console.log('Nirvana database migration completed.');
} finally {
  await pool.end();
}
