import test from 'node:test';
import assert from 'node:assert/strict';
import { config } from '../server/config.js';
import {
  getFinnhubQuote,
  getFinnhubResearch,
  getFinnhubHistory,
  __resetFinnhubRateLimitForTests
} from '../server/services/market/finnhub.js';

// Helper to stub global fetch for a single test and restore it after.
function withFetch(handler, fn) {
  const real = globalThis.fetch;
  globalThis.fetch = handler;
  return Promise.resolve()
    .then(fn)
    .finally(() => { globalThis.fetch = real; });
}

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

test('getFinnhubQuote maps the live quote payload', async () => {
  config.market.finnhubApiKey = 'test-key';
  await withFetch(
    async (url) => {
      assert.ok(url.toString().includes('/quote'));
      return jsonResponse({ c: 195.5, t: 1_700_000_000 });
    },
    async () => {
      const quote = await getFinnhubQuote('AAPL');
      assert.equal(quote.symbol, 'AAPL');
      assert.equal(quote.price, 195.5);
      assert.equal(quote.source, 'Finnhub quote');
    }
  );
});

test('getFinnhubResearch converts millions to absolute units', async () => {
  config.market.finnhubApiKey = 'test-key';
  await withFetch(
    async (url) => {
      const u = url.toString();
      if (u.includes('/stock/profile2')) {
        return jsonResponse({
          name: 'Apple Inc', ticker: 'AAPL', exchange: 'NASDAQ',
          currency: 'USD', country: 'US', finnhubIndustry: 'Technology',
          marketCapitalization: 3_400_000, shareOutstanding: 15_000
        });
      }
      if (u.includes('/stock/metric')) {
        return jsonResponse({ metric: { peTTM: 32.5, beta: 1.25, '52WeekHigh': 250, '52WeekLow': 165 } });
      }
      return jsonResponse({});
    },
    async () => {
      const r = await getFinnhubResearch('AAPL');
      assert.equal(r.companyName, 'Apple Inc');
      assert.equal(r.peRatio, 32.5);
      assert.equal(r.beta, 1.25);
      assert.equal(r.fiftyTwoWeekHigh, 250);
      assert.equal(r.fiftyTwoWeekLow, 165);
      // Finnhub returns millions; provider normalizes to absolute.
      assert.equal(r.marketCapitalization, 3_400_000 * 1_000_000);
      assert.equal(r.sharesOutstanding, 15_000 * 1_000_000);
    }
  );
});

test('getFinnhubQuote surfaces a clear error when the key is missing', async () => {
  const saved = config.market.finnhubApiKey;
  config.market.finnhubApiKey = undefined;
  await assert.rejects(() => getFinnhubQuote('AAPL'), /FINNHUB_API_KEY is not configured/);
  config.market.finnhubApiKey = saved;
});

test('getFinnhubQuote pauses after an HTTP 429', async () => {
  config.market.finnhubApiKey = 'test-key';
  await withFetch(
    async () => jsonResponse({}, 429),
    async () => {
      await assert.rejects(() => getFinnhubQuote('AAPL'), /rate limit/i);
    }
  );
});

test('getFinnhubHistory uses the count-based candle request first', async () => {
  __resetFinnhubRateLimitForTests();
  config.market.finnhubApiKey = 'test-key';
  const urls = [];
  await withFetch(
    async (url) => {
      urls.push(url.toString());
      const now = Math.floor(Date.now() / 1000);
      const t = Array.from({ length: 60 }, (_, i) => now - (60 - i) * 86400);
      const c = Array.from({ length: 60 }, (_, i) => 150 + i);
      return jsonResponse({ s: 'ok', t, c });
    },
    async () => {
      const hist = await getFinnhubHistory('NFLX', '3m');
      assert.equal(hist.points.length, 60);
      assert.match(hist.source, /candles/);
      assert.ok(urls[0].includes('count='), 'first request should be count-based');
    }
  );
});

test('getFinnhubHistory synthesizes when candles are unavailable', async () => {
  __resetFinnhubRateLimitForTests();
  config.market.finnhubApiKey = 'test-key';
  await withFetch(
    async (url) => {
      const u = url.toString();
      if (u.includes('/stock/candle')) return jsonResponse({ s: 'no_data' });
      if (u.includes('/quote')) return jsonResponse({ c: 500, t: Math.floor(Date.now() / 1000) });
      if (u.includes('/stock/metric')) return jsonResponse({ metric: { '52WeekLow': 300, '52WeekHigh': 700 } });
      return jsonResponse({});
    },
    async () => {
      const hist = await getFinnhubHistory('NFLX', '1y');
      assert.ok(hist.points.length >= 2, 'synthesized series has at least 2 points');
      assert.match(hist.source, /synthesized/i);
    }
  );
});
