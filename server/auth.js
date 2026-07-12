import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { pool } from './db.js';
import { config } from './config.js';
import { upsertGoogleUser } from './services/user-service.js';

export function configurePassport() {
  passport.serializeUser((user, done) => done(null, user.id));
  passport.deserializeUser(async (id, done) => {
    try {
      const result = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
      done(null, result.rows[0] || false);
    } catch (error) {
      done(error);
    }
  });

  if (!config.google.clientId || !config.google.clientSecret) {
    console.warn('Google OAuth is disabled because GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET are not configured.');
    return false;
  }

  passport.use(new GoogleStrategy({
    clientID: config.google.clientId,
    clientSecret: config.google.clientSecret,
    callbackURL: config.google.callbackUrl
  }, async (_accessToken, _refreshToken, profile, done) => {
    try {
      done(null, await upsertGoogleUser(profile));
    } catch (error) {
      done(error);
    }
  }));

  return true;
}

export { passport };
