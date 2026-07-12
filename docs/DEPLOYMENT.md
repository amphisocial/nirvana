# Nirvana deployment on the existing AthenaBot server

This guide assumes the server already runs:

- Nginx for `smartjobs.athenabot.ai`, Therapy Agent, and Survey
- PM2 under the same Linux deployment user
- PostgreSQL
- DNS for `nirvana.athenabot.ai` pointing to this server

Do **not** reinstall Nginx or create a second Nginx service. Nirvana is another Node.js/PM2 application behind the existing Nginx instance.

## Deployment values

```text
Application directory: /opt/apps/nirvana
PM2 service name:       nirvana
Internal application:   http://127.0.0.1:5015
Public URL:              https://nirvana.athenabot.ai
PostgreSQL database:     nirvana
PostgreSQL user:         nirvana_app
```

Port `5015` is an internal application port. Do not expose it in the AWS security group or host firewall; public traffic should enter through Nginx on ports 80 and 443.

## 1. Install or update the application

For the first deployment:

```bash
cd /opt/apps
git clone https://github.com/amphisocial/nirvana.git nirvana
cd /opt/apps/nirvana
cp .env.example .env
npm ci --omit=dev
```

For later deployments:

```bash
cd /opt/apps/nirvana
git pull
npm ci --omit=dev
```

The application requires Node.js 20 or later:

```bash
node --version
```

## 2. Create the PostgreSQL user and database

Generate a URL-safe database password:

```bash
DB_PASSWORD="$(openssl rand -hex 24)"
echo "Save this database password: $DB_PASSWORD"
```

Create a dedicated PostgreSQL login, database, extension, ownership, and grants. The commands are safe to rerun: an existing role or database is reused, and the password is updated to the newly generated value.

```bash
sudo -u postgres psql --set=db_password="$DB_PASSWORD" <<'SQL'
SELECT 'CREATE ROLE nirvana_app LOGIN'
WHERE NOT EXISTS (
  SELECT 1 FROM pg_roles WHERE rolname = 'nirvana_app'
) \gexec

ALTER ROLE nirvana_app WITH LOGIN PASSWORD :'db_password';

SELECT 'CREATE DATABASE nirvana OWNER nirvana_app'
WHERE NOT EXISTS (
  SELECT 1 FROM pg_database WHERE datname = 'nirvana'
) \gexec

ALTER DATABASE nirvana OWNER TO nirvana_app;
GRANT ALL PRIVILEGES ON DATABASE nirvana TO nirvana_app;

\connect nirvana

CREATE EXTENSION IF NOT EXISTS pgcrypto;
ALTER SCHEMA public OWNER TO nirvana_app;
GRANT ALL PRIVILEGES ON SCHEMA public TO nirvana_app;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO nirvana_app;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO nirvana_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL PRIVILEGES ON TABLES TO nirvana_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL PRIVILEGES ON SEQUENCES TO nirvana_app;
SQL
```

Set the resulting connection string in `/opt/apps/nirvana/.env`:

```dotenv
DATABASE_URL=postgresql://nirvana_app:PASTE_THE_GENERATED_PASSWORD@127.0.0.1:5432/nirvana
DATABASE_SSL=false
DB_POOL_MAX=10
```

Because the generated password is hexadecimal, it does not require URL encoding. If you choose a password containing characters such as `@`, `/`, `:`, `#`, or `%`, URL-encode the password before putting it in `DATABASE_URL`.

Test the login before running migrations:

```bash
PGPASSWORD="$DB_PASSWORD" psql \
  -h 127.0.0.1 \
  -U nirvana_app \
  -d nirvana \
  -c 'SELECT current_user, current_database();'
```

Run the schema migration as the application user through `DATABASE_URL`:

```bash
cd /opt/apps/nirvana
npm run db:migrate
```

Only seed demo data in a non-production environment:

```bash
npm run db:seed
```

## 3. Configure the production `.env`

At minimum, update these values in `/opt/apps/nirvana/.env`:

```dotenv
NODE_ENV=production
PORT=5015
APP_URL=https://nirvana.athenabot.ai
DEMO_MODE=false
TRUST_PROXY=1

DATABASE_URL=postgresql://nirvana_app:PASTE_THE_GENERATED_PASSWORD@127.0.0.1:5432/nirvana
DATABASE_SSL=false

SESSION_SECRET=PASTE_A_LONG_RANDOM_VALUE

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_CALLBACK_URL=https://nirvana.athenabot.ai/auth/google/callback
```

Generate the session secret with:

```bash
openssl rand -hex 48
```

Also configure the selected AI provider, market-data provider, and Stripe values. Keep these production safeguards:

```dotenv
ALLOW_PERSONALIZED_RECOMMENDATIONS=false
ALLOW_TRADE_EXECUTION=false
PLAID_ENABLED=false
ACCOUNT_AGGREGATION_MODE=manual
```

Until live providers are configured, `AI_PROVIDER=mock` and `MARKET_DATA_PROVIDER=mock` are suitable only for testing—not for a public financial research product.

Restrict access to the environment file:

```bash
chmod 600 /opt/apps/nirvana/.env
```

## 4. Add the Nirvana PM2 service

PM2 already manages the other AthenaBot applications, so only add the Nirvana process. Do not rerun `pm2 startup` if startup persistence is already configured for this Linux user.

```bash
sudo mkdir -p /var/log/pm2
sudo chown "$(id -un)":"$(id -gn)" /var/log/pm2

cd /opt/apps/nirvana
pm2 start ecosystem.config.cjs --env production
pm2 save
```

Confirm the service is healthy locally:

```bash
pm2 status nirvana
pm2 logs nirvana --lines 100
curl -fsS http://127.0.0.1:5015/api/health
```

For subsequent releases:

```bash
cd /opt/apps/nirvana
git pull
npm ci --omit=dev
npm run db:migrate
pm2 restart nirvana --update-env
pm2 save
```

Useful PM2 commands:

```bash
pm2 restart nirvana --update-env
pm2 logs nirvana --lines 200
pm2 describe nirvana
pm2 delete nirvana
```

## 5. Add Nirvana to the existing Nginx instance

Create only a new site definition; do not reinstall or replace Nginx.

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
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;

        proxy_connect_timeout 30s;
        proxy_send_timeout 120s;
        proxy_read_timeout 120s;
    }
}
NGINX
```

Enable the site, validate the complete shared configuration, and reload Nginx without interrupting the other applications:

```bash
sudo ln -sfn \
  /etc/nginx/sites-available/nirvana.athenabot.ai \
  /etc/nginx/sites-enabled/nirvana.athenabot.ai

sudo nginx -t
sudo systemctl reload nginx
```

Before requesting the certificate, verify that DNS resolves to this server and the HTTP virtual host works:

```bash
dig +short nirvana.athenabot.ai
curl -I http://nirvana.athenabot.ai
```

## 6. Install the Nirvana certificate with Certbot

Because Certbot is already used for the other applications, reuse the existing Certbot installation:

```bash
certbot --version
sudo certbot --nginx -d nirvana.athenabot.ai --redirect
```

Certbot will add the TLS certificate and HTTP-to-HTTPS redirect to the Nirvana Nginx site. It should not alter the upstream PM2 configuration for the other applications.

Test automatic renewal:

```bash
sudo certbot renew --dry-run
```

If `certbot` is unexpectedly absent, install it using the same packaging method already used on the server. The current Certbot-recommended Linux installation uses Snap:

```bash
sudo snap install --classic certbot
sudo ln -sfn /snap/bin/certbot /usr/local/bin/certbot
sudo certbot --nginx -d nirvana.athenabot.ai --redirect
```

Do not replace an existing APT-based Certbot installation with Snap during this deployment; mixing installation methods on a server already managing certificates can create operational confusion.

## 7. External callback configuration

Use this Google OAuth callback URL:

```text
https://nirvana.athenabot.ai/auth/google/callback
```

Use this Stripe webhook URL when Stripe is enabled:

```text
https://nirvana.athenabot.ai/api/stripe/webhook
```

Plaid remains disabled in Phase 1. Its future URLs are already represented in `.env.example`.

## 8. Final production checks

```bash
curl -fsS https://nirvana.athenabot.ai/api/health
pm2 status nirvana
sudo nginx -t
sudo systemctl status nginx --no-pager
sudo certbot certificates
```

Expected health output includes:

```json
{
  "service": "nirvana",
  "status": "ok",
  "database": "ok",
  "version": "0.1.0"
}
```

Also confirm:

- Google login returns to the Nirvana domain.
- The dashboard loads after authentication.
- A manual account can be saved.
- A stock chart loads with the configured market-data provider.
- An AI chat request works with the configured AI provider.
- `DEMO_MODE` is `false` in production.
- Port `5015` is not publicly exposed.
