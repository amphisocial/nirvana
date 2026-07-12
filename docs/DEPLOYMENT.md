# Nirvana deployment

## Server layout

```text
/opt/apps/nirvana
/var/log/pm2/nirvana-out.log
/var/log/pm2/nirvana-error.log
```

## Install

```bash
cd /opt/apps
git clone <repository-url> nirvana
cd nirvana
cp .env.example .env
npm ci
npm run db:migrate
npm run db:seed   # demo/staging only
sudo mkdir -p /var/log/pm2
sudo chown "$USER":"$USER" /var/log/pm2
pm2 start ecosystem.config.cjs --env production
pm2 save
```

## Apache virtual host core

```apache
ProxyPreserveHost On
ProxyPass / http://127.0.0.1:5015/
ProxyPassReverse / http://127.0.0.1:5015/
RequestHeader set X-Forwarded-Proto "https"
```

The Google OAuth callback should be:

```text
https://nirvana.athenabot.ai/auth/google/callback
```

The Stripe webhook should be:

```text
https://nirvana.athenabot.ai/api/stripe/webhook
```

## Production checks

```bash
curl -fsS https://nirvana.athenabot.ai/api/health
pm2 status nirvana
pm2 logs nirvana --lines 100
```

Do not run production with `DEMO_MODE=true`, `AI_PROVIDER=mock`, `MARKET_DATA_PROVIDER=mock`, or the default session secret.
