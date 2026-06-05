import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { ACTIONS } from '../../src/domain/workflow.mjs';
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
  const uploadedAttachments = [];
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
    workflowEventRepository: {
      async listByOpportunity() {
        return [{
          id: 77,
          opportunityId: 30,
          eventType: ACTIONS.SUBMIT_INITIATION,
          fromStatus: STATUSES.DRAFT,
          toStatus: STATUSES.INITIATION_PENDING,
          actorUserId: 7,
          actorDisplayName: 'Sales One',
          targetUserId: 2,
          targetDisplayName: 'Sales Manager',
          comment: 'ready for review',
          createdAt: '2026-06-05T10:00:00.000Z'
        }];
      }
    },
    todoRepository: {
      async listByOpportunity() {
        return [{
          id: 88,
          opportunityId: 30,
          assigneeUserId: 2,
          assigneeDisplayName: 'Sales Manager',
          title: 'Approve opportunity initiation',
          status: 'pending',
          dueAt: null,
          createdAt: '2026-06-05T11:00:00.000Z',
          completedAt: null
        }];
      }
    },
    attachmentRepository: {
      async listByOpportunity() {
        return [{
          id: 55,
          opportunityId: 30,
          category: 'technical_solution',
          originalName: 'technical-solution.pdf',
          storedPath: '2026/06/technical-solution.pdf',
          mimeType: 'application/pdf',
          fileSize: 1024,
          uploadedBy: 7,
          uploaderDisplayName: 'Sales One',
          uploadedAt: '2026-06-05T12:00:00.000Z'
        }];
      },
      async createAttachment(input) {
        uploadedAttachments.push(input);
        return { id: 56, uploadedAt: '2026-06-05T12:30:00.000Z', ...input };
      },
      async findById() {
        return null;
      }
    },
    ...extraOptions
  });
  const agent = request.agent(app);
  await agent.post('/login').type('form').send({ username: 'sales01', password: 'ChangeMe123!' });
  return { agent, created, uploadedAttachments };
}

function opportunityDetail(overrides = {}) {
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
    salespersonId: 7,
    salesManagerId: null,
    quotationEngineerId: null,
    technicalManagerId: null,
    commercialManagerId: null,
    finalDealAmount: null,
    lostReason: null,
    wonDescription: null,
    archivedAt: null,
    ...overrides
  };
}

async function createWorkflowAgent({ user, opportunity, roleUsers = {} }) {
  const actor = {
    passwordHash: await hashPassword('ChangeMe123!'),
    isActive: true,
    email: null,
    phone: null,
    ...user
  };
  let currentOpportunity = opportunityDetail(opportunity);
  const calls = [];
  const app = createApp({
    sessionSecret: 'test-secret',
    userRepository: {
      async findByIdWithRoles(id) {
        return Number(id) === actor.id ? actor : null;
      },
      async findByUsernameWithRoles(username) {
        return username === actor.username ? actor : null;
      },
      async listUsersByRole(role) {
        calls.push(['listUsersByRole', role]);
        return roleUsers[role] || [];
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
        return [currentOpportunity];
      },
      async getOpportunityDetail() {
        return currentOpportunity;
      },
      async createOpportunity() {
        throw new Error('not used');
      },
      async findById(id) {
        calls.push(['findOpportunity', Number(id)]);
        return currentOpportunity;
      },
      async updateWorkflowState(id, changes) {
        calls.push(['updateOpportunity', Number(id), changes]);
        currentOpportunity = { ...currentOpportunity, ...changes };
        return currentOpportunity;
      }
    },
    workflowEventRepository: {
      async listByOpportunity() {
        return [];
      },
      async create(event) {
        calls.push(['createEvent', event]);
        return { id: 99, ...event };
      }
    },
    todoRepository: {
      async listByOpportunity() {
        return [];
      },
      async create(todo) {
        calls.push(['createTodo', todo]);
        return { id: 100, ...todo };
      },
      async closePendingForOpportunity(opportunityId, status) {
        calls.push(['closeTodos', opportunityId, status]);
        return { rowCount: 1 };
      }
    }
  });
  const agent = request.agent(app);
  await agent.post('/login').type('form').send({ username: actor.username, password: 'ChangeMe123!' });
  return { agent, calls, getOpportunity: () => currentOpportunity };
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

test('opportunity detail shows pending todos and workflow timeline', async () => {
  const { agent } = await createLoggedInAgent();

  const detail = await agent.get('/opportunities/30');

  assert.equal(detail.status, 200);
  assert.match(detail.text, /Pending Todos/);
  assert.match(detail.text, /Approve opportunity initiation/);
  assert.match(detail.text, /Sales Manager/);
  assert.match(detail.text, /Timeline/);
  assert.match(detail.text, /submit_initiation/);
  assert.match(detail.text, /draft/);
  assert.match(detail.text, /initiation_pending/);
  assert.match(detail.text, /ready for review/);
});

test('opportunity detail shows attachment upload form and file links', async () => {
  const { agent } = await createLoggedInAgent();

  const detail = await agent.get('/opportunities/30');

  assert.equal(detail.status, 200);
  assert.match(detail.text, /Attachments/);
  assert.match(detail.text, /name="attachment"/);
  assert.match(detail.text, /technical-solution\.pdf/);
  assert.match(detail.text, /technical_solution/);
  assert.match(detail.text, /\/opportunities\/30\/attachments\/55\/download/);
  assert.match(detail.text, /\/opportunities\/30\/attachments\/55\/preview/);
});

test('page form uploads attachment metadata and stores file', async () => {
  const uploadDir = await mkdtemp(path.join(os.tmpdir(), 'bestcrm-upload-'));
  try {
    const { agent, uploadedAttachments } = await createLoggedInAgent({ uploadDir });

    const response = await agent
      .post('/opportunities/30/attachments')
      .field('category', 'commercial_quote')
      .attach('attachment', Buffer.from('quote file'), {
        filename: 'quote.txt',
        contentType: 'text/plain'
      });

    assert.equal(response.status, 302);
    assert.equal(response.headers.location, '/opportunities/30');
    assert.equal(uploadedAttachments.length, 1);
    assert.equal(uploadedAttachments[0].opportunityId, 30);
    assert.equal(uploadedAttachments[0].category, 'commercial_quote');
    assert.equal(uploadedAttachments[0].originalName, 'quote.txt');
    assert.equal(uploadedAttachments[0].mimeType, 'text/plain');
    assert.equal(uploadedAttachments[0].fileSize, 10);
    assert.equal(uploadedAttachments[0].uploadedBy, 7);
    assert.match(uploadedAttachments[0].storedPath, /\.txt$/);
    assert.equal(existsSync(path.resolve(uploadDir, uploadedAttachments[0].storedPath)), true);
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
});

test('attachment download and preview return stored files through opportunity permission', async () => {
  const uploadDir = await mkdtemp(path.join(os.tmpdir(), 'bestcrm-download-'));
  try {
    await writeFile(path.join(uploadDir, 'sample.txt'), 'preview me', 'utf8');
    const attachment = {
      id: 55,
      opportunityId: 30,
      category: 'technical_solution',
      originalName: 'sample.txt',
      storedPath: 'sample.txt',
      mimeType: 'text/plain',
      fileSize: 10,
      uploadedBy: 7,
      uploaderDisplayName: 'Sales One',
      uploadedAt: '2026-06-05T12:00:00.000Z'
    };
    const { agent } = await createLoggedInAgent({
      uploadDir,
      attachmentRepository: {
        async listByOpportunity() {
          return [attachment];
        },
        async createAttachment() {
          throw new Error('not used');
        },
        async findById() {
          return attachment;
        }
      }
    });

    const download = await agent.get('/opportunities/30/attachments/55/download');
    assert.equal(download.status, 200);
    assert.equal(download.text, 'preview me');
    assert.match(download.headers['content-disposition'], /attachment/);
    assert.match(download.headers['content-disposition'], /sample\.txt/);

    const preview = await agent.get('/opportunities/30/attachments/55/preview');
    assert.equal(preview.status, 200);
    assert.equal(preview.text, 'preview me');
    assert.match(preview.headers['content-type'], /text\/plain/);
    assert.match(preview.headers['content-disposition'], /inline/);
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
});

test('attachment upload and preview require opportunity view permission before file operations', async () => {
  const uploadDir = await mkdtemp(path.join(os.tmpdir(), 'bestcrm-forbidden-upload-'));
  let createCalled = false;
  let findCalled = false;
  try {
    const { agent } = await createLoggedInAgent({
      uploadDir,
      opportunityRepository: {
        async getOpportunityDetail() {
          return opportunityDetail({ salespersonId: 999 });
        }
      },
      attachmentRepository: {
        async listByOpportunity() {
          return [];
        },
        async createAttachment() {
          createCalled = true;
          throw new Error('should not create attachment');
        },
        async findById() {
          findCalled = true;
          throw new Error('should not find attachment');
        }
      }
    });

    const upload = await agent
      .post('/opportunities/30/attachments')
      .field('category', 'contract')
      .attach('attachment', Buffer.from('contract file'), {
        filename: 'contract.txt',
        contentType: 'text/plain'
      });

    assert.equal(upload.status, 403);
    assert.equal(createCalled, false);

    const preview = await agent.get('/opportunities/30/attachments/55/preview');

    assert.equal(preview.status, 403);
    assert.equal(findCalled, false);
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
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

test('salesperson submits initiation from opportunity detail page', async () => {
  const { agent, calls, getOpportunity } = await createWorkflowAgent({
    user: {
      id: 7,
      username: 'sales01',
      displayName: 'Sales One',
      roles: [ROLES.SALESPERSON]
    },
    opportunity: {
      status: STATUSES.DRAFT,
      salespersonId: 7
    },
    roleUsers: {
      [ROLES.SALES_MANAGER]: [{ id: 2, displayName: 'Sales Manager', username: 'manager01', roles: [ROLES.SALES_MANAGER] }]
    }
  });

  const detail = await agent.get('/opportunities/30');
  assert.equal(detail.status, 200);
  assert.match(detail.text, /submit_initiation/);
  assert.match(detail.text, /Sales Manager/);

  const response = await agent
    .post('/opportunities/30/workflow')
    .type('form')
    .send({ action: ACTIONS.SUBMIT_INITIATION, salesManagerId: '2', comment: 'ready for review' });

  assert.equal(response.status, 302);
  assert.equal(response.headers.location, '/opportunities/30');
  assert.equal(getOpportunity().status, STATUSES.INITIATION_PENDING);
  assert.equal(getOpportunity().salesManagerId, 2);
  assert.deepEqual(calls.filter((call) => call[0] !== 'listUsersByRole'), [
    ['findOpportunity', 30],
    ['updateOpportunity', 30, { status: STATUSES.INITIATION_PENDING, salesManagerId: 2 }],
    ['createEvent', {
      opportunityId: 30,
      eventType: ACTIONS.SUBMIT_INITIATION,
      fromStatus: STATUSES.DRAFT,
      toStatus: STATUSES.INITIATION_PENDING,
      actorUserId: 7,
      targetUserId: 2,
      comment: 'ready for review'
    }],
    ['createTodo', { opportunityId: 30, assigneeUserId: 2, title: 'Approve opportunity initiation' }]
  ]);
});

test('salesperson withdraws pending initiation from opportunity detail page', async () => {
  const { agent, calls, getOpportunity } = await createWorkflowAgent({
    user: {
      id: 7,
      username: 'sales01',
      displayName: 'Sales One',
      roles: [ROLES.SALESPERSON]
    },
    opportunity: {
      status: STATUSES.INITIATION_PENDING,
      salespersonId: 7,
      salesManagerId: 2
    }
  });

  const response = await agent
    .post('/opportunities/30/workflow')
    .type('form')
    .send({ action: ACTIONS.WITHDRAW_INITIATION, reason: 'revise amount' });

  assert.equal(response.status, 302);
  assert.equal(getOpportunity().status, STATUSES.DRAFT);
  assert.deepEqual(calls, [
    ['findOpportunity', 30],
    ['updateOpportunity', 30, { status: STATUSES.DRAFT }],
    ['createEvent', {
      opportunityId: 30,
      eventType: ACTIONS.WITHDRAW_INITIATION,
      fromStatus: STATUSES.INITIATION_PENDING,
      toStatus: STATUSES.DRAFT,
      actorUserId: 7,
      targetUserId: null,
      comment: 'revise amount'
    }],
    ['closeTodos', 30, 'withdrawn']
  ]);
});

test('Sales Manager approves initiation and assigns quotation engineer from detail page', async () => {
  const { agent, calls, getOpportunity } = await createWorkflowAgent({
    user: {
      id: 2,
      username: 'manager01',
      displayName: 'Sales Manager',
      roles: [ROLES.SALES_MANAGER]
    },
    opportunity: {
      status: STATUSES.INITIATION_PENDING,
      salespersonId: 7,
      salesManagerId: 2
    },
    roleUsers: {
      [ROLES.QUOTATION_ENGINEER]: [{ id: 3, displayName: 'Quote Engineer', username: 'quote01', roles: [ROLES.QUOTATION_ENGINEER] }]
    }
  });

  const detail = await agent.get('/opportunities/30');
  assert.equal(detail.status, 200);
  assert.match(detail.text, /approve_initiation/);
  assert.match(detail.text, /reject_initiation/);
  assert.match(detail.text, /Quote Engineer/);

  const response = await agent
    .post('/opportunities/30/workflow')
    .type('form')
    .send({ action: ACTIONS.APPROVE_INITIATION, quotationEngineerId: '3', comment: 'approved' });

  assert.equal(response.status, 302);
  assert.equal(response.headers.location, '/opportunities/30');
  assert.equal(getOpportunity().status, STATUSES.TECHNICAL_SOLUTION_IN_PROGRESS);
  assert.equal(getOpportunity().quotationEngineerId, 3);
  assert.deepEqual(calls.filter((call) => call[0] !== 'listUsersByRole'), [
    ['findOpportunity', 30],
    ['updateOpportunity', 30, { status: STATUSES.TECHNICAL_SOLUTION_IN_PROGRESS, quotationEngineerId: 3 }],
    ['createEvent', {
      opportunityId: 30,
      eventType: ACTIONS.APPROVE_INITIATION,
      fromStatus: STATUSES.INITIATION_PENDING,
      toStatus: STATUSES.TECHNICAL_SOLUTION_IN_PROGRESS,
      actorUserId: 2,
      targetUserId: 3,
      comment: 'approved'
    }],
    ['closeTodos', 30, 'completed'],
    ['createTodo', { opportunityId: 30, assigneeUserId: 3, title: 'Prepare technical solution' }]
  ]);
});
