import test from 'node:test';
import assert from 'node:assert/strict';
import { detectRange, detectTicker, selectSkillNames } from '../server/services/chat-service.js';

test('resolves company names and user-requested ranges', () => {
  assert.equal(detectTicker('Tell me the trend of Tesla over 6 months'), 'TSLA');
  assert.equal(detectRange('Tell me the trend of Tesla over 6 months'), '6m');
  assert.equal(detectTicker('Research $NVDA'), 'NVDA');
  assert.equal(detectRange('Show AAPL year to date'), 'ytd');
});

test('routes research and scenario prompts to the right markdown skills', () => {
  const agents = selectSkillNames('Should I buy Tesla? Show a target-price what-if and concentration risk.');
  assert.ok(agents.includes('personal-finance-coach'));
  assert.ok(agents.includes('stock-market-analyst'));
  assert.ok(agents.includes('portfolio-scenario-analyst'));
  assert.ok(!agents.includes('retirement-planner'));
});
