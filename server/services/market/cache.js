import { pool } from '../../db.js';
import { config } from '../../config.js';

export async function getCached(key) {
  const result = await pool.query(
    'SELECT payload FROM market_cache WHERE cache_key = $1 AND expires_at > now()',
    [key]
  );
  return result.rows[0]?.payload || null;
}

export async function setCached(key, payload, ttlMinutes = config.market.cacheMinutes) {
  await pool.query(
    `INSERT INTO market_cache (cache_key, payload, expires_at)
     VALUES ($1, $2::jsonb, now() + ($3 || ' minutes')::interval)
     ON CONFLICT (cache_key) DO UPDATE SET
       payload = EXCLUDED.payload,
       expires_at = EXCLUDED.expires_at,
       created_at = now()`,
    [key, JSON.stringify(payload), String(ttlMinutes)]
  );
  return payload;
}
