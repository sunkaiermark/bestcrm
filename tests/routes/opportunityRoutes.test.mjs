import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { ROLES } from '../../src/domain/roles.mjs';
import { STATUSES } from '../../src/domain/statuses.mjs';
import { createApp } from '../../src/server.mjs';
import { hashPassword } from '../../src/services/authService.mjs';

async function createLoggedInAgent(extraOptions = {}) {
  const user = {
    id: 7,
    username: 'sales01',
    passwordHash: await hashPassword('ChangeMe123!'),
    displayName: 'Sales One',
    isActive: true,
    roles: [ROLES.SALESPERSON]
  };
  const created = [];
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
      async listCustomers() {
        return [{ id: 10, name: 'Acme Co', ownerUserId: 7 }];
      },
      async getCustomerDetail() {
        return { id: 10, name: 'Acme Co', ownerUserId: 7 };
      }
    },
    contactRepository: {
      async listContacts() {
        return [{ id: 20, customerId: 10, customerName: 'Acme Co', customerOwnerUserId: 7, name: 'Alice' }];
      },
      async getContactDetail() {
        return { id: 20, customerId: 10, customerName: 'Acme Co', customerOwnerUserId: 7, name: 'Alice' };
      }
    },
    opportunityRepository: {
      async listOpportunities() {
        return [{
          id: 30,
          opportunityNo: 'OPP-20260605-abcdef12',
          title: 'Factory upgrade',
          customerId: 10,
          customerName: 'Acme Co',
          primaryContactId: 20,
          primaryContactName: 'Alice',
          requirement: 'Upgrade production line',
          estimatedAmount: 120000.50,
          projectType: 'automation',
          deliveryCycle: '45 days',
          expectedBidDate: '2026-07-10',
          status: STATUSES.DRAFT,
          salespersonId: 7
        }];
      },
      async getOpportunityDetail() {
        return {
          id: 30,
          opportunityNo: 'OPP-20260605-abcdef12',
          title: 'Factory upgrade',
          customerId: 10,
          customerName: 'Acme Co',
          primaryContactId: 20,
          primaryContactName: 'Alice',
          requirement: 'Upgrade production line',
          estimatedAmount: 120000.50,
          projectType: 'automation',
          deliveryCycle: '45 days',
          expectedBidDate: '2026-07-10',
          status: STATUSES.DRAFT,
          salespersonId: 7
        };
      },
      async createOpportunity(input) {
        created.push(input);
        return {
          id: 31,
          ...input,
          customerName: 'Acme Co',
          primaryContactName: 'Alice'
        };
      },
      ...extraOptions.opportunityRepository
    },
    ...extraOptions
  });
  const agent = request.agent(app);
  await agent.post('/login').type('form').send({ username: 'sales01', password: 'ChangeMe123!' });
  return { agent, created };
}

test('anonymous users are redirected from opportunity pages', async () => {
  const app = createApp({ sessionSecret: 'test-secret' });

  const response = await request(app).get('/opportunities');

  assert.equal(response.status, 302);
  assert.equal(response.headers.location, '/login');
});

test('logged in salesperson can view opportunity list new form and detail', async () => {
  const { agent } = await createLoggedInAgent();

  const list = await agent.get('/opportunities');
  assert.equal(list.status, 200);
  assert.match(list.text, /Opportunities/);
  assert.match(list.text, /Factory upgrade/);
  assert.match(list.text, /Acme Co/);

  const form = await agent.get('/opportunities/new');
  assert.equal(form.status, 200);
  assert.match(form.text, /name="customerId"/);
  assert.match(form.text, /Acme Co/);
  assert.match(form.text, /Alice/);

  const detail = await agent.get('/opportunities/30');
  assert.equal(detail.status, 200);
  assert.match(detail.text, /Factory upgrade/);
  assert.match(detail.text, /Upgrade production line/);
  assert.match(detail.text, /Alice/);
});

test('page form creates opportunity draft referencing customer and contact', async () => {
  const { agent, created } = await createLoggedInAgent();

  const response = await agent
    .post('/opportunities')
    .type('form')
    .send({
      title: 'Factory upgrade',
      customerId: '10',
      primaryContactId: '20',
      requirement: 'Upgrade production line',
      estimatedAmount: '120000.50',
      projectType: 'automation',
      deliveryCycle: '45 days',
      expectedBidDate: '2026-07-10'
    });

  assert.equal(response.status, 302);
  assert.equal(response.headers.location, '/opportunities/31');
  assert.equal(created[0].customerId, 10);
  assert.equal(created[0].primaryContactId, 20);
  assert.equal(created[0].status, STATUSES.DRAFT);
});

test('JSON API creates opportunity draft', async () => {
  const { agent, created } = await createLoggedInAgent();

  const response = await agent
    .post('/api/opportunities')
    .send({
      title: 'Factory upgrade',
      customerId: 10,
      primaryContactId: 20,
      requirement: 'Upgrade production line',
      estimatedAmount: 120000.50,
      projectType: 'automation',
      deliveryCycle: '45 days',
      expectedBidDate: '2026-07-10'
    });

  assert.equal(response.status, 201);
  assert.equal(response.body.id, 31);
  assert.equal(response.body.customerId, 10);
  assert.equal(response.body.primaryContactId, 20);
  assert.equal(created[0].salespersonId, 7);
});
