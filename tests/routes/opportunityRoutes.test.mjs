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
  const createdCustomers = [];
  const createdContacts = [];
  const requirementUpdates = [];
  const workflowEvents = [];
  const todoClosures = [];
  const todosToCreate = [];
  const workflowUpdates = [];
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
      },
      async createCustomer(input) {
        createdCustomers.push(input);
        return { id: 11, ...input };
      }
    },
    contactRepository: {
      async listContacts() {
        return [{ id: 20, customerId: 10, customerName: 'Acme Co', customerOwnerUserId: 7, name: 'Alice' }];
      },
      async getContactDetail() {
        return { id: 20, customerId: 10, customerName: 'Acme Co', customerOwnerUserId: 7, name: 'Alice' };
      },
      async createContact(input) {
        createdContacts.push(input);
        return { id: 21, customerName: 'Acme Co', customerOwnerUserId: 7, ...input };
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
      async updateWorkflowState(id, changes) {
        workflowUpdates.push({ id, changes });
        return { id, ...changes };
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
      },
      async create(event) {
        workflowEvents.push(event);
        return { id: 78, ...event };
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
      },
      async closePendingForOpportunity(opportunityId, status) {
        todoClosures.push({ opportunityId, status });
        return { rowCount: 1 };
      },
      async create(todo) {
        todosToCreate.push(todo);
        return { id: 89, ...todo };
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
      async deleteById() {
        throw new Error('not used');
      },
      async findById() {
        return null;
      }
    },
    requirementUpdateRepository: {
      async listByOpportunity() {
        return [];
      },
      async create(input) {
        requirementUpdates.push(input);
        return { id: 41, createdAt: '2026-06-06T08:00:00.000Z', ...input };
      }
    },
    commercialQuoteRepository: {
      async listByOpportunity() {
        return [];
      },
      async createQuote() {
        throw new Error('not used');
      },
      async reviewLatestPending() {
        throw new Error('not used');
      }
    },
    technicalSolutionRepository: {
      async listByOpportunity() {
        return [];
      },
      async createVersion() {
        throw new Error('not used');
      },
      async reviewLatestPending() {
        throw new Error('not used');
      }
    },
    ...extraOptions
  });
  const agent = request.agent(app);
  await agent.post('/login').type('form').send({ username: 'sales01', password: 'ChangeMe123!' });
  return { agent, created, createdCustomers, createdContacts, uploadedAttachments, requirementUpdates, workflowEvents, todoClosures, todosToCreate, workflowUpdates };
}

function assertAppSidebar(html, activeHref) {
  assert.match(html, /class="left-nav"/);
  assert.match(html, /font:\s*14px\/1\.4 Arial, "Microsoft YaHei", Helvetica, sans-serif;/);
  assert.match(html, /th\s*\{[\s\S]*font-size:\s*12px;/);
  assert.match(html, /h1\s*\{[\s\S]*font-size:\s*22px;/);
  assert.match(html, /\.nav-subgroup \.nav-link\s*\{[\s\S]*font-size:\s*13px;/);
  assert.match(html, /\.status\s*\{[\s\S]*font-size:\s*12px;/);
  assert.match(html, /--rail:\s*#0B0F6E;/);
  assert.match(html, /--rail-ink:\s*#ffffff;/);
  assert.match(html, /--rail-active:\s*#1e40af;/);
  assert.match(html, /href="\/workbench"/);
  assert.match(html, /href="\/opportunities"/);
  assert.match(html, /href="\/customers"/);
  assert.match(html, /href="\/contacts"/);
  assert.match(html, /action="\/logout"/);
  assert.match(html, new RegExp(`href="${activeHref}"`));
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

async function createWorkflowAgent({ user, opportunity, roleUsers = {}, attachments = [], technicalSolutions = [], commercialQuotes = [], contractApprovals = [], approvalSettings = {} }) {
  const actor = {
    passwordHash: await hashPassword('ChangeMe123!'),
    isActive: true,
    email: null,
    phone: null,
    ...user
  };
  let currentOpportunity = opportunityDetail(opportunity);
  const approvalSettingsByKey = new Map(Object.entries({
    opportunity_initiation: { settingKey: 'opportunity_initiation', userId: 2, userDisplayName: 'Sales Manager', username: 'manager01', roleCode: ROLES.SALES_MANAGER },
    technical_solution: { settingKey: 'technical_solution', userId: 4, userDisplayName: 'Technical Manager', username: 'tech01', roleCode: ROLES.TECHNICAL_MANAGER },
    commercial_quote: { settingKey: 'commercial_quote', userId: 5, userDisplayName: 'Commercial Manager', username: 'commercial01', roleCode: ROLES.COMMERCIAL_MANAGER },
    contract_approval: { settingKey: 'contract_approval', userId: 6, userDisplayName: 'Legal One', username: 'legal01', roleCode: ROLES.LEGAL_REVIEWER },
    ...approvalSettings
  }));
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
    approvalSettingRepository: {
      async findActiveByKey(settingKey) {
        calls.push(['findActiveApprovalSetting', settingKey]);
        return approvalSettingsByKey.get(settingKey) || null;
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
    },
    attachmentRepository: {
      async listByOpportunity() {
        return attachments;
      },
      async createAttachment() {
        throw new Error('not used');
      },
      async findById() {
        return null;
      }
    },
    commercialQuoteRepository: {
      async listByOpportunity() {
        return commercialQuotes;
      },
      async createQuote(input) {
        calls.push(['createQuote', input]);
        return { id: 200, ...input };
      },
      async reviewLatestPending(input) {
        calls.push(['reviewCommercialQuoteVersion', input]);
        return { id: 200, ...input };
      }
    },
    technicalSolutionRepository: {
      async listByOpportunity() {
        return technicalSolutions;
      },
      async createVersion(input) {
        calls.push(['createTechnicalSolutionVersion', input]);
        return { id: 201, versionNo: 1, status: 'pending', ...input };
      },
      async reviewLatestPending(input) {
        calls.push(['reviewTechnicalSolutionVersion', input]);
        return { id: 201, ...input };
      }
    },
    contractApprovalRepository: {
      async listByOpportunity() {
        return contractApprovals;
      },
      async createApproval(input) {
        calls.push(['createContractApproval', input]);
        return { id: 90, status: 'pending', ...input };
      },
      async findActiveByOpportunity(opportunityId) {
        calls.push(['findActiveContractApproval', Number(opportunityId)]);
        return contractApprovals.find((approval) => approval.status === 'pending') || null;
      },
      async approveActive(input) {
        calls.push(['approveContractApproval', input]);
        return { id: input.approvalId, status: 'approved' };
      },
      async rejectActive(input) {
        calls.push(['rejectContractApproval', input]);
        return { id: input.approvalId, status: 'rejected' };
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
  assertAppSidebar(list.text, '/opportunities');
  assert.match(list.text, /Opportunities/);
  assert.match(list.text, /Factory upgrade/);
  assert.match(list.text, /Acme Co/);
  assert.equal((list.text.match(/class="cell-link" href="\/opportunities\/30"/g) || []).length, 6);

  const form = await agent.get('/opportunities/new');
  assert.equal(form.status, 200);
  assertAppSidebar(form.text, '/opportunities');
  assert.match(form.text, /name="customerId"/);
  assert.match(form.text, /Acme Co/);
  assert.match(form.text, /Alice/);
  assert.match(form.text, /Add new customer here/);
  assert.match(form.text, /action="\/opportunities\/customers"/);
  assert.match(form.text, /Add new contact here/);
  assert.match(form.text, /action="\/opportunities\/contacts"/);

  const detail = await agent.get('/opportunities/30');
  assert.equal(detail.status, 200);
  assertAppSidebar(detail.text, '/opportunities');
  assert.match(detail.text, /Factory upgrade/);
  assert.match(detail.text, /Upgrade production line/);
  assert.match(detail.text, /Alice/);
});

test('opportunity form quick creates customer and returns with it selected', async () => {
  const { agent, createdCustomers } = await createLoggedInAgent();

  const response = await agent
    .post('/opportunities/customers')
    .type('form')
    .send({
      name: 'New Account',
      industry: 'Manufacturing',
      region: 'Shanghai',
      address: 'No. 1 Road',
      notes: 'Created while initiating opportunity'
    });

  assert.equal(response.status, 302);
  assert.equal(response.headers.location, '/opportunities/new?customerId=11');
  assert.deepEqual(createdCustomers, [{
    name: 'New Account',
    industry: 'Manufacturing',
    region: 'Shanghai',
    address: 'No. 1 Road',
    ownerUserId: 7,
    notes: 'Created while initiating opportunity'
  }]);
});

test('opportunity form quick creates contact and returns with it selected', async () => {
  const { agent, createdContacts } = await createLoggedInAgent();

  const response = await agent
    .post('/opportunities/contacts')
    .type('form')
    .send({
      customerId: '10',
      name: 'Bob Buyer',
      title: 'Purchasing Manager',
      phone: '13800000000',
      email: 'bob@example.com',
      wechat: 'bobwx',
      notes: 'Primary buyer'
    });

  assert.equal(response.status, 302);
  assert.equal(response.headers.location, '/opportunities/new?customerId=10&contactId=21');
  assert.deepEqual(createdContacts, [{
    customerId: 10,
    name: 'Bob Buyer',
    title: 'Purchasing Manager',
    phone: '13800000000',
    email: 'bob@example.com',
    wechat: 'bobwx',
    notes: 'Primary buyer'
  }]);
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
  assert.match(detail.text, /Basic Info/);
  assert.match(detail.text, /Requirement Materials/);
  assert.match(detail.text, /Technical Solution/);
  assert.match(detail.text, /Commercial Quote/);
  assert.match(detail.text, /Commercial Contract/);
  assert.match(detail.text, /name="attachment"/);
  assert.match(detail.text, /name="category" value="requirement"/);
  assert.match(detail.text, /technical-solution\.pdf/);
  assert.match(detail.text, /technical_solution/);
  assert.match(detail.text, /\/opportunities\/30\/attachments\/55\/download/);
  assert.match(detail.text, /\/opportunities\/30\/attachments\/55\/preview/);
});

test('opportunity detail uses distinct business panel colors', async () => {
  const { agent } = await createLoggedInAgent();

  const detail = await agent.get('/opportunities/30');

  assert.equal(detail.status, 200);
  assert.match(detail.text, /class="content-section business-section business-section-basic"/);
  assert.match(detail.text, /class="content-section business-section business-section-requirement"/);
  assert.match(detail.text, /class="content-section business-section business-section-technical"/);
  assert.match(detail.text, /class="content-section business-section business-section-quote"/);
  assert.match(detail.text, /class="content-section business-section business-section-contract"/);
  assert.match(detail.text, /\.business-section-basic\s*\{[\s\S]*background:\s*#f4f7fb;/);
  assert.match(detail.text, /\.business-section-basic > h2\s*\{[\s\S]*background:\s*#1e3a5f;/);
  assert.match(detail.text, /\.business-section-requirement\s*\{[\s\S]*background:\s*#fffbeb;/);
  assert.match(detail.text, /\.business-section-requirement > h2\s*\{[\s\S]*background:\s*#92400e;/);
  assert.match(detail.text, /\.business-section-technical\s*\{[\s\S]*background:\s*#eff6ff;/);
  assert.match(detail.text, /\.business-section-technical > h2\s*\{[\s\S]*background:\s*#1d4ed8;/);
  assert.match(detail.text, /\.business-section-quote\s*\{[\s\S]*background:\s*#ecfdf5;/);
  assert.match(detail.text, /\.business-section-quote > h2\s*\{[\s\S]*background:\s*#047857;/);
  assert.match(detail.text, /\.business-section-contract\s*\{[\s\S]*background:\s*#f5f3ff;/);
  assert.match(detail.text, /\.business-section-contract > h2\s*\{[\s\S]*background:\s*#6d28d9;/);
});

test('opportunity detail groups business attachments into five business panels', async () => {
  const attachments = [
    {
      id: 51,
      opportunityId: 30,
      category: 'requirement',
      originalName: 'requirement-spec.pdf',
      storedPath: '2026/06/requirement-spec.pdf',
      mimeType: 'application/pdf',
      fileSize: 2048,
      uploadedBy: 7,
      uploaderDisplayName: 'Sales One',
      uploadedAt: '2026-06-05T09:00:00.000Z'
    },
    {
      id: 52,
      opportunityId: 30,
      category: 'commercial_quote',
      originalName: 'quote-v1.xlsx',
      storedPath: '2026/06/quote-v1.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      fileSize: 2048,
      uploadedBy: 3,
      uploaderDisplayName: 'Quote Engineer',
      uploadedAt: '2026-06-05T11:00:00.000Z'
    },
    {
      id: 53,
      opportunityId: 30,
      category: 'contract',
      originalName: 'contract-draft.docx',
      storedPath: '2026/06/contract-draft.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      fileSize: 2048,
      uploadedBy: 7,
      uploaderDisplayName: 'Sales One',
      uploadedAt: '2026-06-05T13:00:00.000Z'
    }
  ];
  const { agent } = await createLoggedInAgent({
    attachmentRepository: {
      async listByOpportunity() {
        return attachments;
      },
      async createAttachment() {
        throw new Error('not used');
      },
      async findById() {
        return null;
      }
    }
  });

  const detail = await agent.get('/opportunities/30');

  assert.equal(detail.status, 200);
  assert.match(detail.text, /Requirement Materials[\s\S]*requirement-spec\.pdf/);
  assert.match(detail.text, /Commercial Quote[\s\S]*quote-v1\.xlsx/);
  assert.match(detail.text, /Commercial Contract[\s\S]*contract-draft\.docx/);
});

test('opportunity detail shows technical solution version history', async () => {
  const { agent } = await createLoggedInAgent({
    technicalSolutionRepository: {
      async listByOpportunity() {
        return [{
          id: 91,
          opportunityId: 30,
          versionNo: 2,
          summary: 'Updated cabinet control solution',
          parameters: 'IP65, stainless cabinet',
          implementationPlan: 'Revise drawings and wiring plan',
          status: 'approved',
          submittedBy: 3,
          submitterDisplayName: 'Quote Engineer',
          submittedAt: '2026-06-06T08:00:00.000Z',
          reviewedBy: 4,
          reviewerDisplayName: 'Technical Manager',
          reviewedAt: '2026-06-06T09:00:00.000Z',
          reviewComment: 'approved'
        }];
      },
      async createVersion() {
        throw new Error('not used');
      },
      async reviewLatestPending() {
        throw new Error('not used');
      }
    }
  });

  const detail = await agent.get('/opportunities/30');

  assert.equal(detail.status, 200);
  assert.match(detail.text, /Technical Solution[\s\S]*Version History/);
  assert.match(detail.text, /V2/);
  assert.match(detail.text, /Updated cabinet control solution/);
  assert.match(detail.text, /IP65, stainless cabinet/);
  assert.match(detail.text, /Revise drawings and wiring plan/);
  assert.match(detail.text, /approved/);
  assert.match(detail.text, /Quote Engineer/);
  assert.match(detail.text, /Technical Manager/);
});

test('opportunity detail shows commercial quote version history', async () => {
  const { agent } = await createLoggedInAgent({
    commercialQuoteRepository: {
      async listByOpportunity() {
        return [{
          id: 101,
          opportunityId: 30,
          versionNo: 2,
          totalPrice: 2100,
          paymentTerms: '40% advance, 60% before delivery',
          validityDate: '2026-08-31',
          remarks: 'price revised',
          status: 'approved',
          submittedBy: 3,
          submitterDisplayName: 'Quote Engineer',
          submittedAt: '2026-06-06T12:00:00.000Z',
          reviewedBy: 5,
          reviewerDisplayName: 'Commercial Manager',
          reviewedAt: '2026-06-06T13:00:00.000Z',
          reviewComment: 'approved',
          items: [{
            id: 501,
            itemName: 'Control cabinet',
            specification: 'PLC control set',
            unit: 'set',
            quantity: 2,
            unitPrice: 1050,
            subtotal: 2100
          }]
        }];
      },
      async createQuote() {
        throw new Error('not used');
      },
      async reviewLatestPending() {
        throw new Error('not used');
      }
    }
  });

  const detail = await agent.get('/opportunities/30');

  assert.equal(detail.status, 200);
  assert.match(detail.text, /Commercial Quote[\s\S]*Version History/);
  assert.match(detail.text, /V2/);
  assert.match(detail.text, /2100/);
  assert.match(detail.text, /40% advance, 60% before delivery/);
  assert.match(detail.text, /Control cabinet/);
  assert.match(detail.text, /PLC control set/);
  assert.match(detail.text, /approved/);
  assert.match(detail.text, /Quote Engineer/);
  assert.match(detail.text, /Commercial Manager/);
});

test('opportunity detail shows contract version history', async () => {
  const { agent } = await createWorkflowAgent({
    user: {
      id: 7,
      username: 'sales01',
      displayName: 'Sales One',
      roles: [ROLES.SALESPERSON]
    },
    opportunity: {
      status: STATUSES.CONTRACT_REJECTED,
      salespersonId: 7
    },
    contractApprovals: [{
      id: 90,
      opportunityId: 30,
      versionNo: 2,
      currentStep: 1,
      status: 'rejected',
      submittedBy: 7,
      submittedAt: '2026-06-06T12:00:00.000Z',
      completedAt: '2026-06-06T13:00:00.000Z',
      stepId: 91,
      reviewerUserId: 6,
      reviewerDisplayName: 'Legal One',
      stepAction: 'rejected',
      stepComment: 'missing clause',
      actedAt: '2026-06-06T13:00:00.000Z'
    }]
  });

  const detail = await agent.get('/opportunities/30');

  assert.equal(detail.status, 200);
  assert.match(detail.text, /Commercial Contract[\s\S]*Version History/);
  assert.match(detail.text, /V2/);
  assert.match(detail.text, /rejected/);
  assert.match(detail.text, /Legal One/);
  assert.match(detail.text, /missing clause/);
});

test('opportunity detail shows upload forms in each business material panel', async () => {
  const { agent } = await createLoggedInAgent();

  const detail = await agent.get('/opportunities/30');

  assert.equal(detail.status, 200);
  assert.equal((detail.text.match(/action="\/opportunities\/30\/attachments"/g) || []).length, 4);
  assert.equal((detail.text.match(/class="form-panel attachment-upload-panel"/g) || []).length, 4);
  assert.match(detail.text, /\.attachment-upload-panel\s*\{[\s\S]*max-width:\s*none;/);
  assert.match(detail.text, /\.attachment-upload-panel\s*\{[\s\S]*width:\s*100%;/);
  assert.match(detail.text, /\.attachment-upload-panel\s*\{[\s\S]*background:\s*rgba\(255,\s*255,\s*255,\s*0\.35\);/);
  const requirementSection = detail.text.match(/<h2>Requirement Materials<\/h2>[\s\S]*?<h2>Technical Solution<\/h2>/)[0];
  assert.match(requirementSection, /name="category" value="requirement"/);
  assert.doesNotMatch(requirementSection, /<select name="category"/);
  assert.match(detail.text, /Technical Solution[\s\S]*name="category" value="technical_solution"/);
  assert.match(detail.text, /Commercial Quote[\s\S]*name="category" value="commercial_quote"/);
  assert.match(detail.text, /Commercial Contract[\s\S]*name="category" value="contract"/);
});

test('technical solution workflow form captures version details', async () => {
  const { agent } = await createWorkflowAgent({
    user: {
      id: 3,
      username: 'quote01',
      displayName: 'Quote Engineer',
      roles: [ROLES.QUOTATION_ENGINEER]
    },
    opportunity: {
      status: STATUSES.TECHNICAL_SOLUTION_IN_PROGRESS,
      salespersonId: 7,
      quotationEngineerId: 3
    },
    attachments: [{ id: 55, category: 'technical_solution' }]
  });

  const detail = await agent.get('/opportunities/30');

  assert.equal(detail.status, 200);
  assert.match(detail.text, /Submit Technical Solution/);
  assert.match(detail.text, /name="solutionSummary"/);
  assert.match(detail.text, /name="solutionParameters"/);
  assert.match(detail.text, /name="implementationPlan"/);
});

test('approved opportunity shows supplemental requirement form and history', async () => {
  const { agent } = await createLoggedInAgent({
    opportunityRepository: {
      async getOpportunityDetail() {
        return opportunityDetail({
          status: STATUSES.TECHNICAL_SOLUTION_IN_PROGRESS,
          quotationEngineerId: 3
        });
      }
    },
    requirementUpdateRepository: {
      async listByOpportunity() {
        return [{
          id: 41,
          opportunityId: 30,
          requirementText: 'Add corrosion proof cabinet requirement',
          reason: 'Customer site has salt fog environment',
          createdBy: 7,
          creatorDisplayName: 'Sales One',
          createdAt: '2026-06-06T08:00:00.000Z'
        }];
      },
      async create() {
        throw new Error('not used');
      }
    }
  });

  const detail = await agent.get('/opportunities/30');

  assert.equal(detail.status, 200);
  assert.match(detail.text, /Requirement Materials[\s\S]*Supplemental Requirements/);
  assert.match(detail.text, /name="requirementText"/);
  assert.match(detail.text, /name="reason"/);
  assert.match(detail.text, /Add corrosion proof cabinet requirement/);
  assert.match(detail.text, /Customer site has salt fog environment/);
  assert.match(detail.text, /Sales One/);
});

test('salesperson creates supplemental requirement after initiation approval', async () => {
  const { agent, requirementUpdates, workflowEvents, todoClosures, todosToCreate, workflowUpdates } = await createLoggedInAgent({
    opportunityRepository: {
      async getOpportunityDetail() {
        return opportunityDetail({
          status: STATUSES.TECHNICAL_SOLUTION_IN_PROGRESS,
          quotationEngineerId: 3
        });
      }
    }
  });

  const response = await agent
    .post('/opportunities/30/requirement-updates')
    .type('form')
    .send({
      requirementText: 'Add corrosion proof cabinet requirement',
      reason: 'Customer site has salt fog environment'
    });

  assert.equal(response.status, 302);
  assert.equal(response.headers.location, '/opportunities/30');
  assert.deepEqual(requirementUpdates, [{
    opportunityId: 30,
    requirementText: 'Add corrosion proof cabinet requirement',
    reason: 'Customer site has salt fog environment',
    createdBy: 7
  }]);
  assert.deepEqual(workflowUpdates, []);
  assert.deepEqual(workflowEvents, [{
    opportunityId: 30,
    eventType: ACTIONS.ADD_REQUIREMENT_UPDATE,
    fromStatus: STATUSES.TECHNICAL_SOLUTION_IN_PROGRESS,
    toStatus: STATUSES.TECHNICAL_SOLUTION_IN_PROGRESS,
    actorUserId: 7,
    targetUserId: 3,
    comment: 'Add corrosion proof cabinet requirement\nReason: Customer site has salt fog environment'
  }]);
  assert.deepEqual(todoClosures, [{ opportunityId: 30, status: 'superseded' }]);
  assert.deepEqual(todosToCreate, [{
    opportunityId: 30,
    assigneeUserId: 3,
    title: 'Revise technical solution for supplemental requirement'
  }]);
});

test('draft opportunity rejects supplemental requirement creation', async () => {
  let createCalled = false;
  const { agent } = await createLoggedInAgent({
    requirementUpdateRepository: {
      async listByOpportunity() {
        return [];
      },
      async create() {
        createCalled = true;
        throw new Error('should not create update');
      }
    }
  });

  const response = await agent
    .post('/opportunities/30/requirement-updates')
    .type('form')
    .send({
      requirementText: 'Add corrosion proof cabinet requirement',
      reason: 'Customer site has salt fog environment'
    });

  assert.equal(response.status, 403);
  assert.equal(createCalled, false);
});

test('draft opportunity shows delete action for requirement material attachments', async () => {
  const attachment = {
    id: 55,
    opportunityId: 30,
    category: 'requirement',
    originalName: 'requirement-spec.pdf',
    storedPath: '2026/06/requirement-spec.pdf',
    mimeType: 'application/pdf',
    fileSize: 2048,
    uploadedBy: 7,
    uploaderDisplayName: 'Sales One',
    uploadedAt: '2026-06-05T09:00:00.000Z'
  };
  const { agent } = await createLoggedInAgent({
    attachmentRepository: {
      async listByOpportunity() {
        return [attachment];
      },
      async createAttachment() {
        throw new Error('not used');
      },
      async deleteById() {
        throw new Error('not used');
      },
      async findById() {
        return attachment;
      }
    }
  });

  const detail = await agent.get('/opportunities/30');

  assert.equal(detail.status, 200);
  assert.match(detail.text, /Requirement Materials[\s\S]*requirement-spec\.pdf[\s\S]*\/opportunities\/30\/attachments\/55\/delete/);
  assert.match(detail.text, /Requirement Materials[\s\S]*Delete/);
});

test('submitted opportunity hides and blocks requirement material deletion', async () => {
  const uploadDir = await mkdtemp(path.join(os.tmpdir(), 'bestcrm-delete-locked-'));
  try {
    await writeFile(path.join(uploadDir, 'requirement.txt'), 'locked requirement', 'utf8');
    let deleteCalled = false;
    const attachment = {
      id: 55,
      opportunityId: 30,
      category: 'requirement',
      originalName: 'requirement.txt',
      storedPath: 'requirement.txt',
      mimeType: 'text/plain',
      fileSize: 18,
      uploadedBy: 7,
      uploaderDisplayName: 'Sales One',
      uploadedAt: '2026-06-05T09:00:00.000Z'
    };
    const { agent } = await createLoggedInAgent({
      uploadDir,
      opportunityRepository: {
        async getOpportunityDetail() {
          return opportunityDetail({ status: STATUSES.INITIATION_PENDING });
        }
      },
      attachmentRepository: {
        async listByOpportunity() {
          return [attachment];
        },
        async createAttachment() {
          throw new Error('not used');
        },
        async deleteById() {
          deleteCalled = true;
          throw new Error('should not delete locked attachment');
        },
        async findById() {
          return attachment;
        }
      }
    });

    const detail = await agent.get('/opportunities/30');

    assert.equal(detail.status, 200);
    assert.doesNotMatch(detail.text, /\/opportunities\/30\/attachments\/55\/delete/);

    const response = await agent.post('/opportunities/30/attachments/55/delete').type('form').send();

    assert.equal(response.status, 403);
    assert.equal(deleteCalled, false);
    assert.equal(existsSync(path.join(uploadDir, 'requirement.txt')), true);
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
});

test('draft opportunity deletes requirement material metadata and stored file', async () => {
  const uploadDir = await mkdtemp(path.join(os.tmpdir(), 'bestcrm-delete-requirement-'));
  try {
    await writeFile(path.join(uploadDir, 'requirement.txt'), 'draft requirement', 'utf8');
    const deletedIds = [];
    const attachment = {
      id: 55,
      opportunityId: 30,
      category: 'requirement',
      originalName: 'requirement.txt',
      storedPath: 'requirement.txt',
      mimeType: 'text/plain',
      fileSize: 17,
      uploadedBy: 7,
      uploaderDisplayName: 'Sales One',
      uploadedAt: '2026-06-05T09:00:00.000Z'
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
        async deleteById(id) {
          deletedIds.push(Number(id));
          return { rowCount: 1 };
        },
        async findById() {
          return attachment;
        }
      }
    });

    const response = await agent.post('/opportunities/30/attachments/55/delete').type('form').send();

    assert.equal(response.status, 302);
    assert.equal(response.headers.location, '/opportunities/30');
    assert.deepEqual(deletedIds, [55]);
    assert.equal(existsSync(path.join(uploadDir, 'requirement.txt')), false);
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
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

test('page form stores requirement material attachment category', async () => {
  const uploadDir = await mkdtemp(path.join(os.tmpdir(), 'bestcrm-requirement-upload-'));
  try {
    const { agent, uploadedAttachments } = await createLoggedInAgent({ uploadDir });

    const response = await agent
      .post('/opportunities/30/attachments')
      .field('category', 'requirement')
      .attach('attachment', Buffer.from('requirement file'), {
        filename: 'requirement.txt',
        contentType: 'text/plain'
      });

    assert.equal(response.status, 302);
    assert.equal(response.headers.location, '/opportunities/30');
    assert.equal(uploadedAttachments.length, 1);
    assert.equal(uploadedAttachments[0].category, 'requirement');
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
  assert.doesNotMatch(detail.text, /name="salesManagerId"/);

  const response = await agent
    .post('/opportunities/30/workflow')
    .type('form')
    .send({ action: ACTIONS.SUBMIT_INITIATION, comment: 'ready for review' });

  assert.equal(response.status, 302);
  assert.equal(response.headers.location, '/opportunities/30');
  assert.equal(getOpportunity().status, STATUSES.INITIATION_PENDING);
  assert.equal(getOpportunity().salesManagerId, 2);
  assert.deepEqual(calls.filter((call) => call[0] !== 'listUsersByRole'), [
    ['findOpportunity', 30],
    ['findActiveApprovalSetting', 'opportunity_initiation'],
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

test('commercial quote form shows quote fields and missing attachment hint', async () => {
  const { agent } = await createWorkflowAgent({
    user: {
      id: 3,
      username: 'quote01',
      displayName: 'Quote Engineer',
      roles: [ROLES.QUOTATION_ENGINEER]
    },
    opportunity: {
      status: STATUSES.COMMERCIAL_QUOTE_IN_PROGRESS,
      salespersonId: 7,
      quotationEngineerId: 3
    },
    roleUsers: {
      [ROLES.COMMERCIAL_MANAGER]: [{ id: 5, displayName: 'Commercial Manager', username: 'commercial01', roles: [ROLES.COMMERCIAL_MANAGER] }]
    }
  });

  const detail = await agent.get('/opportunities/30');

  assert.equal(detail.status, 200);
  assert.match(detail.text, /submit_commercial_quote/);
  assert.match(detail.text, /name="quoteItemName"/);
  assert.match(detail.text, /name="quoteUnitPrice"/);
  assert.match(detail.text, /name="totalPrice"/);
  assert.doesNotMatch(detail.text, /name="commercialManagerId"/);
  assert.match(detail.text, /Commercial Quote attachment is required before submission/);
});

test('workflow route blocks technical submission without required attachment', async () => {
  const { agent, getOpportunity } = await createWorkflowAgent({
    user: {
      id: 3,
      username: 'quote01',
      displayName: 'Quote Engineer',
      roles: [ROLES.QUOTATION_ENGINEER]
    },
    opportunity: {
      status: STATUSES.TECHNICAL_SOLUTION_IN_PROGRESS,
      salespersonId: 7,
      quotationEngineerId: 3
    },
    roleUsers: {
      [ROLES.TECHNICAL_MANAGER]: [{ id: 4, displayName: 'Technical Manager', username: 'tech01', roles: [ROLES.TECHNICAL_MANAGER] }]
    }
  });

  const response = await agent
    .post('/opportunities/30/workflow')
    .type('form')
    .send({ action: ACTIONS.SUBMIT_TECHNICAL_SOLUTION, comment: 'ready' });

  assert.equal(response.status, 400);
  assert.match(response.text, /Technical Solution attachment is required/);
  assert.equal(getOpportunity().status, STATUSES.TECHNICAL_SOLUTION_IN_PROGRESS);
});

test('workflow route submits technical solution as a version for approval', async () => {
  const { agent, calls, getOpportunity } = await createWorkflowAgent({
    user: {
      id: 3,
      username: 'quote01',
      displayName: 'Quote Engineer',
      roles: [ROLES.QUOTATION_ENGINEER]
    },
    opportunity: {
      status: STATUSES.TECHNICAL_SOLUTION_IN_PROGRESS,
      salespersonId: 7,
      quotationEngineerId: 3
    },
    attachments: [{ id: 55, category: 'technical_solution' }]
  });

  const response = await agent
    .post('/opportunities/30/workflow')
    .type('form')
    .send({
      action: ACTIONS.SUBMIT_TECHNICAL_SOLUTION,
      solutionSummary: 'PLC cabinet technical solution',
      solutionParameters: 'IP65 cabinet',
      implementationPlan: 'Prepare drawings',
      comment: 'solution ready'
    });

  assert.equal(response.status, 302);
  assert.equal(response.headers.location, '/opportunities/30');
  assert.equal(getOpportunity().status, STATUSES.TECHNICAL_SOLUTION_PENDING);
  assert.deepEqual(calls, [
    ['findOpportunity', 30],
    ['findActiveApprovalSetting', 'technical_solution'],
    ['updateOpportunity', 30, { status: STATUSES.TECHNICAL_SOLUTION_PENDING, technicalManagerId: 4 }],
    ['createTechnicalSolutionVersion', {
      opportunityId: 30,
      summary: 'PLC cabinet technical solution',
      parameters: 'IP65 cabinet',
      implementationPlan: 'Prepare drawings',
      submittedBy: 3
    }],
    ['createEvent', {
      opportunityId: 30,
      eventType: ACTIONS.SUBMIT_TECHNICAL_SOLUTION,
      fromStatus: STATUSES.TECHNICAL_SOLUTION_IN_PROGRESS,
      toStatus: STATUSES.TECHNICAL_SOLUTION_PENDING,
      actorUserId: 3,
      targetUserId: 4,
      comment: 'solution ready'
    }],
    ['closeTodos', 30, 'completed'],
    ['createTodo', { opportunityId: 30, assigneeUserId: 4, title: 'Approve technical solution' }]
  ]);
});

test('legal reviewer can see contract approval records and approve from detail page', async () => {
  const contractApprovals = [{
    id: 90,
    opportunityId: 30,
    currentStep: 1,
    status: 'pending',
    submittedBy: 7,
    submittedAt: '2026-06-05T12:00:00.000Z',
    completedAt: null,
    stepId: 91,
    reviewerUserId: 6,
    reviewerDisplayName: 'Legal One',
    stepAction: 'pending',
    stepComment: null,
    actedAt: null
  }];
  const { agent, calls, getOpportunity } = await createWorkflowAgent({
    user: {
      id: 6,
      username: 'legal01',
      displayName: 'Legal One',
      roles: [ROLES.LEGAL_REVIEWER]
    },
    opportunity: {
      status: STATUSES.CONTRACT_APPROVAL_IN_PROGRESS,
      salespersonId: 7
    },
    contractApprovals
  });

  const detail = await agent.get('/opportunities/30');
  assert.equal(detail.status, 200);
  assert.match(detail.text, /Contract Approvals/);
  assert.match(detail.text, /Legal One/);
  assert.match(detail.text, /approve_contract/);
  assert.match(detail.text, /reject_contract/);

  const response = await agent
    .post('/opportunities/30/workflow')
    .type('form')
    .send({ action: ACTIONS.APPROVE_CONTRACT, comment: 'legal approved' });

  assert.equal(response.status, 302);
  assert.equal(response.headers.location, '/opportunities/30');
  assert.equal(getOpportunity().status, STATUSES.CONTRACT_ARCHIVED);
  assert.deepEqual(calls.filter((call) => call[0] !== 'listUsersByRole'), [
    ['findOpportunity', 30],
    ['findActiveContractApproval', 30],
    ['updateOpportunity', 30, { status: STATUSES.CONTRACT_ARCHIVED, archivedAt: getOpportunity().archivedAt }],
    ['approveContractApproval', { approvalId: 90, stepId: 91, comment: 'legal approved' }],
    ['createEvent', {
      opportunityId: 30,
      eventType: ACTIONS.APPROVE_CONTRACT,
      fromStatus: STATUSES.CONTRACT_APPROVAL_IN_PROGRESS,
      toStatus: STATUSES.CONTRACT_ARCHIVED,
      actorUserId: 6,
      targetUserId: 7,
      comment: 'legal approved'
    }],
    ['closeTodos', 30, 'completed']
  ]);
});
