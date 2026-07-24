import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveAgentSchedule, shouldRunScheduledAgent } from '../server/services/agent-settings.js';

test('household switches independently disable nightly and weekly agents', () => {
  const settings = resolveAgentSchedule(
    { nightly_enabled: false, weekly_enabled: true },
    {
      global: { schedulerEnabled: true, nightlyEnabled: true, weeklyEnabled: true },
      canEdit: true,
      timezone: 'America/New_York',
      nightlyHour: 2,
      weeklyDay: 0,
      weeklyHour: 3
    }
  );
  assert.equal(settings.effective.nightlyEnabled, false);
  assert.equal(settings.effective.weeklyEnabled, true);
  assert.equal(settings.canEdit, true);
});

test('server-wide scheduler is an emergency kill switch', () => {
  const settings = resolveAgentSchedule(
    { nightly_enabled: true, weekly_enabled: true },
    {
      global: { schedulerEnabled: false, nightlyEnabled: true, weeklyEnabled: true }
    }
  );
  assert.deepEqual(settings.effective, {
    nightlyEnabled: false,
    weeklyEnabled: false
  });
});

test('scheduler does not run or claim a disabled agent', () => {
  assert.equal(shouldRunScheduledAgent({ globalEnabled: true, householdEnabled: false, due: true }), false);
  assert.equal(shouldRunScheduledAgent({ globalEnabled: false, householdEnabled: true, due: true }), false);
  assert.equal(shouldRunScheduledAgent({ globalEnabled: true, householdEnabled: true, due: false }), false);
  assert.equal(shouldRunScheduledAgent({ globalEnabled: true, householdEnabled: true, due: true }), true);
});
