# Deploy Nirvana on the existing AthenaBot server

This deployment reuses the server components already running SmartJobs, Therapy Agent, and Survey:

- existing Nginx service
- existing PM2 installation
- existing PostgreSQL installation
- existing Certbot installation and renewal timer

Do not install or replace Nginx, PM2, PostgreSQL, or Certbot. Nirvana is added as one more PM2 application, one PostgreSQL database/login, one Nginx server block, and one TLS certificate.

## Nirvana production values

```text
Application directory: /opt/apps/nirvana
PM2 process name:       nirvana
Internal port:          5015
Database:               nirvana
Database login:         nirvana_app
Public hostname:        nirvana.athenabot.ai
Public URL:             https://nirvana.athenabot.ai
```

Keep port `5015` private. Only Nginx should connect to `127.0.0.1:5015`.

## 1. Confirm DNS first

Create or confirm the DNS record for Nirvana points to the same public server as the other AthenaBot applications.

```bash
dig +short nirvana.athenabot.ai
```

The returned IP must match the AthenaBot server before running Certbot.

## 2. Install the Nirvana application files

```bash
cd /opt/apps
git clone https://github.com/amphisocial/nirvana.git
cd /opt/apps/nirvana
npm ci --omit=dev
cp .env.example .env
```

For an existing checkout:

```bash
cd /opt/apps/nirvana
git pull
npm ci --omit=dev
```

Confirm Node.js is version 20 or later:

```bash
node --version
```

## 3. Create the PostgreSQL login, database, and grants

Generate a database password and save it before continuing:

```bash
DB_PASSWORD="$(openssl rand -hex 24)"
echo "$DB_PASSWORD"
```

Create the PostgreSQL login:

```bash
sudo -u postgres psql -v db_password="$DB_PASSWORD" <<'SQL'
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'nirvana_app') THEN
    CREATE ROLE nirvana_app LOGIN;
  END IF;
END
$$;

ALTER ROLE nirvana_app WITH LOGIN PASSWORD :'db_password';
SQL
```

Create the database only if it does not already exist:

```bash
sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='nirvana'" | grep -q 1 \
  || sudo -u postgres createdb -O nirvana_app nirvana
```

Apply ownership and grants:

```bash
sudo -u postgres psql -d postgres <<'SQL'
ALTER DATABASE nirvana OWNER TO nirvana_app;
GRANT ALL PRIVILEGES ON DATABASE nirvana TO nirvana_app;
SQL

sudo -u postgres psql -d nirvana <<'SQL'
CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER SCHEMA public OWNER TO nirvana_app;
GRANT USAGE, CREATE ON SCHEMA public TO nirvana_app;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO nirvana_app;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO nirvana_app;
GRANT ALL PRIVILEGES ON ALL FUNCTIONS IN SCHEMA public TO nirvana_app;

ALTER DEFAULT PRIVILEGES FOR ROLE nirvana_app IN SCHEMA public
  GRANT ALL PRIVILEGES ON TABLES TO nirvana_app;
ALTER DEFAULT PRIVILEGES FOR ROLE nirvana_app IN SCHEMA public
  GRANT ALL PRIVILEGES ON SEQUENCES TO nirvana_app;
ALTER DEFAULT PRIVILEGES FOR ROLE nirvana_app IN SCHEMA public
  GRANT ALL PRIVILEGES ON FUNCTIONS TO nirvana_app;
SQL
```

Test the new database login:

```bash
PGPASSWORD="$DB_PASSWORD" psql \
  -h 127.0.0.1 \
  -U nirvana_app \
  -d nirvana \
  -c 'SELECT current_user, current_database();'
```

Expected values are `nirvana_app` and `nirvana`.

## 4. Configure `/opt/apps/nirvana/.env`

At minimum, set these production values:

```dotenv
NODE_ENV=production
PORT=5015
APP_URL=https://nirvana.athenabot.ai
TRUST_PROXY=1
DEMO_MODE=false

DATABASE_URL=postgresql://nirvana_app:PASTE_DB_PASSWORD_HERE@127.0.0.1:5432/nirvana
DATABASE_SSL=false
DB_POOL_MAX=10

SESSION_SECRET=PASTE_LONG_RANDOM_SECRET_HERE

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_CALLBACK_URL=https://nirvana.athenabot.ai/auth/google/callback

AI_PROVIDER=openai
OPENAI_API_KEY=
OPENAI_MODEL=gpt-4.1-mini

MARKET_DATA_PROVIDER=alphavantage
ALPHAVANTAGE_API_KEY=

PLAID_ENABLED=false
ACCOUNT_AGGREGATION_MODE=manual
ALLOW_PERSONALIZED_RECOMMENDATIONS=false
ALLOW_TRADE_EXECUTION=false
```

Generate the session secret:

```bash
openssl rand -hex 48
```

Protect the file:

```bash
chmod 600 /opt/apps/nirvana/.env
```

## 5. Run the database migration

```bash
cd /opt/apps/nirvana
npm run db:migrate
```

Do not run `npm run db:seed` in production unless you intentionally want demo data.

## 6. Add only the Nirvana PM2 process

PM2 is already installed and already manages the other applications. Add only this process:

```bash
sudo mkdir -p /var/log/pm2
sudo chown "$(id -un)":"$(id -gn)" /var/log/pm2

cd /opt/apps/nirvana
pm2 start ecosystem.config.cjs --env production
pm2 save
```

Do not rerun `pm2 startup` if PM2 startup persistence is already configured for this server user.

Verify the application directly before connecting Nginx:

```bash
pm2 status nirvana
pm2 logs nirvana --lines 100
curl -fsS http://127.0.0.1:5015/api/health
```

## 7. Add Nirvana to the existing Nginx service

Do not install Nginx. Add only this new site file:

```bash
sudo tee /etc/nginx/sites-available/nirvana.athenabot.ai >/dev/null <<'NGINX'
server {
    listen 80;
    listen [::]:80;
    server_name nirvana.athenabot.ai;

    client_max_body_size 10m;

    location / {
        proxy_pass http://127.0.0.1:5015;
        proxy_http_version 1.1;

        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        proxy_connect_timeout 30s;
        proxy_send_timeout 120s;
        proxy_read_timeout 120s;
    }
}
NGINX
```

Enable only the Nirvana site, test the existing shared Nginx configuration, and reload it:

```bash
sudo ln -sfn \
  /etc/nginx/sites-available/nirvana.athenabot.ai \
  /etc/nginx/sites-enabled/nirvana.athenabot.ai

sudo nginx -t
sudo systemctl reload nginx
```

Verify HTTP reaches Nirvana:

```bash
curl -I http://nirvana.athenabot.ai
```

## 8. Issue and install the Nirvana TLS certificate with Certbot

Certbot is already installed for the other AthenaBot applications. Issue a certificate specifically for Nirvana and let Certbot add the HTTPS configuration and redirect:

```bash
sudo certbot --nginx \
  -d nirvana.athenabot.ai \
  --redirect
```

Confirm the Nirvana certificate is installed:

```bash
sudo certbot certificates
```

The output should contain:

```text
Domains: nirvana.athenabot.ai
```

Confirm automatic renewal still works for all certificates:

```bash
sudo certbot renew --dry-run
```

Confirm the existing Certbot renewal timer is enabled:

```bash
systemctl status certbot.timer --no-pager
```

Only if Certbot is unexpectedly missing, install the Nginx plugin using the server's Ubuntu packages:

```bash
sudo apt update
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d nirvana.athenabot.ai --redirect
```

Do not reinstall Certbot when `certbot --version` already works.

## 9. Configure external service URLs

Google OAuth authorized redirect URI:

```text
https://nirvana.athenabot.ai/auth/google/callback
```

Stripe webhook endpoint:

```text
https://nirvana.athenabot.ai/api/stripe/webhook
```

Plaid remains disabled during Phase 1.

## 10. Final validation

```bash
curl -fsS https://nirvana.athenabot.ai/api/health
pm2 status nirvana
sudo nginx -t
sudo certbot certificates
```

Also confirm:

- Google sign-in returns to `nirvana.athenabot.ai`.
- The dashboard opens after authentication.
- Manual accounts and holdings can be saved.
- Stock history charts load from the configured market-data provider.
- AI chat uses the configured provider and Markdown skills.
- `DEMO_MODE=false` in production.
- Port `5015` is not exposed publicly.

## Updating Nirvana later

```bash
cd /opt/apps/nirvana
git pull
npm ci --omit=dev
npm run db:migrate
pm2 restart nirvana --update-env
pm2 save
curl -fsS https://nirvana.athenabot.ai/api/health
```
