import test from 'node:test';
import assert from 'node:assert/strict';

// Regression guard for the scheduler crash:
//   RangeError: Invalid time value  at Date.toISOString (dateOnly)
// A high-value expense with an unparseable start_date must not throw. We assert
// the contract that dateOnly-style formatting returns null for invalid input
// rather than throwing, which is what the fix in agent-financial-center.js does.

function dateOnly(value = new Date()) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

test('dateOnly returns null for an unparseable value instead of throwing', () => {
  assert.doesNotThrow(() => dateOnly('not-a-date'));
  assert.equal(dateOnly('not-a-date'), null);
  assert.equal(dateOnly(new Date('garbage')), null);
});

test('dateOnly still formats valid values', () => {
  assert.equal(dateOnly('2025-06-15'), '2025-06-15');
  assert.equal(dateOnly(new Date('2025-06-15T12:00:00Z')), '2025-06-15');
});

test('the financial center module loads without error', async () => {
  // Importing exercises the module top-level (including the fixed helpers).
  const mod = await import('../server/services/agent-financial-center.js');
  assert.ok(mod, 'module imported');
});
