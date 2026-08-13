import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../../src/server.mjs';
import { hashPassword } from '../../src/services/authService.mjs';

async function createNotificationAgent() {
  const user = {
    id: 7,
    username: 'sales01',
    passwordHash: await hashPassword('ChangeMe123!'),
    displayName: 'Sales One',
    email: 'sales@example.com',
    phone: '13800138000',
    isActive: true,
    roles: ['salesperson']
  };
  const calls = [];
  const notificationRepository = {
    async listForUser() {
      return [{
        id: 41, userId: 7, eventType: 'submit_initiation', priority: 'normal',
        title: '商机立项待审批', body: '商机立项待审批：800010 - Reactor',
        actionUrl: '/opportunities/10', sourceType: 'workflow_event', sourceId: 90,
        actorUserId: 2, actorDisplayName: 'Manager', readAt: null,
        createdAt: '2026-08-13T08:00:00.000Z'
      }];
    },
    async listAfterId() { return []; },
    async countUnread() { return 1; },
    async getPreference() {
      return { realtimeEnabled: true, webPushEnabled: true, emailEnabled: true, smsEnabled: true, emailDelayMinutes: 15 };
    },
    async markRead(userId, id) {
      calls.push(['markRead', userId, id]);
      return { id: Number(id), actionUrl: '/opportunities/10' };
    },
    async markAllRead(userId) { calls.push(['markAllRead', userId]); return 1; },
    async savePreference(userId, preference) { calls.push(['savePreference', userId, preference]); return preference; },
    async upsertPushSubscription(userId, subscription) { calls.push(['push', userId, subscription]); return { id: 12 }; },
    async revokePushSubscription() { return 1; }
  };
  const app = createApp({
    sessionSecret: 'test-secret',
    webPushPublicKey: 'unused',
    notificationDelivery: {
      webPush: { publicKey: 'vapid-public-key', privateKey: 'vapid-private-key' },
      smtp: {},
      sms: {}
    },
    userRepository: {
      async findByIdWithRoles(id) { return Number(id) === user.id ? user : null; },
      async findByUsernameWithRoles(username) { return username === user.username ? user : null; }
    },
    notificationRepository
  });
  const agent = request.agent(app);
  await agent.post('/login').type('form').send({ username: user.username, password: 'ChangeMe123!' });
  return { agent, calls };
}

test('notification center requires login and renders preferences and unread items', async () => {
  const app = createApp({ sessionSecret: 'test-secret', databaseUrl: '' });
  assert.equal((await request(app).get('/notifications')).status, 302);

  const { agent } = await createNotificationAgent();
  const response = await agent.get('/notifications');
  assert.equal(response.status, 200);
  assert.match(response.text, /Notifications/);
  assert.match(response.text, /商机立项待审批/);
  assert.match(response.text, /Enable browser Push/);
  assert.match(response.text, /data-notification-badge/);
});

test('notification center marks items read and stores channel preferences', async () => {
  const { agent, calls } = await createNotificationAgent();
  const readResponse = await agent.post('/notifications/41/read').type('form').send({});
  assert.equal(readResponse.status, 302);
  assert.equal(readResponse.headers.location, '/opportunities/10');

  const preferenceResponse = await agent.post('/notifications/preferences').type('form').send({
    realtimeEnabled: 'on',
    emailEnabled: 'on',
    emailDelayMinutes: '30'
  });
  assert.equal(preferenceResponse.status, 302);
  assert.deepEqual(calls[1], ['savePreference', 7, {
    realtimeEnabled: true,
    webPushEnabled: false,
    emailEnabled: true,
    smsEnabled: false,
    emailDelayMinutes: 30
  }]);
});

test('notification API returns unread summary and validates Push subscriptions', async () => {
  const { agent, calls } = await createNotificationAgent();
  const summary = await agent.get('/api/notifications/summary');
  assert.equal(summary.status, 200);
  assert.equal(summary.body.unreadCount, 1);

  const invalid = await agent.post('/api/notifications/push-subscriptions').send({ endpoint: 'invalid' });
  assert.equal(invalid.status, 400);

  const valid = await agent.post('/api/notifications/push-subscriptions').send({
    endpoint: 'https://push.example/subscription',
    keys: { p256dh: 'public-key', auth: 'auth-secret' }
  });
  assert.equal(valid.status, 201);
  assert.equal(calls.at(-1)[0], 'push');
});
