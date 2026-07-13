import { withTransaction } from '../db.js';

export async function upsertGoogleUser(profile) {
  return withTransaction(async (client) => {
    const email = profile.emails?.[0]?.value;
    if (!email) throw new Error('Google account did not provide an email address');
    const normalizedEmail = email.toLowerCase();

    const userResult = await client.query(
      `INSERT INTO users (google_id, email, display_name, avatar_url, updated_at)
       VALUES ($1, $2, $3, $4, now())
       ON CONFLICT (email) DO UPDATE SET
         google_id = EXCLUDED.google_id,
         display_name = EXCLUDED.display_name,
         avatar_url = EXCLUDED.avatar_url,
         updated_at = now()
       RETURNING *`,
      [profile.id, normalizedEmail, profile.displayName || email, profile.photos?.[0]?.value || null]
    );
    let user = userResult.rows[0];

    const inviteResult = await client.query(`
      SELECT * FROM household_invites
      WHERE lower(email)=lower($1) AND status='pending'
      ORDER BY created_at
      LIMIT 1`, [normalizedEmail]);
    if (inviteResult.rowCount) {
      const invite = inviteResult.rows[0];
      await client.query(`
        INSERT INTO household_members (household_id, user_id, role)
        VALUES ($1,$2,$3)
        ON CONFLICT (household_id, user_id) DO UPDATE SET role=EXCLUDED.role`,
      [invite.household_id, user.id, invite.role]);
      await client.query(`
        UPDATE household_invites SET status='accepted', accepted_by_user_id=$2,
          accepted_at=now() WHERE id=$1`, [invite.id, user.id]);
      const updated = await client.query(`UPDATE users SET active_household_id=$2 WHERE id=$1 RETURNING *`, [user.id, invite.household_id]);
      user = updated.rows[0];
    }

    const householdResult = await client.query(`
      SELECT h.* FROM households h
      JOIN household_members hm ON hm.household_id = h.id
      WHERE hm.user_id = $1 LIMIT 1`, [user.id]);

    if (!householdResult.rowCount) {
      const household = await client.query(`
        INSERT INTO households (owner_user_id, name)
        VALUES ($1, $2) RETURNING *`, [user.id, `${user.display_name}'s Household`]);
      await client.query(`
        INSERT INTO household_members (household_id, user_id, role)
        VALUES ($1, $2, 'owner')`, [household.rows[0].id, user.id]);
      await client.query(`
        INSERT INTO retirement_plans (household_id) VALUES ($1)
        ON CONFLICT (household_id) DO NOTHING`, [household.rows[0].id]);
      const updated = await client.query(`UPDATE users SET active_household_id=$2 WHERE id=$1 RETURNING *`, [user.id, household.rows[0].id]);
      user = updated.rows[0];
    } else if (!user.active_household_id) {
      const updated = await client.query(`UPDATE users SET active_household_id=$2 WHERE id=$1 RETURNING *`, [user.id, householdResult.rows[0].id]);
      user = updated.rows[0];
    }
    return user;
  });
}
