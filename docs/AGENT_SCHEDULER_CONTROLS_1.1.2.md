# Nirvana 1.1.2 — Scheduled Agent Controls

This update adds independent controls for Nirvana's automatic Financial Center agents.

## Controls

Household owners can open **Insights** and independently enable or pause:

- **Nightly Financial Center** — daily state snapshot, From Nirvana's Desk, expense alerts, and goal alerts.
- **Weekly Financial Center** — holding research, market-value refresh, ten-year forecast, portfolio drift, weekly movement analysis, and the personalized briefing.

Shared household members can see the effective status but cannot change it. Manual **Run weekly agents now** remains available even when schedules are paused.

Trading Desk overnight automation remains controlled separately under **Holdings → Trading Desk → Settings**.

## Global safety switches

```dotenv
# Emergency kill switch for every in-process scheduled workflow,
# including Financial Center and Trading Desk:
AGENT_SCHEDULER_ENABLED=false

# Independent global controls for Financial Center schedules:
AGENT_NIGHTLY_ENABLED=false
AGENT_WEEKLY_ENABLED=false
```

Household settings cannot override a global `false` value.

## Deployment

```bash
npm install
npm run db:migrate
npm test
pm2 restart nirvana --update-env
```

Run the migration before restarting because the scheduler reads the new
`household_agent_settings` table on startup.

## Credit protection

The scheduler checks the global and household switches before calling
`claimAgentRun`. A disabled schedule therefore creates no run claim and makes no
AI or market-data request.
