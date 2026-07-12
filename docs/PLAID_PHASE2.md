# Plaid Phase 2 integration plan

## Decision

Do not make Plaid a launch dependency. Keep `PLAID_ENABLED=false` until manual/CSV onboarding, dashboard usefulness, and paid conversion are validated.

## Why it belongs in Phase 2

Plaid connectivity is more than adding a button. Production requires Plaid Link, token exchange, encrypted token storage, OAuth redirect handling, institution reconnection/update mode, duplicate Item protection, webhook processing, reconciliation, deletion workflows, and support for institution-specific gaps.

## Recommended product order

1. **Link + Investments** — brokerage and retirement accounts, securities, holdings, and investment transactions.
2. **Liabilities** — mortgages, credit cards, and loans.
3. **Transactions** — only when Nirvana has a real spending/cash-flow workflow; otherwise it creates data volume without a strong user outcome.

## Proposed endpoints

- `POST /api/plaid/link-token`
- `POST /api/plaid/exchange-token`
- `POST /api/plaid/webhook`
- `POST /api/plaid/items/:id/refresh`
- `DELETE /api/plaid/items/:id`
- `GET /api/plaid/institutions`

## Data flow

1. Server creates a short-lived Link token for the authenticated household.
2. Browser opens Plaid Link.
3. Browser returns a temporary public token to the server.
4. Server exchanges it for `access_token` and `item_id`.
5. Server encrypts the access token with a managed encryption key before storing it.
6. Initial background sync maps Plaid accounts to Nirvana `accounts`, `liabilities`, and `holdings`.
7. Webhooks queue incremental refresh and update `last_verified_at`.
8. Dashboard labels connected records with provider and data-as-of timestamps.

## Security requirements

- Never return Plaid access tokens to the browser.
- Encrypt tokens with KMS/Secrets Manager or envelope encryption; do not merely base64 encode them.
- Verify webhook signatures and make handlers idempotent.
- Store least-privilege products and remove Items when a user disconnects.
- Add audit logs for link, refresh, error, update-mode, and disconnect events.
- Add explicit consent, privacy, retention, and account-deletion flows.

## Reconciliation rules

- Use provider + external account ID as the stable identity.
- Preserve manual overrides separately instead of overwriting them silently.
- Mark stale/error accounts; never imply all balances are current.
- Detect duplicate linked Items before creating another subscription.
- Keep market price timestamps distinct from institution balance timestamps.

## Configuration reserved in Phase 1

```env
ACCOUNT_AGGREGATION_MODE=manual
PLAID_ENABLED=false
PLAID_ENV=sandbox
PLAID_CLIENT_ID=
PLAID_SECRET=
PLAID_PRODUCTS=transactions,investments,liabilities
PLAID_COUNTRY_CODES=US
PLAID_WEBHOOK_URL=https://nirvana.athenabot.ai/api/plaid/webhook
PLAID_REDIRECT_URI=https://nirvana.athenabot.ai/plaid/oauth-return
TOKEN_ENCRYPTION_KEY=
```
