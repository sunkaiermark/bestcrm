import test from 'node:test';
import assert from 'node:assert/strict';
import { createNotificationRepository } from '../../src/repositories/notificationRepository.mjs';

function queryTarget(rows = [], rowCount = rows.length) {
  return {
    queries: [],
    async query(sql, params) {
      this.queries.push({ sql, params });
      return { rows, rowCount };
    }
  };
}

test('notification repository lists and counts user-scoped notifications', async () => {
  const target = queryTarget([{
    id: '41', user_id: '7', event_type: 'submit_contract_approval', priority: 'critical',
    title: 'Contract approval required', body: 'Review contract', action_url: '/opportunities/10',
    source_type: 'workflow_event', source_id: '90', actor_user_id: '2', actor_display_name: 'Sales',
    read_at: null, created_at: '2026-08-13T08:00:00.000Z'
  }]);
  const repository = createNotificationRepository(target);

  const notifications = await repository.listForUser(7, { limit: 5, unreadOnly: true });

  assert.equal(notifications[0].id, 41);
  assert.equal(notifications[0].priority, 'critical');
  assert.match(target.queries[0].sql, /WHERE n\.user_id = \$1/);
  assert.deepEqual(target.queries[0].params, [7, true, 5]);
});

test('notification repository stores preferences and push subscriptions', async () => {
  const preferenceTarget = queryTarget([{
    user_id: '7', realtime_enabled: true, web_push_enabled: false,
    email_enabled: true, sms_enabled: false, email_delay_minutes: 30
  }]);
  const repository = createNotificationRepository(preferenceTarget);
  const preference = await repository.savePreference(7, {
    realtimeEnabled: true,
    webPushEnabled: false,
    emailEnabled: true,
    smsEnabled: false,
    emailDelayMinutes: 30
  });
  assert.equal(preference.emailDelayMinutes, 30);
  assert.match(preferenceTarget.queries[0].sql, /ON CONFLICT \(user_id\) DO UPDATE/);

  const pushTarget = queryTarget([{ id: '12' }]);
  await createNotificationRepository(pushTarget).upsertPushSubscription(7, {
    endpoint: 'https://push.example/subscription',
    keys: { p256dh: 'public-key', auth: 'auth-secret' }
  }, 'Test Browser');
  assert.match(pushTarget.queries[0].sql, /INSERT INTO web_push_subscriptions/);
  assert.deepEqual(pushTarget.queries[0].params, [
    7, 'https://push.example/subscription', 'public-key', 'auth-secret', 'Test Browser'
  ]);
});

test('notification repository replaces unsafe external action URLs with the notification center', async () => {
  const target = queryTarget([{
    id: '42', user_id: '7', event_type: 'test', priority: 'normal',
    title: 'Unsafe URL', body: 'Unsafe URL', action_url: 'javascript:alert(1)',
    source_type: 'test', source_id: '92', actor_user_id: null,
    actor_display_name: '', read_at: null, created_at: '2026-08-13T08:00:00.000Z'
  }]);

  const notifications = await createNotificationRepository(target).listForUser(7);

  assert.equal(notifications[0].actionUrl, '/notifications');
});

test('notification repository claims and completes channel deliveries', async () => {
  const target = queryTarget([{
    id: '80', notification_id: '41', channel: 'email', attempts: 1,
    user_id: '7', event_type: 'submit_initiation', priority: 'normal',
    title: 'Approval required', body: 'Please review', action_url: '/opportunities/10',
    read_at: null, display_name: 'Manager', email: 'manager@example.com', phone: '13800138000'
    , web_push_enabled: true, email_enabled: true, sms_enabled: true
  }]);
  const repository = createNotificationRepository(target);

  const deliveries = await repository.claimDueDeliveries(10);
  assert.equal(deliveries[0].channel, 'email');
  assert.equal(deliveries[0].userId, 7);
  assert.equal(deliveries[0].channelEnabled, true);
  assert.match(target.queries[0].sql, /FOR UPDATE SKIP LOCKED/);

  await repository.completeDelivery(80, { status: 'sent', providerMessageId: 'message-1' });
  assert.match(target.queries[1].sql, /status = \$2/);
  assert.deepEqual(target.queries[1].params, [80, 'sent', 'message-1', null]);
});
