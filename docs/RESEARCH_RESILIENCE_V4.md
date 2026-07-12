# Nirvana Research Resilience v4

Fixes ticker mis-detection, Alpha Vantage free-tier throttling, unsupported weekly-adjusted calls, stale-cache fallback, market-data failure handling, and empty OpenAI Responses output.

## Install

```bash
cd /tmp
unzip nirvana-resilience-v4-overlay.zip

sudo cp -a /opt/apps/nirvana /opt/apps/nirvana-backup-before-resilience-v4

sudo rsync -av --exclude INSTALL.md nirvana-resilience-v4-overlay/ /opt/apps/nirvana/
sudo chown -R ubuntu:ubuntu /opt/apps/nirvana

cd /opt/apps/nirvana
node --check server/services/chat-routing.js
node --check server/services/market/cache.js
node --check server/services/market/alphavantage.js
node --check server/services/market/index.js
node --check server/services/ai/openai.js
node --check server/services/chat-service.js

pm2 restart nirvana --update-env
pm2 save
pm2 logs nirvana --lines 100
```

No database migration and no npm install are required.

Recommended `.env`:

```env
MARKET_CACHE_MINUTES=1440
MARKET_RESEARCH_CACHE_MINUTES=10080
MARKET_NEWS_CACHE_MINUTES=360
MARKET_NEWS_LIMIT=6
AI_WEB_SEARCH_ENABLED=true
```
