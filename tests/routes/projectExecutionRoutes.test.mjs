import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createApp } from '../../src/server.mjs';
import { ROLES } from '../../src/domain/roles.mjs';
import { STATUSES } from '../../src/domain/statuses.mjs';
import { hashPassword } from '../../src/services/authService.mjs';

async function setup(options = {}) {
  const user = {
    id: 7,
    username: 'manager01',
    passwordHash: await hashPassword('ChangeMe123!'),
    displayName: 'Manager One',
    isActive: true,
    roles: options.roles || [ROLES.SALES_MANAGER]
  };
  const opportunity = {
    id: 30,
    opportunityNo: '800030',
    title: 'Factory upgrade',
    customerName: 'Acme Co',
    status: options.status || STATUSES.CONTRACT_ARCHIVED,
    salespersonId: 2,
    salesManagerId: 7
  };
  let projectExecution = options.existing || null;
  let creates = 0;
  const app = createApp({
    sessionSecret: 'test-secret',
    userRepository: {
      async findByIdWithRoles(id) { return Number(id) === user.id ? user : null; },
      async findByUsernameWithRoles(username) { return username === user.username ? user : null; }
    },
    opportunityRepository: {
      async getOpportunityDetail(id) { return Number(id) === opportunity.id ? opportunity : null; }
    },
    approvalSettingRepository: {
      async findActiveByKey() {
        return options.setting === undefined
          ? { userId: 7, roleCode: ROLES.SALES_MANAGER, isActive: true }
          : options.setting;
      }
    },
    projectExecutionRepository: {
      async findByOpportunity() { return projectExecution; },
      async findById(id) { return Number(id) === Number(projectExecution?.id) ? projectExecution : null; },
      async createForOpportunity(input) {
        creates += 1;
        projectExecution = {
          id: 5,
          opportunityId: 30,
          opportunityNo: '800030',
          opportunityTitle: 'Factory upgrade',
          customerName: 'Acme Co',
          status: 'planning',
          contractSignedOn: input.contractSignedOn,
          confirmedByUserId: 7,
          confirmedByDisplayName: 'Manager One',
          salesManagerId: 7
        };
        return { projectExecution, created: true };
      }
    }
  });
  const agent = request.agent(app);
  await agent.post('/login').type('form').send({ username: user.username, password: 'ChangeMe123!' });
  return { agent, getCreates: () => creates };
}

test('configured authorized user sees confirmation and creates the one Project Execution record', async () => {
  const { agent, getCreates } = await setup();

  const form = await agent.get('/opportunities/30/project-execution/confirm');
  assert.equal(form.status, 200);
  assert.match(form.text, /Confirm Project Execution creation/);
  assert.match(form.text, /Contract signing date/);

  const created = await agent
    .post('/opportunities/30/project-execution/confirm')
    .type('form')
    .send({ contractSignedOn: '2026-09-14' });
  assert.equal(created.status, 302);
  assert.equal(created.headers.location, '/project-executions/5');
  assert.equal(getCreates(), 1);
});

test('mismatched user receives 403 on direct confirmation URL', async () => {
  const { agent } = await setup({
    setting: { userId: 8, roleCode: ROLES.SALES_MANAGER, isActive: true }
  });

  const response = await agent.get('/opportunities/30/project-execution/confirm');

  assert.equal(response.status, 403);
});

test('existing Project Execution redirects instead of creating a duplicate', async () => {
  const { agent, getCreates } = await setup({
    existing: {
      id: 5,
      opportunityId: 30,
      opportunityNo: '800030',
      opportunityTitle: 'Factory upgrade',
      customerName: 'Acme Co',
      status: 'planning',
      contractSignedOn: '2026-09-14',
      confirmedByUserId: 7,
      confirmedByDisplayName: 'Manager One',
      salesManagerId: 7
    }
  });

  const response = await agent.get('/opportunities/30/project-execution/confirm');

  assert.equal(response.status, 302);
  assert.equal(response.headers.location, '/project-executions/5');
  assert.equal(getCreates(), 0);
});
