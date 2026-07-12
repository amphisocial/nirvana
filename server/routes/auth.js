import { Router } from 'express';
import { passport } from '../auth.js';
import { config } from '../config.js';

export function createAuthRouter(googleEnabled) {
  const router = Router();

  router.get('/api/auth/status', (req, res) => {
    const demoUser = config.demoMode ? { id: 'demo', email: 'demo@nirvana.local', displayName: 'Nirvana Demo' } : null;
    res.json({
      authenticated: config.demoMode || Boolean(req.user),
      user: req.user ? {
        id: req.user.id,
        email: req.user.email,
        displayName: req.user.display_name,
        avatarUrl: req.user.avatar_url
      } : demoUser,
      googleEnabled,
      demoMode: config.demoMode
    });
  });

  router.get('/auth/google', (req, res, next) => {
    if (!googleEnabled) return res.status(503).send('Google OAuth is not configured.');
    return passport.authenticate('google', { scope: ['profile', 'email'] })(req, res, next);
  });

  router.get('/auth/google/callback', (req, res, next) => {
    if (!googleEnabled) return res.status(503).send('Google OAuth is not configured.');
    return passport.authenticate('google', { failureRedirect: '/?auth=failed' })(req, res, () => res.redirect('/app.html'));
  });

  router.post('/api/auth/logout', (req, res, next) => {
    if (config.demoMode) return res.json({ ok: true, demoMode: true });
    req.logout((error) => {
      if (error) return next(error);
      req.session.destroy(() => res.json({ ok: true }));
    });
  });

  return router;
}
