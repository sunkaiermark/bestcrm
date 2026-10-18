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
    roles: options.roles || [ROLES.SALESPERSON]
  };
  const opportunity = {
    id: 30,
    opportunityNo: '800030',
    title: 'Factory upgrade',
    customerName: 'Acme Co',
    status: options.status || STATUSES.CONTRACT_ARCHIVED,
    salespersonId: 7,
    salesManagerId: 7
  };
  const workflowUsers = [
    user,
    { id: 12, displayName: 'Project Engineer', isActive: true, roles: [ROLES.QUOTATION_ENGINEER] },
    { id: 13, displayName: 'Process Engineer', isActive: true, roles: [] },
    { id: 14, displayName: 'Technical Manager', isActive: true, roles: [ROLES.TECHNICAL_MANAGER] },
    { id: 15, displayName: 'Approver', isActive: true, roles: [] },
    { id: 16, displayName: 'Publisher', isActive: true, roles: [] }
  ];
  let projectExecution = options.existing || null;
  let creates = 0;
  const app = createApp({
    sessionSecret: 'test-secret',
    userRepository: {
      async findByIdWithRoles(id) { return workflowUsers.find((candidate) => candidate.id === Number(id)) || null; },
      async findByUsernameWithRoles(username) { return username === user.username ? user : null; },
      async listUsersWithRoles() { return workflowUsers; }
    },
    attachmentRepository:{async listByOpportunity(){return [{id:90,category:'signed_contract',originalName:'signed.pdf',sha256:'a'.repeat(64),fileSize:100}];}},
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
      async listAll() { return projectExecution ? [projectExecution] : []; },
      async listMilestones() { return []; },
      async listWorkPackages() { return []; },
      async createContractKickoffTemplate() {},
      async appendAuditEvent() {},
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

test('assigned Sales starts the one execution record with no second approval', async () => {
  const { agent, getCreates } = await setup();

  const form = await agent.get('/opportunities/30/project-execution/confirm');
  assert.equal(form.status, 200);
  assert.match(form.text, /Start Project Execution/);
  assert.match(form.text, /Contract signing date/);

  const created = await agent
    .post('/opportunities/30/project-execution/confirm')
    .type('form')
    .send({
      contractSignedOn: '2026-09-14', signedContractAttachmentId:90, projectOwnerUserId: 7, projectEngineerUserId: 12,
      processEngineerUserId: 13, technicalManagerUserId: 14, approverUserId: 15, publisherUserId: 16
    });
  assert.equal(created.status, 302);
  assert.equal(created.headers.location, '/project-executions/5');
  assert.equal(getCreates(), 1);
});

test('project execution has a standalone visible list for authorized project users', async () => {
  const { agent } = await setup({
    existing: {
      id: 5, opportunityId: 30, opportunityNo: '800030', opportunityTitle: 'Factory upgrade',
      customerName: 'Acme Co', status: 'planning', contractSignedOn: '2026-09-14',
      confirmedByUserId: 7, confirmedByDisplayName: 'Manager One', salesManagerId: 7,
      projectOwnerUserId: 7, projectOwnerDisplayName: 'Manager One'
    }
  });
  const response = await agent.get('/project-executions');
  assert.equal(response.status, 200);
  assert.match(response.text, /Project Execution/);
  assert.match(response.text, /Factory upgrade/);
});

test('project execution detail renders the delivery-plan workspace for an authorized user', async () => {
  const { agent } = await setup({
    existing: {
      id: 5, opportunityId: 30, opportunityNo: '800030', opportunityTitle: 'Factory upgrade',
      customerName: 'Acme Co', status: 'planning', contractSignedOn: '2026-09-14',
      confirmedByUserId: 7, confirmedByDisplayName: 'Manager One', salesManagerId: 7,
      projectOwnerUserId: 7, projectOwnerDisplayName: 'Manager One', riskSummary: ''
    }
  });
  const response = await agent.get('/project-executions/5');
  assert.equal(response.status, 200);
  assert.match(response.text, /Delivery milestones/);
  assert.match(response.text, /Work packages/);
  assert.match(response.text, /Technical solution to release workflow/);
  assert.match(response.text, /Audit trail/);
  assert.match(response.text, /Contract kickoff · Drawing release flow/);
  assert.match(response.text, /Project Gantt/);
});

test('mismatched user receives 403 on direct confirmation URL', async () => {
  const { agent } = await setup({
    roles: [ROLES.SALES_MANAGER],
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
