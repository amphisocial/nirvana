# Apply Nirvana Research AI v2

This is an overlay for an existing `/opt/apps/nirvana` deployment.

## 1. Back up the current application

```bash
sudo cp -a /opt/apps/nirvana /opt/apps/nirvana-backup-before-research-ai-v2
```

## 2. Copy this overlay into the application

From the extracted overlay directory:

```bash
sudo rsync -av --exclude INSTALL.md ./ /opt/apps/nirvana/
sudo chown -R ubuntu:ubuntu /opt/apps/nirvana
cd /opt/apps/nirvana
```

## 3. Update `.env`

Ensure these production settings are present:

```env
MARKET_DATA_PROVIDER=alphavantage
ALPHAVANTAGE_API_KEY=your-alpha-vantage-key
MARKET_CACHE_MINUTES=30
MARKET_RESEARCH_CACHE_MINUTES=720
MARKET_NEWS_CACHE_MINUTES=30
MARKET_NEWS_LIMIT=8

AI_PROVIDER=openai
OPENAI_API_KEY=your-openai-key
AI_WEB_SEARCH_ENABLED=true
AI_WEB_SEARCH_CONTEXT_SIZE=medium
```

Keep your existing database, Google OAuth, Stripe, session, and application settings unchanged.

## 4. Restart only Nirvana

No database migration and no npm install are required because this update adds no dependency.

```bash
node --check server/services/chat-service.js
node --check server/routes/chat.js
pm2 restart nirvana --update-env
pm2 save
pm2 logs nirvana --lines 100
```

## 5. Test

Log in and ask:

```text
What about CCJ?
```

Expected behavior:

- Stock Market Analyst activates.
- A one-year CCJ chart appears.
- The response includes a direct thesis rather than a research checklist.
- Market and news sources appear as links.
- The model does not compare all holdings only with the taxable brokerage account.
