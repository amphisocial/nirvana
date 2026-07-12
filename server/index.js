import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import session from 'express-session';
import connectPgSimple from 'connect-pg-simple';
import { ZodError } from 'zod';
import { config } from './config.js';
import { pool } from './db.js';
import { configurePassport, passport } from './auth.js';
import { createAuthRouter } from './routes/auth.js';
import { requireAuth, householdContext } from './middleware/auth.js';
import { dashboardRouter } from './routes/dashboard.js';
import { accountsRouter } from './routes/accounts.js';
import { marketRouter } from './routes/market.js';
import { scenariosRouter } from './routes/scenarios.js';
import { retirementRouter } from './routes/retirement.js';
import { planningRouter } from './routes/planning.js';
import { chatRouter } from './routes/chat.js';
import { settingsRouter } from './routes/settings.js';
import { stripeRouter, stripeWebhookHandler } from './routes/stripe.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, '../public');
const app = express();
const PgSession = connectPgSimple(session);

app.set('trust proxy', config.trustProxy);
app.disable('x-powered-by');
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", 'https://cdn.jsdelivr.net'],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'https:'],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", 'data:'],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"]
    }
  }
}));

// Stripe requires the original request bytes for signature verification.
app.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), stripeWebhookHandler);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: false, limit: '1mb' }));
app.use(session({
  store: new PgSession({ pool, tableName: 'user_sessions', createTableIfMissing: true }),
  name: 'nirvana.sid',
  secret: config.sessionSecret,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    secure: config.nodeEnv === 'production',
    sameSite: 'lax',
    maxAge: 1000 * 60 * 60 * 24 * 14
  }
}));
app.use(passport.initialize());
app.use(passport.session());

const googleEnabled = configurePassport();
app.use(createAuthRouter(googleEnabled));

app.get('/api/health', async (_req, res) => {
  let database = 'unavailable';
  try {
    await pool.query('SELECT 1');
    database = 'ok';
  } catch (error) {
    database = `error: ${error.message}`;
  }
  res.status(database === 'ok' ? 200 : 503).json({
    service: 'nirvana',
    status: database === 'ok' ? 'ok' : 'degraded',
    database,
    version: '0.4.0'
  });
});

const apiLimiter = rateLimit({
  windowMs: 60_000,
  limit: 180,
  standardHeaders: 'draft-8',
  legacyHeaders: false
});
const aiLimiter = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  message: { error: 'AI request limit reached. Please retry shortly.' }
});

app.use('/api', apiLimiter);
app.use('/api/dashboard', requireAuth, householdContext, dashboardRouter);
app.use('/api/accounts', requireAuth, householdContext, accountsRouter);
app.use('/api/market', requireAuth, householdContext, marketRouter);
app.use('/api/scenarios', requireAuth, householdContext, scenariosRouter);
app.use('/api/retirement', requireAuth, householdContext, retirementRouter);
app.use('/api/planning', requireAuth, householdContext, planningRouter);
app.use('/api/chat', aiLimiter, requireAuth, householdContext, chatRouter);
app.use('/api/settings', requireAuth, householdContext, settingsRouter);
app.use('/api/stripe', requireAuth, householdContext, stripeRouter);

app.use(express.static(publicDir, {
  extensions: ['html'],
  etag: true,
  maxAge: config.nodeEnv === 'production' ? '1h' : 0,
  setHeaders(res, filePath) {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));

app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'API endpoint not found' });
  return res.status(404).sendFile(path.join(publicDir, '404.html'));
});

app.use((error, _req, res, _next) => {
  if (error instanceof ZodError) {
    return res.status(400).json({
      error: 'Validation failed',
      details: error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message }))
    });
  }
  const status = Number(error.status || error.statusCode || 500);
  if (status >= 500) console.error(error);
  return res.status(status).json({ error: status >= 500 ? 'An unexpected server error occurred' : error.message });
});

const server = app.listen(config.port, () => {
  console.log(`Nirvana listening on ${config.appUrl} (port ${config.port})`);
});

async function shutdown(signal) {
  console.log(`${signal} received; shutting down Nirvana`);
  server.close(async () => {
    await pool.end().catch(() => {});
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
