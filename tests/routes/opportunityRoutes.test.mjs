import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { ACTIONS } from '../../src/domain/workflow.mjs';
import { ROLES } from '../../src/domain/roles.mjs';
import { STATUSES } from '../../src/domain/statuses.mjs';
import { createApp } from '../../src/server.mjs';
import { hashPassword } from '../../src/services/authService.mjs';

function extractCsrfToken(html) {
  return html.match(/name="_csrf"\s+value="([^"]+)"/)?.[1] || '';
}

async function createLoggedInAgent(extraOptions = {}) {
  const {
    user: userOverrides = {},
    language,
    opportunityRepository: opportunityRepositoryOverrides = {},
    attachmentRepository: attachmentRepositoryOverrides = {},
    ...appOptions
  } = extraOptions;
  const user = {
    id: 7,
    username: 'sales01',
    passwordHash: await hashPassword('ChangeMe123!'),
    displayName: 'Sales One',
    isActive: true,
    ...userOverrides,
    roles: userOverrides.roles || [ROLES.SALESPERSON]
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
      },
      async listUsersWithRoles() {
        return [
          user,
          {
            id: 8,
            username: 'team01',
            displayName: 'Team Member',
            email: null,
            phone: null,
            isActive: true,
            roles: [ROLES.SALESPERSON]
          },
          {
            id: 2,
            username: 'manager01',
            displayName: 'Sales Manager',
            email: null,
            phone: null,
            isActive: true,
            roles: [ROLES.SALES_MANAGER]
          }
        ];
      },
      async listUsersByRole(role) {
        if (role !== ROLES.SALESPERSON) {
          return [];
        }
        return [
          user,
          {
            id: 8,
            username: 'team01',
            displayName: 'Team Member',
            email: null,
            phone: null,
            isActive: true,
            roles: [ROLES.SALESPERSON]
          }
        ];
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
          salespersonId: 7,
          salespersonUsername: 'sales01',
          salespersonDisplayName: 'Sales One'
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
          salespersonId: 7,
          salespersonUsername: 'sales01',
          salespersonDisplayName: 'Sales One'
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
      async updateOpportunity() {
        throw new Error('not used');
      },
      async deleteById() {
        throw new Error('not used');
      },
      async updateWorkflowState(id, changes) {
        workflowUpdates.push({ id, changes });
        return { id, ...changes };
      },
      ...opportunityRepositoryOverrides
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
      async closePendingForOpportunityAndAssignee(opportunityId, assigneeUserId, status) {
        todoClosures.push({ opportunityId, assigneeUserId, status });
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
      },
      ...attachmentRepositoryOverrides
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
    opportunityResponsibilityRepository: {
      async listTeamMembersByOpportunity() {
        return [];
      },
      async listOwnerTransfersByOpportunity() {
        return [];
      }
    },
    ...appOptions
  });
  const agent = request.agent(app);
  if (language) {
    await agent.get(`/language?lang=${language}&returnTo=/login`);
  }
  const loginPayload = { username: user.username, password: 'ChangeMe123!' };
  if (appOptions.csrfProtection) {
    const loginForm = await agent.get('/login');
    loginPayload._csrf = extractCsrfToken(loginForm.text);
  }
  await agent.post('/login').type('form').send(loginPayload);
  return { agent, created, createdCustomers, createdContacts, uploadedAttachments, requirementUpdates, workflowEvents, todoClosures, todosToCreate, workflowUpdates };
}

function assertAppSidebar(html, activeHref) {
  const navAccount = html.match(/<div class="nav-account"[\s\S]*?<\/div>\s*<\/div>/)?.[0] || '';
  assert.match(html, /class="left-nav"/);
  assert.match(html, /font:\s*20px\/1\.45 Arial, "Microsoft YaHei", Helvetica, sans-serif;/);
  assert.match(html, /th\s*\{[\s\S]*font-size:\s*20px;/);
  assert.match(html, /h1\s*\{[\s\S]*font-size:\s*24px;/);
  assert.match(html, /\.nav-subgroup \.nav-link\s*\{[\s\S]*font-size:\s*20px;/);
  assert.match(html, /\.status\s*\{[\s\S]*font-size:\s*20px;/);
  assert.match(html, /--rail:\s*#0B0F6E;/);
  assert.match(html, /--rail-ink:\s*#ffffff;/);
  assert.match(html, /--rail-active:\s*#1e40af;/);
  assert.match(html, /class="brand-logo"\s+src="\/assets\/sunkaier-logo\.png"\s+alt="SUNKAIER"/);
  assert.match(html, /\.brand-logo\s*\{[\s\S]*width:\s*178px;/);
  assert.match(html, /class="nav-account"/);
  assert.match(html, /class="nav-account-name"[\s\S]*Sales One/);
  assert.doesNotMatch(html, /class="nav-account-meta"/);
  assert.doesNotMatch(html, /class="nav-account-roles"/);
  assert.doesNotMatch(navAccount, /salesperson/);
  assert.match(html, /\.nav-account\s*\{/);
  assert.match(html, /\.nav-group\s*\{[\s\S]*margin-top:\s*18px;/);
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
    salespersonUsername: 'sales01',
    salespersonDisplayName: 'Sales One',
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

async function createWorkflowAgent({
  user,
  opportunity,
  roleUsers = {},
  attachments = [],
  technicalSolutions = [],
  commercialQuotes = [],
  contractApprovals = [],
  approvalSettings = {},
  workflowTransaction
}) {
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
      },
      async closePendingForOpportunityAndAssignee(opportunityId, assigneeUserId, status) {
        calls.push(['closeTodosForAssignee', opportunityId, assigneeUserId, status]);
        return { rowCount: 1 };
      }
    },
    attachmentRepository: {
      async listByOpportunity() {
        return attachments;
      },
      async bindUnboundToMaterialVersion(input) {
        calls.push(['bindUnboundToMaterialVersion', input]);
        return { rowCount: attachments.length };
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
    },
    opportunityMaterialVersionRepository: {
      async createVersion(input) {
        calls.push(['createMaterialVersion', input]);
        return { id: 300, versionNo: 1, ...input };
      },
      async findLatestByOpportunityAndType(opportunityId, materialType) {
        calls.push(['findLatestMaterialVersion', Number(opportunityId), materialType]);
        return { id: 300, opportunityId: Number(opportunityId), materialType, status: 'pending', versionNo: 1 };
      },
      async reviewVersion(input) {
        calls.push(['reviewMaterialVersion', input]);
        return { id: input.versionId, ...input };
      },
      async listByOpportunity() {
        return [];
      }
    },
    workflowTransaction
  });
  const agent = request.agent(app);
  await agent.post('/login').type('form').send({ username: actor.username, password: 'ChangeMe123!' });
  return { agent, calls, getOpportunity: () => currentOpportunity };
}

test('anonymous users are redirected from opportunity pages', async () => {
  const app = createApp({ databaseUrl: '', sessionSecret: 'test-secret' });

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
  assert.match(list.text, /<th>Opportunity Name<\/th>/);
  assert.doesNotMatch(list.text, /<th>Title<\/th>/);
  assert.match(list.text, /<th>Owner<\/th>/);
  assert.match(list.text, /Sales One/);
  assert.match(list.text, /<table class="list-table opportunity-list-table">/);
  assert.match(list.text, /\.opportunity-list-table\s*\{[\s\S]*table-layout:\s*auto;/);
  assert.match(list.text, /\.opportunity-list-table thead th\s*\{[\s\S]*background:\s*#1e3a5f;/);
  assert.match(list.text, /\.opportunity-list-table th,\s*\.opportunity-list-table td\s*\{[\s\S]*white-space:\s*nowrap;/);
  assert.equal((list.text.match(/class="cell-link" href="\/opportunities\/30"/g) || []).length, 7);

  const form = await agent.get('/opportunities/new');
  assert.equal(form.status, 200);
  assertAppSidebar(form.text, '/opportunities');
  assert.match(form.text, /name="customerId"/);
  assert.match(form.text, /Acme Co/);
  assert.match(form.text, /Alice/);
  assert.match(form.text, /Add new customer here/);
  assert.match(form.text, /\.inline-create-panel\s*\{[\s\S]*background:\s*#eef6ff;/);
  assert.match(form.text, /\.inline-create-panel summary\s*\{[\s\S]*background:\s*#dbeafe;/);
  assert.match(form.text, /action="\/opportunities\/customers"/);
  assert.match(form.text, /<select name="industry">/);
  for (const industry of ['石油化工', '精细化工', '湿法冶金', '环保', '食品', '医化', '其他']) {
    assert.match(form.text, new RegExp(`<option value="${industry}">${industry}<\\/option>`));
  }
  assert.match(form.text, /<select name="country">/);
  assert.match(form.text, /<option value="China">China<\/option>/);
  assert.match(form.text, /<select name="region">/);
  assert.match(form.text, /<option value="Shanghai">Shanghai<\/option>/);
  assert.match(form.text, /Add new contact here/);
  assert.match(form.text, /href="\/contacts\/new\?customerId=10&amp;returnTo=opportunity-initiation"/);
  assert.doesNotMatch(form.text, /action="\/opportunities\/contacts"/);
  assert.match(form.text, /Opportunity Name\s*<input name="title"/);
  assert.doesNotMatch(form.text, /Title\s*<input name="title"/);
  assert.match(form.text, /Delivery Period\s*<input name="deliveryCycle"/);
  assert.doesNotMatch(form.text, /Delivery Cycle\s*<input name="deliveryCycle"/);
  assert.match(form.text, /<select name="projectType" form="opportunity-form">/);
  assert.match(form.text, /Opportunity Type\s*<select name="projectType"/);
  for (const projectType of ['新增', '扩建', '改造', '维修']) {
    assert.match(form.text, new RegExp(`<option value="${projectType}"[^>]*>${projectType}<\\/option>`));
  }
  assert.doesNotMatch(form.text, /Project Type\s*<input name="projectType"/);

  const detail = await agent.get('/opportunities/30');
  assert.equal(detail.status, 200);
  assertAppSidebar(detail.text, '/opportunities');
  assert.match(detail.text, /Factory upgrade/);
  assert.match(detail.text, /Upgrade production line/);
  assert.match(detail.text, /Alice/);
  const basicInfoHtml = detail.text.match(/<section class="content-section business-section business-section-basic">[\s\S]*?<\/section>/)?.[0] || '';
  assert.match(basicInfoHtml, /class="basic-info-grid"/);
  assert.equal((basicInfoHtml.match(/<table class="detail-table">/g) || []).length, 2);
  assert.match(basicInfoHtml, /<th scope="row">Status<\/th>\s*<td>Draft<\/td>/);
  assert.match(basicInfoHtml, /<th scope="row">Delivery Period<\/th>/);
  assert.doesNotMatch(basicInfoHtml, /<th scope="row">Delivery Cycle<\/th>/);
  assert.match(detail.text, /\.basic-info-grid\s*\{[\s\S]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/);
});

test('opportunity list supports active archived and all scopes', async () => {
  const filters = [];
  const { agent } = await createLoggedInAgent({
    opportunityRepository: {
      async listOpportunities(filter) {
        filters.push(filter);
        return [];
      }
    }
  });

  const defaultList = await agent.get('/opportunities');
  assert.equal(defaultList.status, 200);
  assert.equal(filters[0].archiveScope, 'active');
  assert.equal(filters[0].visibleToUserId, 7);
  assert.match(defaultList.text, /Current opportunities/);
  assert.match(defaultList.text, /No visible opportunities/);

  const archivedList = await agent.get('/opportunities?archiveScope=archived');
  assert.equal(archivedList.status, 200);
  assert.equal(filters[1].archiveScope, 'archived');
  assert.match(archivedList.text, /<option value="archived" selected>Archived opportunities<\/option>/);

  const allList = await agent.get('/opportunities?archiveScope=all');
  assert.equal(allList.status, 200);
  assert.equal(filters[2].archiveScope, 'all');
  assert.match(allList.text, /<option value="all" selected>All opportunities<\/option>/);
});

test('opportunity list and API combine sales owner customer contact and keyword filters', async () => {
  const filters = [];
  const optionFilters = [];
  const { agent } = await createLoggedInAgent({
    opportunityRepository: {
      async listOpportunities(filter) {
        filters.push(filter);
        return [];
      },
      async listOpportunityFilterOptions(filter) {
        optionFilters.push(filter);
        return {
          salespeople: [
            { id: 99, username: 'engineer01', displayName: 'Quotation Engineer' }
          ],
          customers: [
            { id: 10, name: 'Acme Co' },
            { id: 11, name: 'Beta Co' }
          ],
          contacts: [
            { id: 20, name: 'Alice', customerId: 10, customerName: 'Acme Co' },
            { id: 21, name: 'Bob', customerId: 11, customerName: 'Beta Co' }
          ]
        };
      }
    }
  });

  const list = await agent
    .get('/opportunities')
    .query({ archiveScope: 'all', salespersonId: '8', customerId: '11', contactId: '21', query: '  upgrade  ' });

  assert.equal(list.status, 200);
  assert.deepEqual(filters[0], {
    visibleToUserId: 7,
    archiveScope: 'all',
    salespersonId: 8,
    customerId: 11,
    contactId: 21,
    searchTerm: 'upgrade'
  });
  assert.deepEqual(optionFilters[0], { visibleToUserId: 7, archiveScope: 'all' });
  assert.match(list.text, /Sales owner\s*<select name="salespersonId">/);
  assert.match(list.text, /<option value="8" selected>Team Member<\/option>/);
  assert.doesNotMatch(list.text, /Quotation Engineer/);
  assert.match(list.text, /Customer\s*<select name="customerId">/);
  assert.match(list.text, /<option value="11" selected>Beta Co<\/option>/);
  assert.match(list.text, /Contact\s*<select name="contactId">/);
  assert.match(list.text, /<option value="21" selected>Bob \(Beta Co\)<\/option>/);
  assert.match(list.text, /name="query" type="search" value="upgrade"/);
  assert.match(list.text, />Search<\/button>/);
  assert.match(list.text, /href="\/opportunities\?archiveScope=all">Clear filters<\/a>/);

  const api = await agent
    .get('/api/opportunities')
    .query({ salespersonId: '8', customerId: '11', contactId: '21', query: 'upgrade' });

  assert.equal(api.status, 200);
  assert.deepEqual(filters[1], {
    visibleToUserId: 7,
    archiveScope: 'active',
    salespersonId: 8,
    customerId: 11,
    contactId: 21,
    searchTerm: 'upgrade'
  });
  assert.deepEqual(api.body, { opportunities: [] });
});

test('opportunity framework text and common actions use selected Chinese language', async () => {
  const { agent } = await createLoggedInAgent({ language: 'zh' });

  const list = await agent.get('/opportunities');
  assert.equal(list.status, 200);
  assert.match(list.text, /<h1>\u5546\u673a<\/h1>/);
  assert.match(list.text, /\u65b0\u5efa\u5546\u673a/);
  assert.match(list.text, /\u9500\u552e\u8d1f\u8d23\u4eba/);
  assert.match(list.text, />\u67e5\u8be2<\/button>/);
  assert.match(list.text, /<th>\u5546\u673a\u540d\u79f0<\/th>/);
  assert.match(list.text, /<span class="status">\u8349\u7a3f<\/span>/);

  const detail = await agent.get('/opportunities/30');
  assert.equal(detail.status, 200);
  assert.match(detail.text, /\u8fd4\u56de\u6e05\u5355/);
  assert.match(detail.text, />\u7f16\u8f91<\/a>/);
  assert.match(detail.text, />\u4e0a\u4f20<\/button>/);
  assert.match(detail.text, />\u9884\u89c8<\/a>/);
  assert.match(detail.text, />\u4e0b\u8f7d<\/a>/);
  assert.match(detail.text, /<td>\u8349\u7a3f<\/td>/);
  assert.match(detail.text, /\u8d23\u4efb\u4eba/);
  assert.match(detail.text, /\u534f\u540c\u4eba/);
  assert.match(detail.text, /\u8d1f\u8d23\u4eba\u8f6c\u79fb\u5386\u53f2/);
  assert.match(detail.text, /\u9700\u6c42\u8d44\u6599/);
  assert.match(detail.text, /\u6280\u672f\u65b9\u6848/);
  assert.match(detail.text, /\u5546\u52a1\u62a5\u4ef7/);
  assert.match(detail.text, /\u5546\u52a1\u5408\u540c/);
  assert.match(detail.text, /\u65f6\u95f4\u8f74/);
  assert.match(detail.text, /\u63d0\u4ea4\u5546\u673a\u7acb\u9879/);
  assert.match(detail.text, />\u63d0\u4ea4\u9500\u552e\u7ecf\u7406<\/button>/);
  assert.doesNotMatch(detail.text, /Submit to Sales Manager/);

  const form = await agent.get('/opportunities/new');
  assert.equal(form.status, 200);
  assert.match(form.text, /\u6dfb\u52a0\u65b0\u5ba2\u6237/);
  assert.match(form.text, /\u6dfb\u52a0\u65b0\u8054\u7cfb\u4eba/);
  assert.match(form.text, /\u9700\u6c42/);
  assert.match(form.text, /\u9884\u4f30\u91d1\u989d\s*<input name="estimatedAmount"/);
  assert.match(form.text, /\u5546\u673a\u7c7b\u578b\s*<select name="projectType"/);
  assert.match(form.text, /\u4ea4\u4ed8\u5468\u671f\s*<input name="deliveryCycle"/);
});

test('opportunity detail shows list and edit actions but hides delete from non administrators', async () => {
  const { agent } = await createLoggedInAgent();

  const detail = await agent.get('/opportunities/30');

  assert.equal(detail.status, 200);
  assert.match(detail.text, /Back to list/);
  assert.match(detail.text, /href="\/opportunities\/30\/edit"/);
  assert.match(detail.text, />Edit</);
  const headerHtml = detail.text.match(/<header class="page-header">[\s\S]*?<\/header>/)?.[0] || '';
  assert.doesNotMatch(headerHtml, /class="status"/);
  assert.match(detail.text, /<th scope="row">Status<\/th>\s*<td>Draft<\/td>/);
  assert.doesNotMatch(detail.text, /action="\/opportunities\/30\/delete"/);
});

test('active team member can view opportunity detail without edit access', async () => {
  const { agent } = await createLoggedInAgent({
    user: {
      id: 8,
      username: 'team01',
      displayName: 'Team Member',
      roles: [ROLES.SALESPERSON]
    },
    opportunityResponsibilityRepository: {
      async listTeamMembersByOpportunity(opportunityId) {
        return [{
          id: 41,
          opportunityId,
          userId: 8,
          username: 'team01',
          userDisplayName: 'Team Member',
          roleCode: ROLES.SALESPERSON,
          roleName: 'Salesperson',
          permissionLevel: 'view',
          isActive: true,
          addedBy: 7,
          addedByDisplayName: 'Sales One',
          addedAt: '2026-06-06T08:00:00.000Z',
          removedBy: null,
          removedByDisplayName: '',
          removedAt: null
        }];
      },
      async listOwnerTransfersByOpportunity() {
        return [];
      }
    }
  });

  const detail = await agent.get('/opportunities/30');

  assert.equal(detail.status, 200);
  assert.match(detail.text, /Team Member/);
  assert.doesNotMatch(detail.text, /href="\/opportunities\/30\/edit"/);
});

test('administrator sees opportunity delete action on detail page', async () => {
  const { agent } = await createLoggedInAgent({
    user: {
      id: 99,
      username: 'admin01',
      displayName: 'Admin User',
      roles: [ROLES.ADMINISTRATOR]
    }
  });

  const detail = await agent.get('/opportunities/30');

  assert.equal(detail.status, 200);
  assert.match(detail.text, /action="\/opportunities\/30\/delete"/);
  assert.match(detail.text, /onsubmit="return confirm\('Delete this opportunity and all uploaded files\?'\)"/);
  assert.match(detail.text, />Delete</);
});

test('salesperson edits opportunity fields from the detail action', async () => {
  const updates = [];
  const { agent } = await createLoggedInAgent({
    opportunityRepository: {
      async updateOpportunity(id, input) {
        updates.push({ id: Number(id), input });
        return opportunityDetail({ id: Number(id), ...input });
      }
    }
  });

  const editForm = await agent.get('/opportunities/30/edit');

  assert.equal(editForm.status, 200);
  assert.match(editForm.text, /Edit Opportunity/);
  assert.match(editForm.text, /value="Factory upgrade"/);
  assert.match(editForm.text, /<option value="automation" selected>automation<\/option>/);
  assert.match(editForm.text, /Save changes/);

  const response = await agent
    .post('/opportunities/30')
    .type('form')
    .send({
      customerId: '10',
      primaryContactId: '20',
      title: 'Factory upgrade revised',
      requirement: 'Upgrade production line and packing line',
      estimatedAmount: '180000',
      productInterest: 'Industrial mixer',
      projectType: 'automation',
      deliveryCycle: '60 days',
      expectedBidDate: '2026-08-01'
    });

  assert.equal(response.status, 302);
  assert.equal(response.headers.location, '/opportunities/30');
  assert.deepEqual(updates, [{
    id: 30,
    input: {
      title: 'Factory upgrade revised',
      customerId: 10,
      primaryContactId: 20,
      requirement: 'Upgrade production line and packing line',
      estimatedAmount: 180000,
      productInterest: 'Industrial mixer',
      projectType: 'automation',
      deliveryCycle: '60 days',
      expectedBidDate: '2026-08-01'
    }
  }]);
});

test('non administrators cannot delete opportunities directly', async () => {
  let deleteCalled = false;
  const { agent } = await createLoggedInAgent({
    opportunityRepository: {
      async deleteById() {
        deleteCalled = true;
      }
    }
  });

  const response = await agent.post('/opportunities/30/delete').type('form').send();

  assert.equal(response.status, 403);
  assert.equal(deleteCalled, false);
});

test('administrator deletes opportunity and removes stored attachment files', async () => {
  const uploadDir = await mkdtemp(path.join(os.tmpdir(), 'bestcrm-delete-opportunity-'));
  const storedPath = '2026/06/delete-me.txt';
  const absolutePath = path.join(uploadDir, storedPath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, 'delete this file');
  const deletedIds = [];
  try {
    const { agent } = await createLoggedInAgent({
      uploadDir,
      user: {
        id: 99,
        username: 'admin01',
        displayName: 'Admin User',
        roles: [ROLES.ADMINISTRATOR]
      },
      attachmentRepository: {
        async listByOpportunity() {
          return [{
            id: 55,
            opportunityId: 30,
            category: 'technical_solution',
            originalName: 'delete-me.txt',
            storedPath,
            mimeType: 'text/plain',
            fileSize: 16,
            uploadedBy: 7,
            uploaderDisplayName: 'Sales One',
            uploadedAt: '2026-06-05T12:00:00.000Z'
          }];
        },
        async createAttachment() {
          throw new Error('not used');
        },
        async deleteById() {
          throw new Error('not used');
        },
        async findById() {
          return null;
        }
      },
      opportunityRepository: {
        async deleteById(id) {
          deletedIds.push(Number(id));
          return { rowCount: 1 };
        }
      }
    });

    const response = await agent.post('/opportunities/30/delete').type('form').send();

    assert.equal(response.status, 302);
    assert.equal(response.headers.location, '/opportunities');
    assert.deepEqual(deletedIds, [30]);
    assert.equal(existsSync(absolutePath), false);
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
});

test('opportunity form quick creates customer and returns with it selected', async () => {
  const { agent, createdCustomers } = await createLoggedInAgent();

  const response = await agent
    .post('/opportunities/customers')
    .type('form')
    .send({
      name: 'New Account',
      website: 'new-account.example',
      industry: 'Manufacturing',
      country: 'China',
      region: 'Shanghai',
      address: 'No. 1 Road',
      notes: 'Created while initiating opportunity'
    });

  assert.equal(response.status, 302);
  assert.equal(response.headers.location, '/opportunities/new?customerId=11');
  assert.deepEqual(createdCustomers, [{
    name: 'New Account',
    website: 'https://new-account.example',
    industry: 'Manufacturing',
    country: 'China',
    region: 'Shanghai',
    parentCompany: '',
    enterpriseNature: '',
    companyHighlights: '',
    address: 'No. 1 Road',
    ownerUserId: 7,
    notes: 'Created while initiating opportunity'
  }]);
});

test('opportunity form quick customer creation shows duplicate owner coordination warning', async () => {
  let createCalled = false;
  const { agent } = await createLoggedInAgent({
    customerRepository: {
      async listCustomers() {
        return [{ id: 10, name: 'Acme Co', ownerUserId: 7 }];
      },
      async findDuplicatesByName() {
        return [{
          id: 12,
          name: 'New Account',
          ownerUserId: 8,
          ownerDisplayName: 'Other Sales',
          ownerUsername: 'other01',
          contactCount: 1
        }];
      },
      async createCustomer() {
        createCalled = true;
        throw new Error('should not create duplicate customer');
      }
    }
  });

  const response = await agent
    .post('/opportunities/customers')
    .type('form')
    .send({
      name: 'New Account',
      website: 'new-account.example',
      industry: 'Manufacturing',
      country: 'China',
      region: 'Shanghai',
      address: 'No. 1 Road',
      notes: 'Created while initiating opportunity'
    });

  assert.equal(response.status, 409);
  assert.match(response.text, /<details class="inline-create-panel" open>/);
  assert.match(response.text, /Duplicate customer found/);
  assert.match(response.text, /Other Sales/);
  assert.match(response.text, /value="New Account"/);
  assert.equal(createCalled, false);
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
    educationBackground: '',
    workExperience: '',
    keyAchievements: '',
    notes: 'Primary buyer'
  }]);
});

test('opportunity detail keeps workflow todos out of the detail page and shows timeline', async () => {
  const { agent } = await createLoggedInAgent();

  const detail = await agent.get('/opportunities/30');

  assert.equal(detail.status, 200);
  assert.doesNotMatch(detail.text, /Pending Todos/);
  assert.doesNotMatch(detail.text, /Approve opportunity initiation/);
  assert.match(detail.text, /Timeline/);
  assert.match(detail.text, /Opportunity initiation submitted/);
  assert.match(detail.text, /Draft/);
  assert.match(detail.text, /Initiation pending/);
  assert.match(detail.text, /Sales Manager/);
  assert.match(detail.text, /ready for review/);
});

test('opportunity detail shows owner team members and transfer history without current responsible todos', async () => {
  const responsibilityCalls = [];
  const { agent } = await createLoggedInAgent({
    opportunityResponsibilityRepository: {
      async listTeamMembersByOpportunity(opportunityId) {
        responsibilityCalls.push(['members', opportunityId]);
        return [{
          id: 41,
          opportunityId,
          userId: 8,
          username: 'quote01',
          userDisplayName: 'Quote Engineer',
          roleCode: 'quotation_engineer',
          roleName: 'Quotation Engineer',
          permissionLevel: 'view',
          isActive: true,
          addedBy: 2,
          addedByDisplayName: 'Sales Manager',
          addedAt: '2026-06-06T08:00:00.000Z',
          removedBy: null,
          removedByDisplayName: '',
          removedAt: null
        }];
      },
      async listOwnerTransfersByOpportunity(opportunityId) {
        responsibilityCalls.push(['transfers', opportunityId]);
        return [{
          id: 51,
          opportunityId,
          fromOwnerUserId: 6,
          fromOwnerDisplayName: 'Old Sales',
          toOwnerUserId: 7,
          toOwnerDisplayName: 'Sales One',
          changedBy: 2,
          changedByDisplayName: 'Sales Manager',
          reason: 'Territory realignment',
          keepPreviousOwnerAsMember: true,
          transferredAt: '2026-06-06T09:00:00.000Z'
        }];
      }
    }
  });

  const detail = await agent.get('/opportunities/30');

  assert.equal(detail.status, 200);
  assert.match(detail.text, /<th scope="row">Owner<\/th>[\s\S]*Sales One/);
  assert.match(detail.text, /Responsibility/);
  assert.match(detail.text, /class="responsibility-grid"/);
  assert.equal((detail.text.match(/class="responsibility-column"/g) || []).length, 2);
  assert.match(detail.text, /\.responsibility-grid\s*\{[\s\S]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\);/);
  assert.match(detail.text, /\.responsibility-grid\s*\{[\s\S]*gap:\s*8px;/);
  assert.match(detail.text, /\.responsibility-content\s*\{[\s\S]*padding:\s*6px 8px;/);
  assert.match(detail.text, /\.responsibility-content \.list-table th,\s*\.responsibility-content \.list-table td\s*\{[\s\S]*padding:\s*5px 6px;/);
  assert.doesNotMatch(detail.text, /Current Responsible/);
  assert.doesNotMatch(detail.text, /Technical Manager/);
  assert.doesNotMatch(detail.text, /Approve technical solution/);
  assert.match(detail.text, /Team Members/);
  assert.match(detail.text, /Quote Engineer/);
  assert.match(detail.text, /Quotation Engineer/);
  assert.match(detail.text, /Owner Transfer History/);
  assert.match(detail.text, /Old Sales/);
  assert.match(detail.text, /Territory realignment/);
  assert.deepEqual(responsibilityCalls, [
    ['members', 30],
    ['transfers', 30]
  ]);
});

test('administrator sees responsibility management forms on opportunity detail', async () => {
  const { agent } = await createLoggedInAgent({
    user: {
      id: 99,
      username: 'admin01',
      displayName: 'Admin User',
      roles: [ROLES.ADMINISTRATOR]
    }
  });

  const detail = await agent.get('/opportunities/30');

  assert.equal(detail.status, 200);
  assert.match(detail.text, /<details class="responsibility-disclosure">[\s\S]*<summary>Add Team Member<\/summary>/);
  assert.match(detail.text, /Add Team Member/);
  assert.match(detail.text, /name="userId"/);
  assert.match(detail.text, /name="roleCode"/);
  assert.match(detail.text, /<details class="responsibility-disclosure">[\s\S]*<summary>Transfer Owner<\/summary>/);
  assert.match(detail.text, /Transfer Owner/);
  assert.match(detail.text, /name="toOwnerUserId"/);
  assert.match(detail.text, /name="keepPreviousOwnerAsMember"/);
});

test('team member form carries user roles for linked role selection', async () => {
  const { agent } = await createLoggedInAgent({
    user: {
      id: 99,
      username: 'admin01',
      displayName: 'Admin User',
      roles: [ROLES.ADMINISTRATOR]
    }
  });

  const detail = await agent.get('/opportunities/30');

  assert.equal(detail.status, 200);
  assert.match(detail.text, /data-team-member-form/);
  assert.match(detail.text, /<option value="8" data-role-codes="salesperson">Team Member \(team01\)<\/option>/);
  assert.match(detail.text, /<option value="2" data-role-codes="sales_manager">Sales Manager \(manager01\)<\/option>/);
  assert.match(detail.text, /<option value="salesperson" data-role-code="salesperson">Sales<\/option>/);
  assert.match(detail.text, /function syncTeamMemberRoleOptions/);
});

test('administrator adds and removes opportunity team members', async () => {
  const addedMembers = [];
  const removedMembers = [];
  const { agent } = await createLoggedInAgent({
    user: {
      id: 99,
      username: 'admin01',
      displayName: 'Admin User',
      roles: [ROLES.ADMINISTRATOR]
    },
    opportunityResponsibilityRepository: {
      async listTeamMembersByOpportunity() {
        return [];
      },
      async listOwnerTransfersByOpportunity() {
        return [];
      },
      async addTeamMember(input) {
        addedMembers.push(input);
        return { id: 41, ...input };
      },
      async removeTeamMember(input) {
        removedMembers.push(input);
        return { id: input.memberId };
      }
    }
  });

  const addResponse = await agent
    .post('/opportunities/30/team-members')
    .type('form')
    .send({
      userId: 8,
      roleCode: ROLES.SALESPERSON,
      permissionLevel: 'view'
    });

  assert.equal(addResponse.status, 302);
  assert.deepEqual(addedMembers, [{
    opportunityId: 30,
    userId: 8,
    roleCode: ROLES.SALESPERSON,
    permissionLevel: 'view',
    addedBy: 99
  }]);

  const removeResponse = await agent
    .post('/opportunities/30/team-members/41/remove')
    .type('form')
    .send();

  assert.equal(removeResponse.status, 302);
  assert.deepEqual(removedMembers, [{
    opportunityId: 30,
    memberId: 41,
    removedBy: 99
  }]);
});

test('Sales Manager transfers opportunity owner and can keep previous owner as team member', async () => {
  const transfers = [];
  const { agent } = await createLoggedInAgent({
    user: {
      id: 2,
      username: 'manager01',
      displayName: 'Sales Manager',
      roles: [ROLES.SALES_MANAGER]
    },
    opportunityRepository: {
      async getOpportunityDetail() {
        return opportunityDetail({
          salespersonId: 7,
          salesManagerId: 2
        });
      }
    },
    opportunityResponsibilityRepository: {
      async listTeamMembersByOpportunity() {
        return [];
      },
      async listOwnerTransfersByOpportunity() {
        return [];
      },
      async transferOwner(input) {
        transfers.push(input);
        return { id: 51, ...input };
      }
    }
  });

  const response = await agent
    .post('/opportunities/30/owner-transfer')
    .type('form')
    .send({
      toOwnerUserId: 8,
      reason: 'Territory realignment',
      keepPreviousOwnerAsMember: 'on'
    });

  assert.equal(response.status, 302);
  assert.deepEqual(transfers, [{
    opportunityId: 30,
    fromOwnerUserId: 7,
    toOwnerUserId: 8,
    changedBy: 2,
    reason: 'Territory realignment',
    keepPreviousOwnerAsMember: true
  }]);
});

test('non managers cannot manage opportunity responsibility directly', async () => {
  let addCalled = false;
  const { agent } = await createLoggedInAgent({
    opportunityResponsibilityRepository: {
      async listTeamMembersByOpportunity() {
        return [];
      },
      async listOwnerTransfersByOpportunity() {
        return [];
      },
      async addTeamMember() {
        addCalled = true;
      }
    }
  });

  const response = await agent
    .post('/opportunities/30/team-members')
    .type('form')
    .send({
      userId: 8,
      roleCode: ROLES.SALESPERSON,
      permissionLevel: 'view'
    });

  assert.equal(response.status, 403);
  assert.equal(addCalled, false);
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
  assert.match(detail.text, /name="requirementText"[\s\S]*type="hidden" name="reason"[\s\S]*name="attachment"[\s\S]*Initial Requirement[\s\S]*Upgrade production line/);
  assert.doesNotMatch(detail.text, /Reason \/ Source/);
  assert.match(detail.text, /technical-solution\.pdf/);
  assert.match(detail.text, /\/opportunities\/30\/attachments\/55\/download/);
  assert.match(detail.text, /\/opportunities\/30\/attachments\/55\/preview/);
  assert.doesNotMatch(detail.text, /<th>Category<\/th>/);
  assert.doesNotMatch(detail.text, /<th>Uploaded By<\/th>/);
});

test('opportunity detail shows technical solution text and files in one timeline with local submit action', async () => {
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
    attachments: [{
      id: 55,
      opportunityId: 30,
      category: 'technical_solution',
      originalName: 'technical-solution.pdf',
      storedPath: '2026/06/technical-solution.pdf',
      mimeType: 'application/pdf',
      fileSize: 1024,
      uploadedBy: 3,
      uploaderDisplayName: 'Quote Engineer',
      uploadedAt: '2026-06-05T12:00:00.000Z'
    }],
    technicalSolutions: [{
      id: 71,
      opportunityId: 30,
      versionNo: 1,
      summary: '1. Use skid-mounted evaporation package.\n2. Reserve PLC interface.',
      parameters: null,
      implementationPlan: null,
      status: 'pending',
      submittedBy: 3,
      submitterDisplayName: 'Quote Engineer',
      submittedAt: '2026-06-05T11:30:00.000Z',
      reviewedBy: null,
      reviewerDisplayName: '',
      reviewedAt: null,
      reviewComment: null
    }]
  });

  const detail = await agent.get('/opportunities/30');

  assert.equal(detail.status, 200);
  const technicalSection = detail.text.match(/<h2>Technical Solution<\/h2>[\s\S]*?<h2>Commercial Quote<\/h2>/)[0];
  assert.match(technicalSection, /name="solutionSummary"[\s\S]*Submit to Technical Manager[\s\S]*technical-solution\.pdf/);
  assert.match(technicalSection, /2026-06-05 19:30[\s\S]*1\. Use skid-mounted evaporation package\.[\s\S]*2\. Reserve PLC interface\./);
  assert.match(detail.text, /\.requirement-row-content\s*\{[\s\S]*white-space:\s*pre-wrap;/);
  assert.match(technicalSection, /2026-06-05 20:00[\s\S]*technical-solution\.pdf[\s\S]*Preview[\s\S]*Download[\s\S]*Delete/);
  assert.match(technicalSection, /Delete this technical solution file\?/);
  assert.doesNotMatch(technicalSection, /<th>File<\/th>/);
  assert.doesNotMatch(technicalSection, /<th>Uploaded At<\/th>/);
  assert.doesNotMatch(technicalSection, /Version History/);
  assert.doesNotMatch(detail.text, /Workflow Actions[\s\S]*Submit Technical Solution/);
});

test('submitted technical solution files cannot be deleted from the detail page or route', async () => {
  const uploadDir = await mkdtemp(path.join(os.tmpdir(), 'bestcrm-technical-delete-'));
  try {
    await writeFile(path.join(uploadDir, 'technical.txt'), 'technical file', 'utf8');
    let deleteCalled = false;
    const attachment = {
      id: 55,
      opportunityId: 30,
      category: 'technical_solution',
      originalName: 'technical.txt',
      storedPath: 'technical.txt',
      mimeType: 'text/plain',
      fileSize: 14,
      uploadedBy: 3,
      uploaderDisplayName: 'Quote Engineer',
      uploadedAt: '2026-06-05T12:00:00.000Z'
    };
    const { agent } = await createLoggedInAgent({
      uploadDir,
      user: {
        id: 3,
        username: 'quote01',
        displayName: 'Quote Engineer',
        roles: [ROLES.QUOTATION_ENGINEER]
      },
      opportunityRepository: {
        async getOpportunityDetail() {
          return opportunityDetail({
            status: STATUSES.TECHNICAL_SOLUTION_PENDING,
            quotationEngineerId: 3
          });
        },
        async listOpportunities() {
          return [];
        }
      },
      attachmentRepository: {
        async listByOpportunity() {
          return [attachment];
        },
        async findById() {
          return attachment;
        },
        async deleteById() {
          deleteCalled = true;
        }
      }
    });

    const detail = await agent.get('/opportunities/30');
    const technicalSection = detail.text.match(/<h2>Technical Solution<\/h2>[\s\S]*?<h2>Commercial Quote<\/h2>/)[0];
    assert.doesNotMatch(technicalSection, /Delete/);

    const response = await agent.post('/opportunities/30/attachments/55/delete');
    assert.equal(response.status, 403);
    assert.equal(deleteCalled, false);
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
});

test('opportunity detail renders attachments with date object timestamps', async () => {
  const { agent } = await createLoggedInAgent({
    attachmentRepository: {
      async listByOpportunity() {
        return [
          {
            id: 55,
            opportunityId: 30,
            category: 'technical_solution',
            originalName: 'technical-solution.pdf',
            storedPath: '2026/06/technical-solution.pdf',
            mimeType: 'application/pdf',
            fileSize: 1024,
            uploadedBy: 7,
            uploaderDisplayName: 'Sales One',
            uploadedAt: new Date('2026-06-05T12:00:00.000Z')
          },
          {
            id: 56,
            opportunityId: 30,
            category: 'technical_solution',
            originalName: 'technical-addendum.pdf',
            storedPath: '2026/06/technical-addendum.pdf',
            mimeType: 'application/pdf',
            fileSize: 1024,
            uploadedBy: 7,
            uploaderDisplayName: 'Sales One',
            uploadedAt: new Date('2026-06-05T13:00:00.000Z')
          }
        ];
      }
    }
  });

  const detail = await agent.get('/opportunities/30');

  assert.equal(detail.status, 200);
  assert.match(detail.text, /technical-solution\.pdf/);
  assert.match(detail.text, /technical-addendum\.pdf/);
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
  assert.match(detail.text, /requirement-row requirement-row-file[\s\S]*2026-06-05 \d{2}:00[\s\S]*requirement-spec\.pdf[\s\S]*Preview[\s\S]*Download/);
  assert.match(detail.text, /class="requirement-action-download"[^>]*href="\/opportunities\/30\/attachments\/51\/download"/);
  assert.doesNotMatch(detail.text, /class="requirement-action-download"[^>]*download=/);
  assert.doesNotMatch(detail.text, /class="requirement-action-download"[^>]*target="_blank"/);
  assert.match(detail.text, /Commercial Quote[\s\S]*quote-v1\.xlsx/);
  assert.match(detail.text, /Commercial Contract[\s\S]*contract-draft\.docx/);
});

test('opportunity detail shows technical solution submission and review comments in timeline', async () => {
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
  const technicalSection = detail.text.match(/<h2>Technical Solution<\/h2>[\s\S]*?<h2>Commercial Quote<\/h2>/)[0];
  assert.doesNotMatch(technicalSection, /Version History/);
  assert.doesNotMatch(technicalSection, /V2/);
  assert.match(technicalSection, /Updated cabinet control solution/);
  assert.match(technicalSection, /approved/);
  assert.doesNotMatch(technicalSection, /IP65, stainless cabinet/);
  assert.doesNotMatch(technicalSection, /Revise drawings and wiring plan/);
});

test('opportunity detail shows compact material approval versions by business section', async () => {
  const { agent } = await createLoggedInAgent({
    opportunityMaterialVersionRepository: {
      async listByOpportunity() {
        return [
          {
            id: 101,
            opportunityId: 30,
            materialType: 'technical_solution',
            versionNo: 1,
            status: 'approved',
            submittedBy: 3,
            submitterDisplayName: 'Quote Engineer',
            submittedAt: '2026-06-05T11:30:00.000Z',
            reviewedBy: 4,
            reviewerDisplayName: 'Technical Manager',
            reviewedAt: '2026-06-05T12:00:00.000Z',
            reviewComment: 'approved'
          },
          {
            id: 102,
            opportunityId: 30,
            materialType: 'commercial_quote',
            versionNo: 2,
            status: 'pending',
            submittedBy: 3,
            submitterDisplayName: 'Quote Engineer',
            submittedAt: '2026-06-06T09:00:00.000Z',
            reviewedBy: null,
            reviewerDisplayName: '',
            reviewedAt: null,
            reviewComment: null
          },
          {
            id: 103,
            opportunityId: 30,
            materialType: 'contract',
            versionNo: 1,
            status: 'rejected',
            submittedBy: 7,
            submitterDisplayName: 'Sales One',
            submittedAt: '2026-06-07T09:00:00.000Z',
            reviewedBy: 6,
            reviewerDisplayName: 'Legal One',
            reviewedAt: '2026-06-07T10:00:00.000Z',
            reviewComment: 'missing clause'
          }
        ];
      }
    }
  });

  const detail = await agent.get('/opportunities/30');

  assert.equal(detail.status, 200);
  const technicalSection = detail.text.match(/<h2>Technical Solution<\/h2>[\s\S]*?<h2>Commercial Quote<\/h2>/)[0];
  const quoteSection = detail.text.match(/<h2>Commercial Quote<\/h2>[\s\S]*?<h2>Commercial Contract<\/h2>/)[0];
  const contractSection = detail.text.match(/<h2>Commercial Contract<\/h2>[\s\S]*?<h2>Timeline<\/h2>/)[0];
  assert.match(technicalSection, /material-version-strip[\s\S]*V1[\s\S]*approved[\s\S]*Quote Engineer[\s\S]*Technical Manager/);
  assert.match(quoteSection, /material-version-strip[\s\S]*V2[\s\S]*pending[\s\S]*Quote Engineer/);
  assert.match(contractSection, /material-version-strip[\s\S]*V1[\s\S]*rejected[\s\S]*Sales One[\s\S]*Legal One[\s\S]*missing clause/);
  assert.doesNotMatch(detail.text, /Version History/);
});

test('opportunity detail hides commercial quote version history because quote rows are dated', async () => {
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
  const quoteSection = detail.text.match(/<h2>Commercial Quote<\/h2>[\s\S]*?<h2>Commercial Contract<\/h2>/)[0];
  assert.doesNotMatch(quoteSection, /Version History/);
  assert.doesNotMatch(quoteSection, /V2/);
  assert.doesNotMatch(quoteSection, /Quote Engineer/);
  assert.doesNotMatch(quoteSection, /Commercial Manager/);
  assert.doesNotMatch(quoteSection, /Total Price|Payment Terms|Items|2100|Control cabinet|PLC control set/);
});

test('opportunity detail hides contract approval version history because contract rows are dated', async () => {
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
  const contractSection = detail.text.match(/<h2>Commercial Contract<\/h2>[\s\S]*?<h2>Timeline<\/h2>/)[0];
  assert.doesNotMatch(contractSection, /Contract Approvals|Version History/);
  assert.doesNotMatch(contractSection, /V2|Legal One|missing clause/);
});

test('opportunity detail shows upload forms in each business material panel', async () => {
  const { agent } = await createLoggedInAgent({
    user: { roles: [ROLES.ADMINISTRATOR] }
  });

  const detail = await agent.get('/opportunities/30');

  assert.equal(detail.status, 200);
  assert.equal((detail.text.match(/action="\/opportunities\/30\/attachments"/g) || []).length, 4);
  assert.equal((detail.text.match(/class="form-panel attachment-upload-panel"/g) || []).length, 4);
  assert.equal((detail.text.match(/<input type="file" name="attachment" required>/g) || []).length, 4);
  assert.match(detail.text, /\.attachment-upload-panel\s*\{[\s\S]*max-width:\s*none;/);
  assert.match(detail.text, /\.attachment-upload-panel\s*\{[\s\S]*display:\s*flex;/);
  assert.match(detail.text, /\.attachment-upload-panel\s*\{[\s\S]*align-items:\s*center;/);
  assert.match(detail.text, /\.attachment-upload-panel\s*\{[\s\S]*width:\s*100%;/);
  assert.match(detail.text, /\.attachment-upload-panel\s*\{[\s\S]*background:\s*rgba\(255,\s*255,\s*255,\s*0\.35\);/);
  assert.match(detail.text, /\.attachment-upload-panel button\s*\{[\s\S]*width:\s*96px;/);
  assert.match(detail.text, /\.attachment-upload-panel button\s*\{[\s\S]*text-align:\s*center;/);
  assert.match(detail.text, /\.attachment-upload-panel button\s*\{[\s\S]*white-space:\s*nowrap;/);
  assert.match(detail.text, /\.attachment-upload-panel button\s*\{[\s\S]*letter-spacing:\s*0px;/);
  assert.match(detail.text, /\.attachment-upload-panel button\s*\{[\s\S]*background:\s*#dbeafe;/);
  assert.match(detail.text, /\.attachment-upload-panel button\s*\{[\s\S]*color:\s*#0B0F6E;/);
  assert.equal((detail.text.match(/<button type="submit">Upload<\/button>/g) || []).length, 4);
  assert.doesNotMatch(detail.text, />\s*File\s*<input type="file" name="attachment" required>/);
  assert.doesNotMatch(detail.text, /Upload attachment|Upload technical solution|Upload commercial quote|Upload contract/);
  const requirementSection = detail.text.match(/<h2>Requirement Materials<\/h2>[\s\S]*?<h2>Technical Solution<\/h2>/)[0];
  assert.match(requirementSection, /name="category" value="requirement"/);
  assert.doesNotMatch(requirementSection, /<select name="category"/);
  assert.match(detail.text, /Technical Solution[\s\S]*name="category" value="technical_solution"/);
  assert.match(detail.text, /Commercial Quote[\s\S]*name="category" value="commercial_quote"/);
  assert.match(detail.text, /Commercial Contract[\s\S]*name="category" value="contract"/);
});

test('opportunity detail hides technical upload from users without category permission', async () => {
  const { agent } = await createLoggedInAgent();

  const detail = await agent.get('/opportunities/30');

  assert.equal(detail.status, 200);
  assert.match(detail.text, /Requirement Materials[\s\S]*name="category" value="requirement"/);
  assert.doesNotMatch(detail.text, /Technical Solution[\s\S]*name="category" value="technical_solution"/);
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
  assert.match(detail.text, /Technical Solution Description/);
  assert.match(detail.text, /Submit to Technical Manager/);
  assert.match(detail.text, /name="solutionSummary"/);
  assert.doesNotMatch(detail.text, /name="solutionParameters"/);
  assert.doesNotMatch(detail.text, /name="implementationPlan"/);
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
  assert.match(detail.text, /Requirement Materials[\s\S]*Initial Requirement[\s\S]*Upgrade production line/);
  assert.match(detail.text, /name="requirementText"/);
  assert.match(detail.text, /type="hidden" name="reason"/);
  assert.doesNotMatch(detail.text, /Reason \/ Source/);
  assert.doesNotMatch(detail.text, /Supplemental Requirements/);
  assert.match(detail.text, /requirement-row requirement-row-text[\s\S]*2026-06-06 \d{2}:00[\s\S]*Add corrosion proof cabinet requirement/);
  assert.doesNotMatch(detail.text, /Customer site has salt fog environment/);
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

test('draft opportunity creates supplemental requirement without workflow rework', async () => {
  const { agent, requirementUpdates, workflowEvents, todoClosures, todosToCreate, workflowUpdates } = await createLoggedInAgent();

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
  assert.deepEqual(workflowEvents, []);
  assert.deepEqual(todoClosures, []);
  assert.deepEqual(todosToCreate, []);
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
  assert.match(detail.text, /onsubmit="return confirm\('Delete this requirement file\?'\)"/);
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

test('commercial quote in progress shows quote attachments as dated rows with delete action', async () => {
  const attachment = {
    id: 55,
    opportunityId: 30,
    category: 'commercial_quote',
    originalName: 'quote-v1.xlsx',
    storedPath: '2026/06/quote-v1.xlsx',
    mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    fileSize: 2048,
    uploadedBy: 3,
    uploaderDisplayName: 'Quote Engineer',
    uploadedAt: '2026-06-05T11:00:00.000Z'
  };
  const { agent } = await createLoggedInAgent({
    opportunityRepository: {
      async getOpportunityDetail() {
        return opportunityDetail({ status: STATUSES.COMMERCIAL_QUOTE_IN_PROGRESS });
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
        throw new Error('not used');
      },
      async findById() {
        return attachment;
      }
    }
  });

  const detail = await agent.get('/opportunities/30');

  assert.equal(detail.status, 200);
  const quoteSection = detail.text.match(/<h2>Commercial Quote<\/h2>[\s\S]*?<h2>Commercial Contract<\/h2>/)[0];
  assert.match(quoteSection, /requirement-row requirement-row-file[\s\S]*2026-06-05 \d{2}:00[\s\S]*quote-v1\.xlsx[\s\S]*Preview[\s\S]*Download[\s\S]*Delete/);
  assert.match(quoteSection, /class="requirement-action-download"[^>]*href="\/opportunities\/30\/attachments\/55\/download"/);
  assert.doesNotMatch(quoteSection, /class="requirement-action-download"[^>]*download=/);
  assert.doesNotMatch(quoteSection, /class="requirement-action-download"[^>]*target="_blank"/);
  assert.match(quoteSection, /onsubmit="return confirm\('Delete this commercial quote file\?'\)"/);
});

test('commercial quote in progress deletes quote attachment metadata and stored file', async () => {
  const uploadDir = await mkdtemp(path.join(os.tmpdir(), 'bestcrm-delete-commercial-quote-'));
  try {
    await writeFile(path.join(uploadDir, 'quote.txt'), 'quote file', 'utf8');
    const deletedIds = [];
    const attachment = {
      id: 55,
      opportunityId: 30,
      category: 'commercial_quote',
      originalName: 'quote.txt',
      storedPath: 'quote.txt',
      mimeType: 'text/plain',
      fileSize: 10,
      uploadedBy: 3,
      uploaderDisplayName: 'Quote Engineer',
      uploadedAt: '2026-06-05T11:00:00.000Z'
    };
    const { agent } = await createLoggedInAgent({
      uploadDir,
      opportunityRepository: {
        async getOpportunityDetail() {
          return opportunityDetail({ status: STATUSES.COMMERCIAL_QUOTE_IN_PROGRESS });
        }
      },
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
    assert.equal(existsSync(path.join(uploadDir, 'quote.txt')), false);
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
});

test('approved commercial quote hides and blocks quote attachment deletion', async () => {
  const uploadDir = await mkdtemp(path.join(os.tmpdir(), 'bestcrm-delete-approved-quote-'));
  try {
    await writeFile(path.join(uploadDir, 'quote.txt'), 'approved quote', 'utf8');
    let deleteCalled = false;
    const attachment = {
      id: 55,
      opportunityId: 30,
      category: 'commercial_quote',
      originalName: 'quote.txt',
      storedPath: 'quote.txt',
      mimeType: 'text/plain',
      fileSize: 14,
      uploadedBy: 3,
      uploaderDisplayName: 'Quote Engineer',
      uploadedAt: '2026-06-05T11:00:00.000Z'
    };
    const { agent } = await createLoggedInAgent({
      uploadDir,
      opportunityRepository: {
        async getOpportunityDetail() {
          return opportunityDetail({ status: STATUSES.CUSTOMER_NEGOTIATION });
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
          throw new Error('should not delete approved commercial quote attachment');
        },
        async findById() {
          return attachment;
        }
      }
    });

    const detail = await agent.get('/opportunities/30');

    assert.equal(detail.status, 200);
    const quoteSection = detail.text.match(/<h2>Commercial Quote<\/h2>[\s\S]*?<h2>Commercial Contract<\/h2>/)[0];
    assert.doesNotMatch(quoteSection, /\/opportunities\/30\/attachments\/55\/delete/);

    const response = await agent.post('/opportunities/30/attachments/55/delete').type('form').send();

    assert.equal(response.status, 403);
    assert.equal(deleteCalled, false);
    assert.equal(existsSync(path.join(uploadDir, 'quote.txt')), true);
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
});

test('customer negotiation with contract attachment shows contract submit and delete actions', async () => {
  const attachment = {
    id: 57,
    opportunityId: 30,
    category: 'contract',
    originalName: 'contract-v1.docx',
    storedPath: '2026/06/contract-v1.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    fileSize: 2048,
    uploadedBy: 7,
    uploaderDisplayName: 'Sales One',
    uploadedAt: '2026-06-05T13:00:00.000Z'
  };
  const { agent } = await createWorkflowAgent({
    user: {
      id: 7,
      username: 'sales01',
      displayName: 'Sales One',
      roles: [ROLES.SALESPERSON]
    },
    opportunity: {
      status: STATUSES.CUSTOMER_NEGOTIATION,
      salespersonId: 7
    },
    attachments: [attachment]
  });

  const detail = await agent.get('/opportunities/30');

  assert.equal(detail.status, 200);
  const contractSection = detail.text.match(/<h2>Commercial Contract<\/h2>[\s\S]*?<h2>Timeline<\/h2>/)[0];
  assert.match(contractSection, /<button type="submit">Upload<\/button>[\s\S]*submit_contract_approval/);
  assert.doesNotMatch(detail.text, /Workflow Actions[\s\S]*submit_contract_approval/);
  assert.match(contractSection, /requirement-row requirement-row-file[\s\S]*2026-06-05 \d{2}:00[\s\S]*contract-v1\.docx[\s\S]*Preview[\s\S]*Download[\s\S]*Delete/);
  assert.match(contractSection, /class="requirement-action-download"[^>]*href="\/opportunities\/30\/attachments\/57\/download"/);
  assert.doesNotMatch(contractSection, /class="requirement-action-download"[^>]*download=/);
  assert.doesNotMatch(contractSection, /class="requirement-action-download"[^>]*target="_blank"/);
  assert.match(contractSection, /onsubmit="return confirm\('Delete this contract file\?'\)"/);
  assert.doesNotMatch(contractSection, /Contract Approvals|Version History/);
});

test('contract attachment before negotiation shows disabled submit guidance', async () => {
  const attachment = {
    id: 57,
    opportunityId: 30,
    category: 'contract',
    originalName: 'contract-v1.docx',
    storedPath: '2026/06/contract-v1.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    fileSize: 2048,
    uploadedBy: 7,
    uploaderDisplayName: 'Sales One',
    uploadedAt: '2026-06-05T13:00:00.000Z'
  };
  const { agent } = await createWorkflowAgent({
    user: {
      id: 7,
      username: 'sales01',
      displayName: 'Sales One',
      roles: [ROLES.SALESPERSON]
    },
    opportunity: {
      status: STATUSES.TECHNICAL_SOLUTION_IN_PROGRESS,
      salespersonId: 7
    },
    attachments: [attachment]
  });

  const detail = await agent.get('/opportunities/30');

  assert.equal(detail.status, 200);
  const contractSection = detail.text.match(/<h2>Commercial Contract<\/h2>[\s\S]*?<h2>Timeline<\/h2>/)[0];
  assert.match(contractSection, /Finish the technical solution and commercial quote approval before submitting contract approval/);
  assert.match(contractSection, /<button type="button" disabled>Submit Contract Approval<\/button>/);
  assert.doesNotMatch(contractSection, /<input type="hidden" name="action" value="submit_contract_approval">/);
});

test('rejected contract requires a revised attachment before resubmission', async () => {
  const rejectedAt = '2026-06-05T13:30:00.000Z';
  const oldAttachment = {
    id: 57,
    opportunityId: 30,
    category: 'contract',
    originalName: 'contract-v1.docx',
    storedPath: '2026/06/contract-v1.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    fileSize: 2048,
    uploadedBy: 7,
    uploaderDisplayName: 'Sales One',
    uploadedAt: '2026-06-05T13:00:00.000Z'
  };
  const contractApprovals = [{
    id: 91,
    opportunityId: 30,
    status: 'rejected',
    completedAt: rejectedAt,
    actedAt: rejectedAt,
    reviewerUserId: 6,
    stepAction: 'rejected'
  }];
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
    attachments: [oldAttachment],
    contractApprovals
  });

  const detail = await agent.get('/opportunities/30');

  assert.equal(detail.status, 200);
  const contractSection = detail.text.match(/<h2>Commercial Contract<\/h2>[\s\S]*?<h2>Timeline<\/h2>/)[0];
  assert.match(contractSection, /Revised Contract attachment is required after rejection/);
  assert.match(contractSection, /<button type="submit" disabled>Submit Contract Approval<\/button>/);
});

test('rejected contract history requires a revised attachment even after returning to won pending', async () => {
  const rejectedAt = '2026-06-05T13:30:00.000Z';
  const oldAttachment = {
    id: 57,
    opportunityId: 30,
    category: 'contract',
    originalName: 'contract-v1.docx',
    storedPath: '2026/06/contract-v1.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    fileSize: 2048,
    uploadedBy: 7,
    uploaderDisplayName: 'Sales One',
    uploadedAt: '2026-06-05T13:00:00.000Z'
  };
  const contractApprovals = [{
    id: 91,
    opportunityId: 30,
    status: 'rejected',
    completedAt: rejectedAt,
    actedAt: rejectedAt,
    reviewerUserId: 6,
    stepAction: 'rejected'
  }];
  const { agent } = await createWorkflowAgent({
    user: {
      id: 7,
      username: 'sales01',
      displayName: 'Sales One',
      roles: [ROLES.SALESPERSON]
    },
    opportunity: {
      status: STATUSES.WON_CONTRACT_PENDING,
      salespersonId: 7
    },
    attachments: [oldAttachment],
    contractApprovals
  });

  const detail = await agent.get('/opportunities/30');

  assert.equal(detail.status, 200);
  const contractSection = detail.text.match(/<h2>Commercial Contract<\/h2>[\s\S]*?<h2>Timeline<\/h2>/)[0];
  assert.match(contractSection, /Revised Contract attachment is required after rejection/);
  assert.match(contractSection, /<button type="submit" disabled>Submit Contract Approval<\/button>/);
});

test('rejected contract with revised attachment shows contract resubmission action', async () => {
  const rejectedAt = '2026-06-05T13:30:00.000Z';
  const revisedAttachment = {
    id: 58,
    opportunityId: 30,
    category: 'contract',
    originalName: 'contract-v2.docx',
    storedPath: '2026/06/contract-v2.docx',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    fileSize: 2048,
    uploadedBy: 7,
    uploaderDisplayName: 'Sales One',
    uploadedAt: '2026-06-05T13:31:00.000Z'
  };
  const contractApprovals = [{
    id: 91,
    opportunityId: 30,
    status: 'rejected',
    completedAt: rejectedAt,
    actedAt: rejectedAt,
    reviewerUserId: 6,
    stepAction: 'rejected'
  }];
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
    attachments: [revisedAttachment],
    contractApprovals
  });

  const detail = await agent.get('/opportunities/30');

  assert.equal(detail.status, 200);
  const contractSection = detail.text.match(/<h2>Commercial Contract<\/h2>[\s\S]*?<h2>Timeline<\/h2>/)[0];
  assert.doesNotMatch(contractSection, /Revised Contract attachment is required after rejection/);
  assert.match(contractSection, /submit_contract_approval/);
  assert.match(contractSection, /<button type="submit" >Submit Contract Approval<\/button>/);
});

test('customer negotiation deletes contract attachment before submission', async () => {
  const uploadDir = await mkdtemp(path.join(os.tmpdir(), 'bestcrm-delete-contract-'));
  try {
    await writeFile(path.join(uploadDir, 'contract.txt'), 'contract file', 'utf8');
    const deletedIds = [];
    const attachment = {
      id: 57,
      opportunityId: 30,
      category: 'contract',
      originalName: 'contract.txt',
      storedPath: 'contract.txt',
      mimeType: 'text/plain',
      fileSize: 13,
      uploadedBy: 7,
      uploaderDisplayName: 'Sales One',
      uploadedAt: '2026-06-05T13:00:00.000Z'
    };
    const { agent } = await createLoggedInAgent({
      uploadDir,
      opportunityRepository: {
        async getOpportunityDetail() {
          return opportunityDetail({ status: STATUSES.CUSTOMER_NEGOTIATION });
        }
      },
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

    const response = await agent.post('/opportunities/30/attachments/57/delete').type('form').send();

    assert.equal(response.status, 302);
    assert.equal(response.headers.location, '/opportunities/30');
    assert.deepEqual(deletedIds, [57]);
    assert.equal(existsSync(path.join(uploadDir, 'contract.txt')), false);
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
});

test('submitted contract hides and blocks contract attachment deletion', async () => {
  const uploadDir = await mkdtemp(path.join(os.tmpdir(), 'bestcrm-delete-submitted-contract-'));
  try {
    await writeFile(path.join(uploadDir, 'contract.txt'), 'submitted contract', 'utf8');
    let deleteCalled = false;
    const attachment = {
      id: 57,
      opportunityId: 30,
      category: 'contract',
      originalName: 'contract.txt',
      storedPath: 'contract.txt',
      mimeType: 'text/plain',
      fileSize: 18,
      uploadedBy: 7,
      uploaderDisplayName: 'Sales One',
      uploadedAt: '2026-06-05T13:00:00.000Z'
    };
    const { agent } = await createLoggedInAgent({
      uploadDir,
      opportunityRepository: {
        async getOpportunityDetail() {
          return opportunityDetail({ status: STATUSES.CONTRACT_APPROVAL_IN_PROGRESS });
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
          throw new Error('should not delete submitted contract attachment');
        },
        async findById() {
          return attachment;
        }
      }
    });

    const detail = await agent.get('/opportunities/30');

    assert.equal(detail.status, 200);
    const contractSection = detail.text.match(/<h2>Commercial Contract<\/h2>[\s\S]*?<h2>Timeline<\/h2>/)[0];
    assert.doesNotMatch(contractSection, /\/opportunities\/30\/attachments\/57\/delete/);

    const response = await agent.post('/opportunities/30/attachments/57/delete').type('form').send();

    assert.equal(response.status, 403);
    assert.equal(deleteCalled, false);
    assert.equal(existsSync(path.join(uploadDir, 'contract.txt')), true);
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

test('attachment upload returns a clear 413 response when the file exceeds the configured limit', async () => {
  const uploadDir = await mkdtemp(path.join(os.tmpdir(), 'bestcrm-upload-limit-'));
  try {
    const { agent, uploadedAttachments } = await createLoggedInAgent({
      uploadDir,
      maxUploadMb: 1,
      language: 'zh'
    });

    const response = await agent
      .post('/opportunities/30/attachments')
      .field('category', 'commercial_quote')
      .attach('attachment', Buffer.alloc((1024 * 1024) + 1), {
        filename: 'large-quote.zip',
        contentType: 'application/zip'
      });

    assert.equal(response.status, 413);
    assert.match(response.text, /\u6587\u4ef6\u8d85\u8fc7 1 MB \u4e0a\u4f20\u9650\u5236/);
    assert.equal(uploadedAttachments.length, 0);
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
});

test('page form preserves Chinese attachment filenames', async () => {
  const uploadDir = await mkdtemp(path.join(os.tmpdir(), 'bestcrm-upload-cn-'));
  try {
    const { agent, uploadedAttachments } = await createLoggedInAgent({ uploadDir });

    const response = await agent
      .post('/opportunities/30/attachments')
      .field('category', 'commercial_quote')
      .attach('attachment', Buffer.from('technical file'), {
        filename: '利尔化学含盐废水焚烧系统技术方案260608.pdf',
        contentType: 'application/pdf'
      });

    assert.equal(response.status, 302);
    assert.equal(uploadedAttachments.length, 1);
    assert.equal(uploadedAttachments[0].originalName, '利尔化学含盐废水焚烧系统技术方案260608.pdf');
    assert.doesNotMatch(uploadedAttachments[0].originalName, /Ã|Â|Å|æ|ç|å/);
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

test('attachment upload requires category permission even when opportunity is visible', async () => {
  const uploadDir = await mkdtemp(path.join(os.tmpdir(), 'bestcrm-category-upload-'));
  let createCalled = false;
  try {
    const { agent } = await createLoggedInAgent({
      uploadDir,
      attachmentRepository: {
        async createAttachment() {
          createCalled = true;
          throw new Error('should not create attachment');
        }
      }
    });

    const response = await agent
      .post('/opportunities/30/attachments')
      .field('category', 'technical_solution')
      .attach('attachment', Buffer.from('technical file'), {
        filename: 'technical.txt',
        contentType: 'text/plain'
      });

    assert.equal(response.status, 403);
    assert.equal(createCalled, false);
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

test('csrf protected opportunity form submits with the rendered token', async () => {
  const { agent, created } = await createLoggedInAgent({ csrfProtection: true });

  const form = await agent.get('/opportunities/new');
  const csrfToken = extractCsrfToken(form.text);

  assert.ok(csrfToken);

  const response = await agent
    .post('/opportunities')
    .type('form')
    .send({
      _csrf: csrfToken,
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
  assert.equal(created[0].title, 'Factory upgrade');
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
  assert.match(detail.text, /Requirement Materials[\s\S]*Submit to Sales Manager[\s\S]*Technical Solution/);
  assert.doesNotMatch(detail.text, /Workflow Actions[\s\S]*Submit to Sales Manager/);
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

test('workflow page submission runs through configured transaction manager', async () => {
  const transactionCalls = [];
  const { agent } = await createWorkflowAgent({
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
    workflowTransaction: async (callback) => {
      transactionCalls.push('begin');
      const result = await callback({});
      transactionCalls.push('commit');
      return result;
    }
  });

  const response = await agent
    .post('/opportunities/30/workflow')
    .type('form')
    .send({ action: ACTIONS.SUBMIT_INITIATION, comment: 'ready for review' });

  assert.equal(response.status, 302);
  assert.deepEqual(transactionCalls, ['begin', 'commit']);
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

test('Sales Manager changes quotation engineer after assignment from detail page', async () => {
  const { agent, calls, getOpportunity } = await createWorkflowAgent({
    user: {
      id: 2,
      username: 'manager01',
      displayName: 'Sales Manager',
      roles: [ROLES.SALES_MANAGER]
    },
    opportunity: {
      status: STATUSES.TECHNICAL_SOLUTION_IN_PROGRESS,
      salespersonId: 7,
      salesManagerId: 2,
      quotationEngineerId: 3
    },
    roleUsers: {
      [ROLES.QUOTATION_ENGINEER]: [
        { id: 3, displayName: 'Quote Engineer One', username: 'quote01', roles: [ROLES.QUOTATION_ENGINEER] },
        { id: 8, displayName: 'Quote Engineer Two', username: 'quote02', roles: [ROLES.QUOTATION_ENGINEER] }
      ]
    }
  });

  const detail = await agent.get('/opportunities/30');
  assert.equal(detail.status, 200);
  assert.match(detail.text, /change_quotation_engineer/);
  assert.match(detail.text, /Quote Engineer One/);
  assert.match(detail.text, /Quote Engineer Two/);
  assert.match(detail.text, /value="3" selected/);

  const response = await agent
    .post('/opportunities/30/workflow')
    .type('form')
    .send({ action: ACTIONS.CHANGE_QUOTATION_ENGINEER, quotationEngineerId: '8', comment: 'handover' });

  assert.equal(response.status, 302);
  assert.equal(response.headers.location, '/opportunities/30');
  assert.equal(getOpportunity().status, STATUSES.TECHNICAL_SOLUTION_IN_PROGRESS);
  assert.equal(getOpportunity().quotationEngineerId, 8);
  assert.deepEqual(calls.filter((call) => call[0] !== 'listUsersByRole'), [
    ['findOpportunity', 30],
    ['updateOpportunity', 30, { quotationEngineerId: 8 }],
    ['createEvent', {
      opportunityId: 30,
      eventType: ACTIONS.CHANGE_QUOTATION_ENGINEER,
      fromStatus: STATUSES.TECHNICAL_SOLUTION_IN_PROGRESS,
      toStatus: STATUSES.TECHNICAL_SOLUTION_IN_PROGRESS,
      actorUserId: 2,
      targetUserId: 8,
      comment: 'handover'
    }],
    ['closeTodosForAssignee', 30, 3, 'reassigned'],
    ['createTodo', { opportunityId: 30, assigneeUserId: 8, title: 'Prepare technical solution' }]
  ]);
});

test('commercial quote form shows attachment based submission and missing attachment hint', async () => {
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
  const quoteSection = detail.text.match(/<h2>Commercial Quote<\/h2>[\s\S]*?<h2>Commercial Contract<\/h2>/)[0];
  assert.match(quoteSection, /<button type="submit">Upload<\/button>[\s\S]*submit_commercial_quote/);
  assert.doesNotMatch(quoteSection, /name="quoteItemName"/);
  assert.doesNotMatch(quoteSection, /name="quoteUnitPrice"/);
  assert.doesNotMatch(quoteSection, /name="totalPrice"/);
  assert.doesNotMatch(quoteSection, /name="comment"/);
  assert.doesNotMatch(quoteSection, />\s*Quote Item\s*</);
  assert.doesNotMatch(quoteSection, />\s*Total Price\s*</);
  assert.doesNotMatch(quoteSection, />\s*Comment\s*</);
  assert.doesNotMatch(detail.text, /name="commercialManagerId"/);
  assert.match(quoteSection, /Commercial Quote attachment is required before submission/);
  assert.doesNotMatch(detail.text, /Workflow Actions[\s\S]*submit_commercial_quote/);
});

test('workflow route blocks technical submission without description or attachment', async () => {
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
  assert.match(response.text, /Technical solution description or attachment is required/);
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
    ['createMaterialVersion', {
      opportunityId: 30,
      materialType: 'technical_solution',
      status: 'pending',
      submittedBy: 3
    }],
    ['bindUnboundToMaterialVersion', {
      opportunityId: 30,
      category: 'technical_solution',
      opportunityMaterialVersionId: 300
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
  const contractSection = detail.text.match(/<h2>Commercial Contract<\/h2>[\s\S]*?<h2>Timeline<\/h2>/)[0];
  assert.doesNotMatch(contractSection, /Contract Approvals|Version History|Legal One/);
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
    ['findLatestMaterialVersion', 30, 'contract'],
    ['reviewMaterialVersion', {
      versionId: 300,
      status: 'approved',
      reviewedBy: 6,
      reviewComment: 'legal approved'
    }],
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
