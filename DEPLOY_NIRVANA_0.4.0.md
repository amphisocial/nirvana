# Deploy Nirvana 0.4.0

This update is built against GitHub `main` commit:

```text
91fa94f60a8d7398dbef3d1ae42d60b1df85f2ea
```

It does not modify `.env`, `node_modules`, Nginx, PM2 configuration, or another application.

## Deploy the patch

Upload these two files to the server:

```text
/tmp/nirvana-0.4.0.patch
/tmp/deploy-nirvana-0.4.0.sh
```

Then run:

```bash
chmod +x /tmp/deploy-nirvana-0.4.0.sh
/tmp/deploy-nirvana-0.4.0.sh
```

The script verifies the repository is clean and at the expected commit, creates a source backup, validates the patch, runs syntax checks and tests, applies database migration 004, and restarts only the `nirvana` PM2 process.

## Manual equivalent

```bash
cd /opt/apps/nirvana

git status --short
git pull --ff-only origin main
test "$(git rev-parse HEAD)" = "91fa94f60a8d7398dbef3d1ae42d60b1df85f2ea"

git apply --check /tmp/nirvana-0.4.0.patch
git apply /tmp/nirvana-0.4.0.patch

node --check public/app.js
node --check public/planning-ui.js
node --check public/portfolio-ui.js
node --check server/routes/accounts.js
node --check server/routes/planning.js
node --check server/services/account-forecast.js
node --check server/services/net-worth-projection.js

npm test
npm run db:migrate

pm2 restart nirvana --update-env
pm2 save
pm2 logs nirvana --lines 100
```

Hard-refresh Chrome with `Command + Shift + R`.

## Commit after validation

```bash
cd /opt/apps/nirvana
git add README.md DEPLOY_NIRVANA_0.4.0.md db docs public server tests package.json package-lock.json
git commit -m "Add blue planning dashboard and holdings forecasts"
git push origin main
```
