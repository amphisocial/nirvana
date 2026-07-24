# Nirvana scheduled-agent controls

Built against `amphisocial/nirvana` main commit:

`c79083521f2bc37bd6c826bc7c49a9963085c939`

## Immediate emergency stop

Before deploying code, you can stop all in-process scheduled workflows,
including the Financial Center and Trading Desk, by setting this in the
production `.env`:

```dotenv
AGENT_SCHEDULER_ENABLED=false
```

Then reload PM2:

```bash
pm2 restart nirvana --update-env
```

## Apply the code patch

From the root of your local Nirvana checkout:

```bash
bash /path/to/this-folder/apply.sh .
npm install
npm run db:migrate
npm test
git add .
git commit -m "Add scheduled agent pause controls"
git push
```

On EC2:

```bash
cd /opt/apps/nirvana
git pull
npm install --omit=dev
npm run db:migrate
pm2 restart nirvana --update-env
pm2 logs nirvana --lines 100
```

Run the migration before restarting because the scheduler reads the new
`household_agent_settings` table.

## What users see

In **Insights**, the household owner gets two switches:

- Nightly Financial Center
- Weekly Financial Center

The owner can save either switch independently or click **Pause both**.
Shared members can see status but cannot change it. Manual runs still work.

Trading Desk overnight automation remains separately controlled under
**Holdings → Trading Desk → Settings**.

## Server-wide controls

```dotenv
AGENT_SCHEDULER_ENABLED=true
AGENT_NIGHTLY_ENABLED=true
AGENT_WEEKLY_ENABLED=true
```

`AGENT_SCHEDULER_ENABLED=false` overrides everything and stops all scheduled
workflows. The nightly and weekly flags independently disable those Financial
Center schedules across every household.

## Rollback

```bash
git apply -R nirvana-agent-scheduler-controls.patch
```

If the migration has already run, leaving the new table in place is harmless.
