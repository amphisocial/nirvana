# Nirvana Phase 1

Nirvana is a personal finance and retirement-planning command center inspired by the strongest workflow patterns in Boldin, while deliberately keeping the first release small enough to ship and operate.

## Phase 1 scope

- Google sign-in and household profile
- Manual account, liability, and holding entry
- CSV holding import as the backup to account aggregation
- Net worth, asset allocation, concentration, and holdings dashboards
- Retirement projection with deterministic and Monte Carlo views
- Stock trend charts for 3M, 6M, YTD, and 1Y
- Evidence-driven Research AI that treats any ticker mention as a research request, builds a one-year data packet, calculates trend/risk metrics, retrieves recent news, and produces a default chart
- Server-side Markdown skills and intent-based skill-agent routing
- Portfolio buy/sell what-if scenarios without trade execution
- Stripe-ready subscription hooks
- Plaid-ready schema and feature flags, disabled by default
- PM2 service named `nirvana`

## Product boundary

Nirvana Phase 1 is an educational planning and research product. It does not execute trades and should not call its outputs individualized investment advice. The AI explains model output; deterministic financial functions and market-data services perform the calculations.

## Quick start

```bash
cp .env.example .env
# If your file browser hides dotfiles, copy env.example.txt instead
npm install
npm run db:migrate
npm run db:seed
npm run dev
```

Open `http://localhost:5015`. With `DEMO_MODE=true`, the seeded demo household is used automatically.

## Production

Nirvana is designed to run as another PM2 service behind the existing shared Nginx instance used by the other AthenaBot applications.

```bash
rm -rf node_modules
npm cache verify
npm ci --omit=dev --registry=https://registry.npmjs.org --no-audit --no-fund
npm run db:migrate
pm2 start ecosystem.config.cjs --env production
pm2 save
```

The deployment guide includes recovery from a stale `npm ci`, the dedicated PostgreSQL role/database grants, the Nginx site block for port `5015`, and the Certbot certificate command. The repository-level `.npmrc` and lockfile use the public npm registry. Do not install a second Nginx service.

## Plaid decision

Plaid is not required to launch. Phase 1 uses manual entry and CSV import. Phase 2 can enable Plaid Link, Transactions, Investments, and Liabilities behind `PLAID_ENABLED=true`. The database already contains a `plaid_items` table so migration does not require redesigning the household/account model.

## Market data

`MARKET_DATA_PROVIDER=mock` makes local development deterministic and must not be used for real research. Set `MARKET_DATA_PROVIDER=alphavantage` and add `ALPHAVANTAGE_API_KEY` for live quotes, company overview/fundamentals, one-year history, calculated returns/volatility/drawdown, and recent news. Any ticker mention now launches this evidence packet and shows a default one-year chart; explicit 3M, 6M, or YTD requests crop the chart accordingly.

When `AI_PROVIDER=openai` and `AI_WEB_SEARCH_ENABLED=true`, the Responses API web-search tool supplements the structured market packet with current filings, investor-relations material, and reputable reporting. Alpha Vantage news remains available to all configured AI providers.

## AI skills

Skills are plain Markdown files in `server/skills`. Enable or disable them with `AI_ENABLED_SKILLS`. The server routes each prompt to the relevant enabled skill-agents (personal finance, retirement, stock research, and portfolio scenarios) and loads only those Markdown instructions. This keeps behavior editable without changing application code while avoiding an expensive autonomous multi-agent swarm in Phase 1.

## Important next hardening steps

Before public launch: obtain legal review of investment-advice positioning, add a privacy policy and data retention controls, encrypt any future Plaid access tokens with a managed key, add audit logging, add provider-specific market-data attribution, and complete penetration/security testing.


## Documentation

- `docs/PHASE1_PRODUCT_DECISION.md` — what ships now and what is intentionally deferred
- `docs/PLAID_PHASE2.md` — production Plaid architecture and security requirements
- `docs/DEPLOYMENT_EXISTING_NGINX.md` — exact deployment for the existing AthenaBot Nginx/PM2/PostgreSQL/Certbot server
- `docs/BUILD_VALIDATION.md` — tests and smoke checks completed
