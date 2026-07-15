import { Router } from 'express';
import { z } from 'zod';
import { pool, withTransaction } from '../db.js';
import { sendHouseholdInviteEmail } from '../services/email-service.js';

export const householdSharingRouter = Router();

const inviteSchema = z.object({
  email: z.string().email().max(320),
  role: z.enum(['member', 'viewer']).default('member')
});
const switchSchema = z.object({ householdId: z.string().uuid() });

function requireOwner(req) {
  if (req.householdRole !== 'owner') {
    const error = new Error('Only the primary household owner can manage sharing');
    error.status = 403;
    throw error;
  }
}

householdSharingRouter.get('/', async (req, res, next) => {
  try {
    const [householdResult, membersResult, invitesResult, membershipsResult] = await Promise.all([
      pool.query(`SELECT id, name, owner_user_id, created_at FROM households WHERE id=$1`, [req.householdId]),
      pool.query(`
        SELECT u.id, u.email, u.display_name, u.avatar_url, hm.role
        FROM household_members hm JOIN users u ON u.id=hm.user_id
        WHERE hm.household_id=$1
        ORDER BY CASE hm.role WHEN 'owner' THEN 0 ELSE 1 END, u.display_name`, [req.householdId]),
      pool.query(`
        SELECT id, email, role, status, created_at, accepted_at
        FROM household_invites WHERE household_id=$1 AND status IN ('pending','accepted')
        ORDER BY created_at DESC`, [req.householdId]),
      pool.query(`
        SELECT h.id, h.name, hm.role
        FROM household_members hm JOIN households h ON h.id=hm.household_id
        WHERE hm.user_id=$1
        ORDER BY CASE hm.role WHEN 'owner' THEN 0 ELSE 1 END, h.name`, [req.user.id])
    ]);
    res.json({
      household: householdResult.rows[0], role: req.householdRole,
      members: membersResult.rows, invites: invitesResult.rows,
      memberships: membershipsResult.rows, activeHouseholdId: req.householdId
    });
  } catch (error) { next(error); }
});

householdSharingRouter.post('/invite', async (req, res, next) => {
  try {
    requireOwner(req);
    const value = inviteSchema.parse(req.body);
    const email = value.email.toLowerCase();
    if (email === req.user.email.toLowerCase()) return res.status(400).json({ error: 'You already own this household' });

    const result = await withTransaction(async (client) => {
      const householdResult = await client.query(`SELECT name FROM households WHERE id=$1`, [req.householdId]);
      if (!householdResult.rowCount) {
        const error = new Error('Household not found');
        error.status = 404;
        throw error;
      }
      const householdName = householdResult.rows[0].name;
      const existingUser = await client.query(`SELECT * FROM users WHERE lower(email)=lower($1)`, [email]);
      if (existingUser.rowCount) {
        const user = existingUser.rows[0];
        await client.query(`
          INSERT INTO household_members (household_id, user_id, role)
          VALUES ($1,$2,$3)
          ON CONFLICT (household_id, user_id) DO UPDATE SET role=EXCLUDED.role`, [req.householdId, user.id, value.role]);
        await client.query(`UPDATE users SET active_household_id=$2 WHERE id=$1`, [user.id, req.householdId]);
        let invite = await client.query(`
          UPDATE household_invites
          SET role=$3, status='accepted', invited_by_user_id=$4,
              accepted_by_user_id=$5, accepted_at=now(), revoked_at=NULL
          WHERE household_id=$1 AND lower(email)=lower($2) AND status='pending'
          RETURNING *`, [req.householdId, email, value.role, req.user.id, user.id]);
        if (!invite.rowCount) {
          invite = await client.query(`
            INSERT INTO household_invites
              (household_id, email, role, status, invited_by_user_id, accepted_by_user_id, accepted_at)
            VALUES ($1,$2,$3,'accepted',$4,$5,now())
            RETURNING *`, [req.householdId, email, value.role, req.user.id, user.id]);
        }
        return { status: 'accepted', invite: invite.rows[0], member: user, householdName };
      }
      const pending = await client.query(`
        SELECT id FROM household_invites
        WHERE household_id=$1 AND lower(email)=lower($2) AND status='pending'
        LIMIT 1`, [req.householdId, email]);
      const invite = pending.rowCount
        ? await client.query(`
            UPDATE household_invites
            SET role=$2, invited_by_user_id=$3, created_at=now()
            WHERE id=$1 RETURNING *`, [pending.rows[0].id, value.role, req.user.id])
        : await client.query(`
            INSERT INTO household_invites (household_id, email, role, invited_by_user_id)
            VALUES ($1,$2,$3,$4) RETURNING *`, [req.householdId, email, value.role, req.user.id]);
      return { status: 'pending', invite: invite.rows[0], householdName };
    });

    const { householdName, ...responseResult } = result;
    let emailDelivery;
    try {
      emailDelivery = await sendHouseholdInviteEmail({
        to: email,
        inviterName: req.user.display_name || req.user.email,
        householdName,
        role: value.role,
        accepted: result.status === 'accepted'
      });
    } catch (error) {
      console.error('Household invitation email delivery failed', {
        inviteId: result.invite?.id,
        householdId: req.householdId,
        error: error.message
      });
      emailDelivery = { sent: false, skipped: false, error: 'Email delivery failed' };
    }

    res.status(201).json({ ...responseResult, emailDelivery });
  } catch (error) { next(error); }
});

householdSharingRouter.delete('/invite/:id', async (req, res, next) => {
  try {
    requireOwner(req);
    const result = await pool.query(`
      UPDATE household_invites SET status='revoked', revoked_at=now()
      WHERE id=$1 AND household_id=$2 AND status='pending' RETURNING id`, [req.params.id, req.householdId]);
    if (!result.rowCount) return res.status(404).json({ error: 'Pending invite not found' });
    res.json({ ok: true });
  } catch (error) { next(error); }
});

householdSharingRouter.delete('/member/:userId', async (req, res, next) => {
  try {
    requireOwner(req);
    if (req.params.userId === req.user.id) return res.status(400).json({ error: 'The primary owner cannot remove themselves' });
    const result = await pool.query(`
      DELETE FROM household_members
      WHERE household_id=$1 AND user_id=$2 AND role <> 'owner'
      RETURNING user_id`, [req.householdId, req.params.userId]);
    if (!result.rowCount) return res.status(404).json({ error: 'Partner member not found' });
    await pool.query(`UPDATE users SET active_household_id=NULL WHERE id=$1 AND active_household_id=$2`, [req.params.userId, req.householdId]);
    res.json({ ok: true });
  } catch (error) { next(error); }
});

householdSharingRouter.post('/switch', async (req, res, next) => {
  try {
    const value = switchSchema.parse(req.body);
    const result = await pool.query(`
      SELECT 1 FROM household_members WHERE household_id=$1 AND user_id=$2`, [value.householdId, req.user.id]);
    if (!result.rowCount) return res.status(403).json({ error: 'You do not have access to that household' });
    req.session.householdId = value.householdId;
    await pool.query(`UPDATE users SET active_household_id=$2 WHERE id=$1`, [req.user.id, value.householdId]);
    res.json({ ok: true, householdId: value.householdId });
  } catch (error) { next(error); }
});
