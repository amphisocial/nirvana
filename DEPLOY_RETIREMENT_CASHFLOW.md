# Deploy Retirement Cash-Flow Planner

Run all commands from the existing Nirvana application directory.

## 1. Back up the current tracked files

```bash
cd /opt/apps/nirvana
git status
git stash push -u -m "before retirement cashflow v1"
```

## 2. Apply the patch

Copy `nirvana-retirement-cashflow-v1.patch` to `/tmp` on the server, then run:

```bash
cd /opt/apps/nirvana
git pull --ff-only origin main
git apply --check /tmp/nirvana-retirement-cashflow-v1.patch
git apply /tmp/nirvana-retirement-cashflow-v1.patch
```

## 3. Validate and migrate

```bash
node --check server/index.js
node --check server/routes/accounts.js
node --check server/routes/planning.js
node --check server/routes/retirement.js
node --check server/services/retirement-cashflow-engine.js
node --check public/app.js
node --check public/planning-ui.js

npm test
npm run db:migrate
```

The migration runner now applies every numbered SQL file in `db/` and records it in `schema_migrations`. It will apply `002_retirement_account_profiles.sql` and `003_retirement_cashflow_planner.sql` automatically when needed.

## 4. Restart only Nirvana

```bash
pm2 restart nirvana --update-env
pm2 save
pm2 logs nirvana --lines 100
```

Hard-refresh Chrome with `Command + Shift + R`.

## 5. Commit after validation

```bash
cd /opt/apps/nirvana
git add .
git commit -m "Add retirement cash-flow planning and feasible-age analysis"
git push origin main
```
