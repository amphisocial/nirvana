import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHouseholdInviteMessage } from '../server/services/email-service.js';

test('pending household invite tells recipient to use the exact Google email', () => {
  const message = buildHouseholdInviteMessage({
    to: 'Partner.Example@gmail.com',
    inviterName: 'Anu',
    householdName: 'Mishra Household',
    role: 'member',
    accepted: false
  });
  assert.match(message.subject, /invited you/i);
  assert.match(message.text, /partner\.example@gmail\.com/i);
  assert.match(message.text, /exact Google account/i);
  assert.match(message.html, /Open Nirvana/);
});

test('existing member receives an access notification rather than a pending-invite message', () => {
  const message = buildHouseholdInviteMessage({
    to: 'partner@example.com',
    inviterName: 'Anu',
    householdName: 'Mishra Household',
    role: 'viewer',
    accepted: true
  });
  assert.match(message.subject, /now have access/i);
  assert.match(message.text, /view-only access/i);
  assert.doesNotMatch(message.text, /pending invitation/i);
});

test('invite email escapes user-controlled HTML content', () => {
  const message = buildHouseholdInviteMessage({
    to: 'partner@example.com',
    inviterName: '<script>alert(1)</script>',
    householdName: '<b>Household</b>',
    accepted: false
  });
  assert.doesNotMatch(message.html, /<script>/);
  assert.doesNotMatch(message.html, /<b>Household<\/b>/);
  assert.match(message.html, /&lt;script&gt;/);
});
