import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../../src/server.mjs';
import { ROLES } from '../../src/domain/roles.mjs';
import { hashPassword } from '../../src/services/authService.mjs';

async function createAnalyticsAgent({ roles = [ROLES.SALESPERSON], productCategoryRepository = null } = {}) {
  const user = {
    id: 7,
    username: 'sales01',
    passwordHash: await hashPassword('ChangeMe123!'),
    displayName: 'Sales One',
    isActive: true,
    roles
  };
  const app = createApp({
    sessionSecret: 'test-secret',
    productCategoryRepository,
    userRepository: {
      async findByIdWithRoles(id) {
        return Number(id) === user.id ? user : null;
      },
      async findByUsernameWithRoles(username) {
        return username === user.username ? user : null;
      }
    }
  });
  const agent = request.agent(app);
  await agent.post('/login').type('form').send({
    username: user.username,
    password: 'ChangeMe123!'
  });
  return agent;
}

test('anonymous users are redirected from analytics', async () => {
  const app = createApp({ databaseUrl: '', sessionSecret: 'test-secret' });

  const response = await request(app).get('/analytics');

  assert.equal(response.status, 302);
  assert.equal(response.headers.location, '/login');
});

test('logged in users can open Analytics from the left sidebar', async () => {
  const agent = await createAnalyticsAgent();

  const response = await agent.get('/analytics');

  assert.equal(response.status, 200);
  assert.match(response.text, /<h1>Analytics<\/h1>/);
  assert.match(response.text, /class="nav-link active" href="\/analytics">Analytics<\/a>/);
  assert.match(response.text, /No analytics reports have been configured yet\./);
});

test('product report requires administrator access and validates filters', async () => {
  const repository = {
    async categorySummary() { return []; },
    async customersForCategory() { return []; },
    async pendingEmailReview() { return { total: 0, rows: [] }; },
    async pendingBusinessReview() { return { total: 0, rows: [] }; }
  };
  const salesperson = await createAnalyticsAgent({ productCategoryRepository: repository });
  assert.equal((await salesperson.get('/analytics/products')).status, 403);

  const administrator = await createAnalyticsAgent({
    roles: [ROLES.ADMINISTRATOR], productCategoryRepository: repository
  });
  assert.equal((await administrator.get('/analytics/products?year=2026&category=unknown')).status, 400);
  assert.equal((await administrator.get('/analytics/products?reviewPage=0')).status, 400);
});

test('product report shows confirmed counts and a separate historical email review queue', async () => {
  const calls = [];
  const repository = {
    async categorySummary(filter) {
      calls.push(['summary', filter]);
      return [{
        code: 'pumps', customerCount: 1, opportunityCount: 2,
        inquiryCount: 1, emailThreadCount: 3, unlinkedCount: 1
      }];
    },
    async customersForCategory(code, filter) {
      calls.push(['customers', code, filter]);
      return [{
        customerId: 12, customerCode: 'C000012', customerName: 'Acme',
        opportunityCount: 2, inquiryCount: 1, emailThreadCount: 3,
        lastActivityAt: '2026-09-24T00:00:00.000Z'
      }];
    },
    async pendingEmailReview(filter) {
      calls.push(['pending', filter]);
      return {
        total: 31,
        rows: [{
          id: 40, subject: 'Pump and reactor RFQ',
          bodyText: 'Need pump and reactor', lastMessageAt: '2026-09-24T00:00:00.000Z'
        }]
      };
    },
    async pendingBusinessReview(filter) {
      calls.push(['business', filter]);
      return {
        total: 1,
        rows: [{
          recordType: 'inquiry', id: 11, submissionType: 'sales_lead',
          subject: 'Process line RFQ', productInterest: '',
          requirementText: 'Need a process line',
          occurredAt: '2026-09-24T00:00:00.000Z'
        }]
      };
    }
  };
  const administrator = await createAnalyticsAgent({
    roles: [ROLES.ADMINISTRATOR], productCategoryRepository: repository
  });
  const response = await administrator.get('/analytics/products?year=2026&category=pumps&reviewPage=2');
  assert.equal(response.status, 200);
  assert.match(response.text, /C000012 · Acme/);
  assert.match(response.text, /Pump and reactor RFQ/);
  assert.match(response.text, /Review conversation/);
  assert.match(response.text, /Reactors/);
  assert.match(response.text, /Pumps/);
  assert.match(response.text, /Process Line/);
  assert.match(response.text, /href="\/lead-submissions\/11"/);
  assert.deepEqual(calls, [
    ['summary', { year: 2026 }],
    ['customers', 'pumps', { year: 2026 }],
    ['pending', { limit: 30, offset: 30 }],
    ['business', { limit: 30, offset: 0 }]
  ]);
});
