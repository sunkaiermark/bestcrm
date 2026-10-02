import test from 'node:test';
import assert from 'node:assert/strict';
import { deliverNotificationBatch, normalizeSmsPhone } from '../../src/services/notificationDeliveryService.mjs';

test('normalizes mainland and E.164 SMS phone numbers', () => {
  assert.equal(normalizeSmsPhone('138 0013 8000'), '+8613800138000');
  assert.equal(normalizeSmsPhone('+65 8123 4567'), '+6581234567');
  assert.equal(normalizeSmsPhone('invalid'), '');
});

test('notification batch records sent, skipped, and failed channel outcomes', async () => {
  const completions = [];
  const notificationRepository = {
    async claimDueDeliveries() {
      return [
        { id: 1, channel: 'web_push', attempts: 1 },
        { id: 2, channel: 'email', attempts: 1 },
        { id: 3, channel: 'sms', attempts: 1 }
      ];
    },
    async completeDelivery(id, outcome) {
      completions.push({ id, ...outcome });
    }
  };
  const results = await deliverNotificationBatch({
    notificationRepository,
    config: { batchSize: 20 },
    senders: {
      async webPush() { return { status: 'sent', providerMessageId: 'push-1' }; },
      async email() { return { status: 'skipped', error: 'already read' }; },
      async sms() { throw new Error('provider unavailable'); }
    }
  });

  assert.deepEqual(results.map((entry) => entry.status), ['sent', 'skipped', 'failed']);
  assert.equal(completions[0].providerMessageId, 'push-1');
  assert.equal(completions[1].status, 'skipped');
  assert.equal(completions[2].status, 'failed');
});
