import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { ROLES } from '../../src/domain/roles.mjs';
import { hashPassword } from '../../src/services/authService.mjs';
import { createApp } from '../../src/server.mjs';

async function createLoggedInAgent(options = {}) {
  const {
    user: userOverrides = {},
    language,
    salesWorkRepository: salesWorkRepositoryOverrides = {}
  } = options;
  const user = {
    id: 7,
    username: 'sales01',
    passwordHash: await hashPassword('ChangeMe123!'),
    displayName: 'Sales One',
    isActive: true,
    ...userOverrides,
    roles: userOverrides.roles || [ROLES.SALESPERSON]
  };
  const calls = [];
  const app = createApp({
    sessionSecret: 'test-secret',
    userRepository: {
      async findByIdWithRoles(id) {
        return Number(id) === user.id ? user : null;
      },
      async findByUsernameWithRoles(username) {
        return username === user.username ? user : null;
      }
    },
    customerRepository: {
      async listCustomers(filter) {
        calls.push(['listCustomers', filter]);
        return [{
          id: 10,
          name: 'Acme Co',
          ownerUserId: 7
        }];
      },
      async getCustomerDetail(id) {
        calls.push(['getCustomer', Number(id)]);
        return {
          id: Number(id),
          name: 'Acme Co',
          ownerUserId: 7
        };
      }
    },
    contactRepository: {
      async listContacts(filter) {
        calls.push(['listContacts', filter]);
        return [{
          id: 20,
          customerId: 10,
          customerName: 'Acme Co',
          customerOwnerUserId: 7,
          name: 'Alice'
        }];
      },
      async getContactDetail(id) {
        calls.push(['getContact', Number(id)]);
        return {
          id: Number(id),
          customerId: 10,
          customerName: 'Acme Co',
          customerOwnerUserId: 7,
          name: 'Alice'
        };
      }
    },
    opportunityRepository: {
      async listOpportunities(filter) {
        calls.push(['listOpportunities', filter]);
        return [{
          id: 30,
          opportunityNo: '800010',
          title: 'WAO System',
          customerName: 'Acme Co',
          salespersonId: 7
        }];
      },
      async getOpportunityDetail(id) {
        calls.push(['getOpportunity', Number(id)]);
        return {
          id: Number(id),
          opportunityNo: '800010',
          title: 'WAO System',
          salespersonId: 7
        };
      }
    },
    salesWorkRepository: {
      async listPlans(filter) {
        calls.push(['listPlans', filter]);
        return [{
          id: 11,
          salespersonUserId: 7,
          salespersonDisplayName: 'Sales One',
          planDate: '2026-06-27',
          customerId: 10,
          customerName: 'Acme Co',
          contactId: 20,
          contactName: 'Alice',
          opportunityId: 30,
          opportunityNo: '800010',
          opportunityTitle: 'WAO System',
          activityType: 'visit',
          subject: 'Customer visit',
          objective: 'Confirm scope',
          plannedAction: 'Visit plant',
          status: 'planned',
          resultSummary: '',
          nextStep: 'Prepare summary'
        }];
      },
      async findPlanById(id) {
        calls.push(['findPlanById', Number(id)]);
        return {
          id: Number(id),
          salespersonUserId: 7,
          planDate: '2026-06-27',
          customerId: 10,
          contactId: 20,
          opportunityId: 30,
          activityType: 'visit',
          subject: 'Customer visit',
          objective: 'Confirm scope',
          plannedAction: 'Visit plant',
          status: 'planned',
          resultSummary: '',
          nextStep: 'Prepare summary'
        };
      },
      async createPlan(input) {
        calls.push(['createPlan', input]);
        return { id: 12, ...input, status: 'planned' };
      },
      async updatePlan(id, input) {
        calls.push(['updatePlan', Number(id), input]);
        return { id: Number(id), ...input, status: 'planned' };
      },
      async updatePlanStatus(id, input) {
        calls.push(['updatePlanStatus', Number(id), input]);
        return { id: Number(id), salespersonUserId: 7, ...input };
      },
      ...salesWorkRepositoryOverrides
    }
  });
  const agent = request.agent(app);
  if (language) {
    await agent.get(`/language?lang=${language}&returnTo=/login`);
  }
  await agent.post('/login').type('form').send({ username: user.username, password: 'ChangeMe123!' });
  return { agent, calls };
}

function assertAppSidebar(html) {
  assert.match(html, /class="left-nav"/);
  assert.match(html, /href="\/workbench"/);
  assert.match(html, /href="\/sales-work\/plans"/);
  assert.match(html, /href="\/opportunities"/);
  assert.match(html, /href="\/customers"/);
  assert.match(html, /href="\/contacts"/);
}

test('anonymous users are redirected from sales work plans', async () => {
  const app = createApp({ sessionSecret: 'test-secret' });

  const response = await request(app).get('/sales-work/plans');

  assert.equal(response.status, 302);
  assert.equal(response.headers.location, '/login');
});

test('salesperson can view sales work plan list and navigation entry', async () => {
  const { agent, calls } = await createLoggedInAgent();

  const response = await agent.get('/sales-work/plans');

  assert.equal(response.status, 200);
  assertAppSidebar(response.text);
  assert.match(response.text, /Sales Work/);
  assert.match(response.text, /Work Plans/);
  assert.match(response.text, /New Plan/);
  assert.match(response.text, /Customer visit/);
  assert.match(response.text, /Acme Co/);
  assert.match(response.text, /WAO System/);
  assert.match(response.text, /Complete/);
  assert.match(response.text, /Cancel/);
  assert.deepEqual(calls.filter((call) => call[0] === 'listPlans'), [
    ['listPlans', { salespersonUserId: 7 }]
  ]);
});

test('sales work framework text uses selected Chinese language', async () => {
  const { agent } = await createLoggedInAgent({ language: 'zh' });

  const response = await agent.get('/sales-work/plans');

  assert.equal(response.status, 200);
  assert.match(response.text, /工作管理/);
  assert.match(response.text, /工作计划/);
  assert.match(response.text, /新建计划/);
  assert.match(response.text, /完成/);
  assert.match(response.text, /取消/);
});

test('other roles cannot view sales work plans', async () => {
  const { agent } = await createLoggedInAgent({
    user: {
      id: 3,
      username: 'qe01',
      displayName: 'Quotation Engineer',
      roles: [ROLES.QUOTATION_ENGINEER]
    }
  });

  const response = await agent.get('/sales-work/plans');

  assert.equal(response.status, 403);
});

test('salesperson can open new and edit plan forms', async () => {
  const { agent } = await createLoggedInAgent();

  const newForm = await agent.get('/sales-work/plans/new');
  assert.equal(newForm.status, 200);
  assert.match(newForm.text, /New Plan/);
  assert.match(newForm.text, /name="planDate"/);
  assert.match(newForm.text, /<select name="customerId">/);
  assert.match(newForm.text, /<select name="contactId">/);
  assert.match(newForm.text, /<select name="opportunityId">/);
  assert.match(newForm.text, /<select name="activityType"/);

  const editForm = await agent.get('/sales-work/plans/11/edit');
  assert.equal(editForm.status, 200);
  assert.match(editForm.text, /Edit Plan/);
  assert.match(editForm.text, /value="Customer visit"/);
  assert.match(editForm.text, /Visit plant/);
});

test('salesperson creates and updates own sales work plans', async () => {
  const { agent, calls } = await createLoggedInAgent();

  const created = await agent
    .post('/sales-work/plans')
    .type('form')
    .send({
      planDate: '2026-06-28',
      customerId: '10',
      contactId: '20',
      opportunityId: '30',
      activityType: 'meeting',
      subject: 'Scope meeting',
      objective: 'Confirm details',
      plannedAction: 'Meet customer',
      nextStep: 'Send minutes'
    });

  assert.equal(created.status, 302);
  assert.equal(created.headers.location, '/sales-work/plans');

  const updated = await agent
    .post('/sales-work/plans/11')
    .type('form')
    .send({
      planDate: '2026-06-29',
      customerId: '10',
      contactId: '20',
      opportunityId: '30',
      activityType: 'call',
      subject: 'Follow-up call',
      objective: 'Check feedback',
      plannedAction: 'Call buyer',
      nextStep: 'Prepare quote'
    });

  assert.equal(updated.status, 302);
  assert.equal(updated.headers.location, '/sales-work/plans');
  assert.deepEqual(calls.filter((call) => ['createPlan', 'updatePlan'].includes(call[0])), [
    ['createPlan', {
      salespersonUserId: 7,
      planDate: '2026-06-28',
      customerId: 10,
      contactId: 20,
      opportunityId: 30,
      activityType: 'meeting',
      subject: 'Scope meeting',
      objective: 'Confirm details',
      plannedAction: 'Meet customer',
      nextStep: 'Send minutes'
    }],
    ['updatePlan', 11, {
      salespersonUserId: 7,
      planDate: '2026-06-29',
      customerId: 10,
      contactId: 20,
      opportunityId: 30,
      activityType: 'call',
      subject: 'Follow-up call',
      objective: 'Check feedback',
      plannedAction: 'Call buyer',
      nextStep: 'Prepare quote'
    }]
  ]);
});

test('salesperson completes and cancels own sales work plans', async () => {
  const { agent, calls } = await createLoggedInAgent();

  const completed = await agent
    .post('/sales-work/plans/11/complete')
    .type('form')
    .send({ resultSummary: 'Meeting done', nextStep: 'Send quote' });

  assert.equal(completed.status, 302);
  assert.equal(completed.headers.location, '/sales-work/plans');

  const cancelled = await agent
    .post('/sales-work/plans/11/cancel')
    .type('form')
    .send({ resultSummary: 'Customer postponed', nextStep: 'Follow next week' });

  assert.equal(cancelled.status, 302);
  assert.equal(cancelled.headers.location, '/sales-work/plans');
  assert.deepEqual(calls.filter((call) => call[0] === 'updatePlanStatus'), [
    ['updatePlanStatus', 11, {
      status: 'completed',
      resultSummary: 'Meeting done',
      nextStep: 'Send quote'
    }],
    ['updatePlanStatus', 11, {
      status: 'cancelled',
      resultSummary: 'Customer postponed',
      nextStep: 'Follow next week'
    }]
  ]);
});
