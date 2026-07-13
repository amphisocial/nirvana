import { pool } from '../db.js';
import { config } from '../config.js';

export const DEMO_USER_ID = '11111111-1111-4111-8111-111111111111';
export const DEMO_HOUSEHOLD_ID = '22222222-2222-4222-8222-222222222222';

export function requireAuth(req, res, next) {
  if (config.demoMode) {
    req.user = req.user || {
      id: DEMO_USER_ID,
      email: 'demo@nirvana.local',
      display_name: 'Nirvana Demo'
    };
    return next();
  }
  if (req.isAuthenticated?.() && req.user) return next();
  return res.status(401).json({ error: 'Authentication required' });
}

export async function householdContext(req, res, next) {
  try {
    if (config.demoMode) {
      req.householdId = DEMO_HOUSEHOLD_ID;
      req.householdRole = 'owner';
      return next();
    }

    const requested = req.session?.householdId || req.user.active_household_id || null;
    let result;
    if (requested) {
      result = await pool.query(`
        SELECT h.id, hm.role
        FROM households h JOIN household_members hm ON hm.household_id=h.id
        WHERE hm.user_id=$1 AND h.id=$2
        LIMIT 1`, [req.user.id, requested]);
    }
    if (!result?.rowCount) {
      result = await pool.query(`
        SELECT h.id, hm.role
        FROM households h JOIN household_members hm ON hm.household_id=h.id
        WHERE hm.user_id=$1
        ORDER BY CASE hm.role WHEN 'owner' THEN 0 ELSE 1 END, h.created_at
        LIMIT 1`, [req.user.id]);
    }
    if (!result.rowCount) return res.status(404).json({ error: 'No household is associated with this user' });

    req.householdId = result.rows[0].id;
    req.householdRole = result.rows[0].role;
    if (req.session) req.session.householdId = req.householdId;
    next();
  } catch (error) {
    next(error);
  }
}
