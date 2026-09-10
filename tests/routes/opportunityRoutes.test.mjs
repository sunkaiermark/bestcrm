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

function extractBusinessSection(html, sectionName, nextSectionName) {
  const startMarker = `business-section-${sectionName}"`;
  const endMarker = nextSectionName === 'audit'
    ? 'class="content-section business-section-audit"'
    : `business-section-${nextSectionName}`;
  const start = html.indexOf(startMarker);
  const end = html.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `Expected active ${sectionName} section`);
  assert.notEqual(end, -1, `Expected section after ${sectionName}`);
  return html.slice(start, end);
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
          },
          {
            id: 3,
            username: 'quote01',
            displayName: 'Quotation Engineer',
            email: null,
            phone: null,
            isActive: true,
            roles: [ROLES.QUOTATION_ENGINEER]
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
        return [{ id: 20, contactCode: 'CT000020', customerId: 10, customerCode: 'C000010', customerName: 'Acme Co', customerOwnerUserId: 7, name: 'Alice' }];
      },
      async getContactDetail() {
        return { id: 20, contactCode: 'CT000020', customerId: 10, customerCode: 'C000010', customerName: 'Acme Co', customerOwnerUserId: 7, name: 'Alice' };
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
          customerCode: 'C000010',
          customerName: 'Acme Co',
          primaryContactId: 20,
          primaryContactCode: 'CT000020',
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
          customerCode: 'C000010',
          customerName: 'Acme Co',
          primaryContactId: 20,
          primaryContactCode: 'CT000020',
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
      async archiveById() {
        throw new Error('not used');
      },
      async reopenById() {
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
  assert.match(html, /\.app-shell\s*\{[^}]*grid-template-columns:\s*280px minmax\(0, 1fr\);/);
  assert.match(html, /font:\s*20px\/1\.45 Arial, "Microsoft YaHei", Helvetica, sans-serif;/);
  assert.match(html, /th\s*\{[\s\S]*font-size:\s*20px;/);
  assert.match(html, /h1\s*\{[\s\S]*font-size:\s*24px;/);
  assert.match(html, /\.nav-subgroup \.nav-link\s*\{[\s\S]*font-size:\s*20px;/);
  assert.match(html, /\.nav-account-name\s*\{[^}]*font-weight:\s*400;/);
  assert.match(html, /\.nav-link\s*\{[^}]*font-weight:\s*400;/);
  assert.match(html, /\.nav-parent\s*\{[^}]*font-weight:\s*400;/);
  assert.match(html, /\.logout-button\s*\{[^}]*font-weight:\s*400;/);
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
    primaryContactCode: 'CT000020',
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
  opportunityResponsibilityRepository,
  opportunityTechnicalDraftRepository,
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
        return [{ id: 20, contactCode: 'CT000020', customerId: 10, customerCode: 'C000010', customerName: 'Acme Co', customerOwnerUserId: 7, name: 'Alice' }];
      },
      async getContactDetail() {
        return { id: 20, contactCode: 'CT000020', customerId: 10, customerCode: 'C000010', customerName: 'Acme Co', customerOwnerUserId: 7, name: 'Alice' };
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
    ...(opportunityResponsibilityRepository ? { opportunityResponsibilityRepository } : {}),
    ...(opportunityTechnicalDraftRepository ? { opportunityTechnicalDraftRepository } : {}),
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

test('logged in salesperson can view opportunity list and is redirected to lead submission', async () => {
  const { agent } = await createLoggedInAgent();

  const list = await agent.get('/opportunities');
  assert.equal(list.status, 200);
  assertAppSidebar(list.text, '/opportunities');
  assert.match(list.text, /Opportunities/);
  assert.match(list.text, /Factory upgrade/);
  assert.match(list.text, /<td class="clickable-cell" data-label="Customer Code"><a[^>]*>C000010<\/a><\/td>/);
  assert.match(list.text, /<td class="clickable-cell" data-label="Customer Name"><a[^>]*title="Acme Co">Acme Co<\/a><\/td>/);
  assert.match(list.text, /<th scope="col">Opportunity Name<\/th>/);
  assert.match(list.text, /<th scope="col">Customer Code<\/th>/);
  assert.match(list.text, /<th scope="col">Customer Name<\/th>/);
  assert.match(list.text, /<th scope="col">Contact Code<\/th>/);
  assert.match(list.text, /<th scope="col">Contact Name<\/th>/);
  assert.doesNotMatch(list.text, /<th(?: scope="col")?>Title<\/th>/);
  assert.match(list.text, /<th scope="col">Owner<\/th>/);
  assert.match(list.text, /Sales One/);
  assert.match(list.text, /<td class="clickable-cell" data-label="Contact Code"><a[^>]*>CT000020<\/a><\/td>/);
  assert.match(list.text, /<td class="clickable-cell" data-label="Contact Name"><a[^>]*title="Alice">Alice<\/a><\/td>/);
  assert.match(list.text, /class="list-body record-list-body opportunity-list-body" tabindex="0"/);
  assert.match(list.text, /<table class="list-table record-list-table opportunity-list-table">/);
  assert.match(list.text, /\.record-list-body\s*\{[\s\S]*max-height:\s*70vh;[\s\S]*overflow:\s*auto;/);
  assert.match(list.text, /\.record-list-table thead th\s*\{[\s\S]*font-weight:\s*500;[\s\S]*position:\s*sticky;[\s\S]*text-transform:\s*none;/);
  assert.match(list.text, /\.record-list-table th,\s*\.record-list-table td\s*\{[\s\S]*border-right:[^;]+;[\s\S]*text-align:\s*center;[\s\S]*white-space:\s*nowrap;/);
  assert.match(list.text, /\.opportunity-list-table\s*\{[\s\S]*min-width:\s*1760px;/);
  assert.match(list.text, /\.opportunity-list-table th,\s*\.opportunity-list-table td\s*\{[^}]*border-right-color:\s*#b8c6d1;/);
  assert.match(list.text, /\.opportunity-list-table thead th\s*\{[^}]*border-right-color:\s*rgba\(255, 255, 255, 0\.42\);[^}]*text-align:\s*center;/);
  assert.match(list.text, /\.opportunity-list-table tbody td,\s*\.opportunity-list-table tbody td\.clickable-cell \.cell-link\s*\{[^}]*text-align:\s*left;/);
  assert.match(list.text, /\.opportunity-list-table th:last-child,\s*\.opportunity-list-table td:last-child\s*\{[^}]*border-right:\s*0;/);
  assert.match(list.text, /data-label="Opportunity Name"/);
  assert.match(list.text, /\.record-list-table tbody td::before\s*\{[\s\S]*content:\s*attr\(data-label\);/);
  assert.equal((list.text.match(/class="cell-link" href="\/opportunities\/30"/g) || []).length, 9);

  const form = await agent.get('/opportunities/new');
  assert.equal(form.status, 302);
  assert.equal(form.headers.location, '/lead-submissions/new');

  const detail = await agent.get('/opportunities/30');
  assert.equal(detail.status, 200);
  assertAppSidebar(detail.text, '/opportunities');
  assert.match(detail.text, /Factory upgrade/);
  assert.match(detail.text, /C000010 · Acme Co/);
  assert.match(detail.text, /Upgrade production line/);
  assert.match(detail.text, /CT000020 · Alice/);
  const basicInfoHtml = detail.text.match(/<section class="content-section business-section business-section-basic">[\s\S]*?<\/section>/)?.[0] || '';
  assert.match(basicInfoHtml, /class="basic-info-grid"/);
  assert.equal((basicInfoHtml.match(/<table class="detail-table basic-info-table">/g) || []).length, 1);
  assert.equal((basicInfoHtml.match(/class="basic-info-label-column"/g) || []).length, 2);
  assert.match(basicInfoHtml, /<th scope="row">No\.<\/th>\s*<td>OPP-20260605-abcdef12<\/td>\s*<th scope="row">Status<\/th>\s*<td>Draft<\/td>/);
  assert.match(basicInfoHtml, /<th scope="row">Status<\/th>\s*<td>Draft<\/td>/);
  assert.match(basicInfoHtml, /<th scope="row">Delivery Period<\/th>\s*<td>[\s\S]*?<th scope="row">Expected Bid Date<\/th>/);
  assert.doesNotMatch(basicInfoHtml, /<th scope="row">Delivery Cycle<\/th>/);
  assert.match(detail.text, /\.basic-info-table \.basic-info-label-column\s*\{[^}]*width:\s*190px;/s);
  assert.match(detail.text, /\.business-section-basic > h2,[\s\S]*\.business-section-basic \.detail-table th\s*\{[\s\S]*font-weight:\s*400;/);
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
            { id: 10, customerCode: 'C000010', name: 'Acme Co' },
            { id: 11, customerCode: 'C000011', name: 'Beta Co' }
          ],
          contacts: [
            { id: 20, contactCode: 'CT000020', name: 'Alice', customerId: 10, customerCode: 'C000010', customerName: 'Acme Co' },
            { id: 21, contactCode: 'CT000021', name: 'Bob', customerId: 11, customerCode: 'C000011', customerName: 'Beta Co' }
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
  assert.match(list.text, /<option value="11" selected>C000011 · Beta Co<\/option>/);
  assert.match(list.text, /Contact\s*<select name="contactId">/);
  assert.match(list.text, /<option value="21" selected>CT000021 · Bob \(C000011 · Beta Co\)<\/option>/);
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
  assert.match(list.text, /提交新线索/);
  assert.match(list.text, /\u9500\u552e\u8d1f\u8d23\u4eba/);
  assert.match(list.text, />\u67e5\u8be2<\/button>/);
  assert.match(list.text, /<th scope="col">\u5546\u673a\u540d\u79f0<\/th>/);
  assert.match(list.text, /<span class="status">\u8349\u7a3f<\/span>/);

  const detail = await agent.get('/opportunities/30');
  assert.equal(detail.status, 200);
  assert.match(detail.text, /\u8fd4\u56de\u6e05\u5355/);
  assert.match(detail.text, />\u7f16\u8f91<\/a>/);
  assert.match(detail.text, />\u4e0a\u4f20<\/button>/);
  assert.match(detail.text, /<td>\u8349\u7a3f<\/td>/);
  assert.doesNotMatch(detail.text, /<h2>\u8d23\u4efb\u4eba<\/h2>/);
  assert.match(detail.text, /\u5ba2\u6237\u9700\u6c42/);
  assert.match(detail.text, /\u6280\u672f\u65b9\u6848/);
  assert.match(detail.text, /\u5546\u52a1\u65b9\u6848/);
  assert.match(detail.text, /\u5408\u540c/);
  assert.match(detail.text, /\u5c1a\u672a\u5f00\u59cb/);
  assert.match(detail.text, /\u65f6\u95f4\u8f74/);
  assert.match(detail.text, /\u63d0\u4ea4\u5546\u673a\u7acb\u9879/);
  assert.match(detail.text, />\u63d0\u4ea4\u9500\u552e\u7ecf\u7406<\/button>/);
  assert.doesNotMatch(detail.text, /Submit to Sales Manager/);

  const form = await agent.get('/opportunities/new');
  assert.equal(form.status, 302);
  assert.equal(form.headers.location, '/lead-submissions/new');
});

test('opportunity detail uses compact header actions and hides repeated customer details', async () => {
  const { agent } = await createLoggedInAgent({
    customerEmail: { enabled: true },
    bidCenter: { enabled: true }
  });

  const detail = await agent.get('/opportunities/30');

  assert.equal(detail.status, 200);
  const headerHtml = detail.text.match(/<header class="page-header opportunity-detail-header">[\s\S]*?<\/header>/)?.[0] || '';
  assert.match(headerHtml, />←<\/span> Back<\/a>/);
  assert.match(headerHtml, />✉<\/span> Email<\/a>/);
  assert.match(headerHtml, />Bidding<\/a>/);
  assert.match(headerHtml, />Technical<\/a>/);
  assert.match(headerHtml, /OPP-20260605-abcdef12/);
  assert.doesNotMatch(headerHtml, /C000010|Acme Co/);
  assert.match(detail.text, /\.opportunity-detail-header\s*\{[\s\S]*grid-template-columns:\s*minmax\(720px,\s*68%\) minmax\(0,\s*1fr\);/);
  assert.match(detail.text, /\.opportunity-detail-actions\s*\{[\s\S]*justify-content:\s*flex-end;/);
  assert.match(detail.text, /\.opportunity-detail-heading h1\s*\{[\s\S]*font-weight:\s*700;[\s\S]*white-space:\s*nowrap;/);
  assert.match(detail.text, /<th scope="row">Customer<\/th>\s*<td><a href="\/customers\/10">C000010 · Acme Co<\/a><\/td>/);
  assert.match(detail.text, /href="\/opportunities\/30\/edit"/);
  assert.match(detail.text, />Edit</);
  assert.doesNotMatch(headerHtml, /class="status"/);
  assert.match(detail.text, /<th scope="row">Status<\/th>\s*<td>Draft<\/td>/);
  assert.doesNotMatch(detail.text, /action="\/opportunities\/30\/delete"/);
});

test('future workflow stages stay fully collapsed until their status is reached', async () => {
  const { agent } = await createLoggedInAgent({
    attachmentRepository: {
      async listByOpportunity() {
        return [
          { id: 51, opportunityId: 30, category: 'technical_solution', originalName: 'future-technical.pdf', uploadedAt: '2026-06-05T10:00:00.000Z' },
          { id: 52, opportunityId: 30, category: 'commercial_quote', originalName: 'future-quote.xlsx', uploadedAt: '2026-06-05T11:00:00.000Z' },
          { id: 53, opportunityId: 30, category: 'contract', originalName: 'future-contract.docx', uploadedAt: '2026-06-05T12:00:00.000Z' }
        ];
      }
    }
  });

  const detail = await agent.get('/opportunities/30');

  assert.equal(detail.status, 200);
  assert.match(detail.text, /business-section-technical business-section-future/);
  assert.match(detail.text, /business-section-quote business-section-future/);
  assert.match(detail.text, /business-section-contract business-section-future/);
  assert.doesNotMatch(detail.text, /future-technical\.pdf|future-quote\.xlsx|future-contract\.docx/);
  assert.doesNotMatch(detail.text, /name="category" value="technical_solution"|name="category" value="commercial_quote"|name="category" value="contract"/);
});

test('opportunity correspondence is a single collapsed timeline with expandable email content', async () => {
  const { agent } = await createLoggedInAgent({
    emailCenter: { enabled: true },
    customerEmail: { enabled: true },
    emailArchiveRepository: {
      supportsEmailArchive: true,
      async listThreadsByOpportunity() {
        return [{ id: 81, subject: 'Pump capacity clarification', lastMessageAt: '2026-09-09T07:20:00.000Z' }];
      },
      async getThreadDetail() {
        return {
          id: 81,
          subject: 'Pump capacity clarification',
          lastMessageAt: '2026-09-09T07:20:00.000Z',
          messages: [{
            id: 91,
            direction: 'inbound',
            subject: 'Request to revise pump capacity',
            fromAddress: 'customer@example.com',
            toRecipients: [{ address: 'sales@sunkaier.com' }],
            textBody: 'Please revise the required capacity to 12 m3/h.',
            receivedAt: '2026-09-09T07:20:00.000Z',
            attachments: [{ id: 101, originalName: 'pump-parameters-rev2.pdf' }]
          }]
        };
      }
    }
  });

  const detail = await agent.get('/opportunities/30');

  assert.equal(detail.status, 200);
  assert.match(detail.text, /<h2><span>Correspondence<\/span><span class="section-heading-meta">1 messages<\/span><\/h2>/);
  assert.match(detail.text, /<details class="correspondence-item">[\s\S]*Request to revise pump capacity[\s\S]*← Incoming/);
  assert.doesNotMatch(detail.text, /<details class="correspondence-item" open>/);
  assert.match(detail.text, /Please revise the required capacity to 12 m3\/h\./);
  assert.match(detail.text, /href="\/email-center\/attachments\/101\/download">pump-parameters-rev2\.pdf/);
  assert.match(detail.text, /href="\/email-center\/threads\/81">Open conversation/);
  assert.match(detail.text, /href="\/email-center\/compose\?threadId=81">Reply/);
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

test('Supporting Engineer can access technical working area while contribution entry stays off the detail page', async () => {
  const contributions = [];
  let deleteCalled = false;
  const supportingMember = {
    id: 41,
    opportunityId: 30,
    userId: 8,
    username: 'support01',
    userDisplayName: 'Support Engineer',
    roleCode: ROLES.QUOTATION_ENGINEER,
    roleName: 'Quotation Engineer',
    permissionLevel: 'edit',
    assignmentScope: 'Agitator section',
    taskDescription: 'Verify shaft sizing',
    dueDate: '2026-06-12',
    canSendExternalEmail: false,
    isActive: true,
    addedBy: 3,
    addedByDisplayName: 'Lead Engineer',
    addedAt: '2026-06-06T08:00:00.000Z',
    removedBy: null,
    removedByDisplayName: '',
    removedAt: null
  };
  const { agent } = await createLoggedInAgent({
    user: {
      id: 8,
      username: 'support01',
      displayName: 'Support Engineer',
      roles: [ROLES.QUOTATION_ENGINEER]
    },
    opportunityRepository: {
      async getOpportunityDetail() {
        return opportunityDetail({
          status: STATUSES.TECHNICAL_SOLUTION_IN_PROGRESS,
          quotationEngineerId: 3,
          quotationEngineerDisplayName: 'Lead Engineer'
        });
      }
    },
    attachmentRepository: {
      async findById() {
        return {
          id: 55,
          opportunityId: 30,
          category: 'technical_solution',
          uploadedBy: 3,
          storedPath: '2026/06/lead-solution.pdf'
        };
      },
      async deleteById() {
        deleteCalled = true;
      }
    },
    opportunityResponsibilityRepository: {
      async listTeamMembersByOpportunity() {
        return [supportingMember];
      },
      async listTeamMemberEventsByOpportunity() {
        return [];
      },
      async listEngineeringContributionsByOpportunity() {
        return [];
      },
      async listOwnerTransfersByOpportunity() {
        return [];
      },
      async createEngineeringContribution(input) {
        contributions.push(input);
        return { id: 71, ...input };
      }
    }
  });

  const detail = await agent.get('/opportunities/30');

  assert.equal(detail.status, 200);
  assert.doesNotMatch(detail.text, /Responsibility|Project lead engineer|Engineering contributions/);
  assert.match(detail.text, /action="\/opportunities\/30\/attachments"/);
  assert.match(detail.text, /value="technical_solution"/);
  assert.doesNotMatch(detail.text, /action="\/opportunities\/30\/engineering-contributions"/);
  assert.doesNotMatch(detail.text, /name="action" value="submit_technical_solution"/);

  const response = await agent
    .post('/opportunities/30/engineering-contributions')
    .type('form')
    .send({ contributionSummary: 'Completed shaft calculation.' });

  assert.equal(response.status, 302);
  assert.deepEqual(contributions, [{
    opportunityId: 30,
    contributorUserId: 8,
    contributionSummary: 'Completed shaft calculation.',
    createdBy: 8
  }]);

  const deleteResponse = await agent
    .post('/opportunities/30/attachments/55/delete')
    .type('form')
    .send();
  assert.equal(deleteResponse.status, 403);
  assert.equal(deleteCalled, false);
});

test('removed Supporting Engineer loses direct opportunity access', async () => {
  const { agent } = await createLoggedInAgent({
    user: {
      id: 8,
      username: 'support01',
      displayName: 'Support Engineer',
      roles: [ROLES.QUOTATION_ENGINEER]
    },
    opportunityRepository: {
      async getOpportunityDetail() {
        return opportunityDetail({ quotationEngineerId: 3 });
      }
    },
    opportunityResponsibilityRepository: {
      async listTeamMembersByOpportunity() {
        return [];
      },
      async listOwnerTransfersByOpportunity() {
        return [];
      }
    }
  });

  const detail = await agent.get('/opportunities/30');

  assert.equal(detail.status, 403);
});

test('administrator sees opportunity archive action with a required reason on detail page', async () => {
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
  assert.match(detail.text, /action="\/opportunities\/30\/archive"/);
  assert.match(detail.text, /name="reason"/);
  assert.match(detail.text, />Archive</);
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

test('non administrators cannot archive opportunities directly', async () => {
  let archiveCalled = false;
  const { agent } = await createLoggedInAgent({
    opportunityRepository: {
      async archiveById() {
        archiveCalled = true;
      }
    }
  });

  const response = await agent.post('/opportunities/30/archive').type('form').send({ reason: 'No authority' });

  assert.equal(response.status, 403);
  assert.equal(archiveCalled, false);
});

test('administrator archives opportunity and preserves stored attachment files', async () => {
  const uploadDir = await mkdtemp(path.join(os.tmpdir(), 'bestcrm-delete-opportunity-'));
  const storedPath = '2026/06/delete-me.txt';
  const absolutePath = path.join(uploadDir, storedPath);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, 'delete this file');
  const archived = [];
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
        async archiveById(id, input) {
          archived.push({ id: Number(id), ...input });
          return true;
        }
      }
    });

    const response = await agent.post('/opportunities/30/archive').type('form').send({ reason: 'Cancelled duplicate' });

    assert.equal(response.status, 302);
    assert.equal(response.headers.location, '/opportunities');
    assert.deepEqual(archived, [{ id: 30, actorUserId: 99, reason: 'Cancelled duplicate' }]);
    assert.equal(existsSync(absolutePath), true);
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
});

test('administrator reopens an archived opportunity and archived detail is read-only', async () => {
  const reopened = [];
  const archivedOpportunity = opportunityDetail({
    archivedAt: new Date('2026-09-07T00:00:00Z'),
    archiveReason: 'Duplicate opportunity'
  });
  const { agent } = await createLoggedInAgent({
    user: {
      id: 99,
      username: 'admin01',
      displayName: 'Admin User',
      roles: [ROLES.ADMINISTRATOR]
    },
    opportunityRepository: {
      async getOpportunityDetail() {
        return archivedOpportunity;
      },
      async reopenById(id, input) {
        reopened.push({ id: Number(id), ...input });
        return true;
      }
    }
  });

  const detail = await agent.get('/opportunities/30');
  assert.equal(detail.status, 200);
  assert.match(detail.text, /action="\/opportunities\/30\/reopen"/);
  assert.doesNotMatch(detail.text, /action="\/opportunities\/30\/archive"/);
  assert.doesNotMatch(detail.text, /action="\/opportunities\/30\/team-members"/);
  assert.doesNotMatch(detail.text, /action="\/opportunities\/30\/owner-transfer"/);
  assert.doesNotMatch(detail.text, /action="\/opportunities\/30\/attachments"/);
  assert.doesNotMatch(detail.text, /action="\/opportunities\/30\/workflow"/);

  const teamMutation = await agent.post('/opportunities/30/team-members').type('form').send({
    userId: 3,
    assignmentScope: 'technical_solution',
    taskDescription: 'Should not be added',
    dueDate: '2026-09-30'
  });
  assert.equal(teamMutation.status, 403);

  const reopen = await agent.post('/opportunities/30/reopen').type('form').send({ reason: 'Verified as active' });
  assert.equal(reopen.status, 302);
  assert.equal(reopen.headers.location, '/opportunities/30');
  assert.deepEqual(reopened, [{ id: 30, actorUserId: 99, reason: 'Verified as active' }]);
});

test('opportunity archive route rejects an empty reason before repository changes', async () => {
  let archiveCalled = false;
  const { agent } = await createLoggedInAgent({
    user: {
      id: 99,
      username: 'admin01',
      displayName: 'Admin User',
      roles: [ROLES.ADMINISTRATOR]
    },
    opportunityRepository: {
      async archiveById() {
        archiveCalled = true;
        return true;
      }
    }
  });

  const response = await agent.post('/opportunities/30/archive').type('form').send({ reason: '   ' });
  assert.equal(response.status, 400);
  assert.equal(archiveCalled, false);
});

test('direct opportunity customer creation is blocked', async () => {
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

  assert.equal(response.status, 403);
  assert.match(response.text, /Create and review an inquiry/);
  assert.deepEqual(createdCustomers, []);
});

test('direct opportunity customer creation never reaches duplicate handling', async () => {
  let createCalled = false;
  const { agent } = await createLoggedInAgent({
    customerRepository: {
      async listCustomers() {
        return [{ id: 10, customerCode: 'C000010', name: 'Acme Co', ownerUserId: 7 }];
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

  assert.equal(response.status, 403);
  assert.equal(createCalled, false);
});

test('direct opportunity contact creation is blocked', async () => {
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

  assert.equal(response.status, 403);
  assert.deepEqual(createdContacts, []);
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

test('opportunity detail omits the retired responsibility panel and its repeated history queries', async () => {
  const responsibilityCalls = [];
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
          status: STATUSES.TECHNICAL_SOLUTION_IN_PROGRESS,
          salesManagerId: 2,
          quotationEngineerId: 3,
          quotationEngineerDisplayName: 'Quotation Engineer'
        });
      }
    },
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
          permissionLevel: 'edit',
          assignmentScope: 'Agitator section',
          taskDescription: 'Verify shaft sizing',
          dueDate: '2026-06-12',
          canSendExternalEmail: false,
          isActive: true,
          addedBy: 2,
          addedByDisplayName: 'Sales Manager',
          addedAt: '2026-06-06T08:00:00.000Z',
          removedBy: null,
          removedByDisplayName: '',
          removedAt: null
        }];
      },
      async listTeamMemberEventsByOpportunity(opportunityId) {
        responsibilityCalls.push(['memberEvents', opportunityId]);
        return [{
          id: 61,
          opportunityId,
          memberId: 41,
          userId: 8,
          userDisplayName: 'Quote Engineer',
          eventType: 'assigned',
          assignmentScope: 'Agitator section',
          taskDescription: 'Verify shaft sizing',
          dueDate: '2026-06-12',
          actorDisplayName: 'Sales Manager',
          createdAt: '2026-06-06T08:00:00.000Z'
        }];
      },
      async listEngineeringContributionsByOpportunity(opportunityId) {
        responsibilityCalls.push(['contributions', opportunityId]);
        return [{
          id: 71,
          opportunityId,
          contributorUserId: 8,
          contributorDisplayName: 'Quote Engineer',
          contributionSummary: 'Completed shaft calculation.',
          createdAt: '2026-06-07T08:00:00.000Z'
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
  assert.doesNotMatch(detail.text, /Responsibility|responsibility-grid|Project lead engineer|Supporting engineers|Engineering assignment history|Engineering contributions|Owner transfer history/);
  assert.deepEqual(responsibilityCalls, [['members', 30]]);
});

test('administrator does not see retired responsibility management forms on opportunity detail', async () => {
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
  assert.doesNotMatch(detail.text, /responsibility-disclosure|Add \/ update supporting engineer|Transfer owner|name="assignmentScope"|name="canSendExternalEmail"|name="keepPreviousOwnerAsMember"/);
});

test('retired Supporting Engineer form is not rendered', async () => {
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
  assert.doesNotMatch(detail.text, /responsibility-form|action="\/opportunities\/30\/team-members"/);
});

test('administrator adds updates and removes Supporting Engineers', async () => {
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
        return [{
          id: 41,
          userId: 3,
          roleCode: ROLES.QUOTATION_ENGINEER,
          isActive: true
        }];
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
      userId: 3,
      assignmentScope: 'Reactor section',
      taskDescription: 'Check heat transfer area',
      dueDate: '2026-06-15',
      canSendExternalEmail: 'on'
    });

  assert.equal(addResponse.status, 302);
  assert.deepEqual(addedMembers, [{
    opportunityId: 30,
    userId: 3,
    roleCode: ROLES.QUOTATION_ENGINEER,
    permissionLevel: 'edit',
    addedBy: 99,
    assignmentScope: 'Reactor section',
    taskDescription: 'Check heat transfer area',
    dueDate: '2026-06-15',
    canSendExternalEmail: true
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
  const { agent } = await createLoggedInAgent({
    attachmentRepository: {
      async listByOpportunity() {
        return [{
          id: 55,
          opportunityId: 30,
          category: 'requirement',
          originalName: 'requirement-spec.pdf',
          storedPath: '2026/06/requirement-spec.pdf',
          mimeType: 'application/pdf',
          fileSize: 1024,
          uploadedBy: 7,
          uploaderDisplayName: 'Sales One',
          uploadedAt: '2026-06-05T12:00:00.000Z'
        }];
      }
    }
  });

  const detail = await agent.get('/opportunities/30');

  assert.equal(detail.status, 200);
  assert.match(detail.text, /Basic Info/);
  assert.match(detail.text, /Customer Requirement/);
  assert.match(detail.text, /Technical Proposal/);
  assert.match(detail.text, /Commercial Proposal/);
  assert.match(detail.text, /Contract/);
  assert.match(detail.text, /name="attachment"/);
  assert.match(detail.text, /name="category" value="requirement"/);
  assert.match(detail.text, /name="requirementText"[\s\S]*type="hidden" name="reason"/);
  assert.match(detail.text, /1 · Requirement text[\s\S]*Initial Requirement[\s\S]*Upgrade production line/);
  assert.match(detail.text, /3 · Uploaded files[\s\S]*name="category" value="requirement"[\s\S]*name="attachment"/);
  assert.doesNotMatch(detail.text, /Reason \/ Source/);
  assert.match(detail.text, /requirement-spec\.pdf/);
  assert.match(detail.text, /\/opportunities\/30\/attachments\/55\/download/);
  assert.match(detail.text, /\/opportunities\/30\/attachments\/55\/preview/);
  assert.doesNotMatch(detail.text, /<th>Category<\/th>/);
  assert.doesNotMatch(detail.text, /<th>Uploaded By<\/th>/);
});

test('opportunity detail shows technical proposal files in one timeline with local submit action', async () => {
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
  const technicalSection = extractBusinessSection(detail.text, 'technical', 'quote');
  assert.match(technicalSection, /technical-solution\.pdf[\s\S]*Submit to Technical Manager/);
  assert.doesNotMatch(technicalSection, /name="solutionSummary"|Use skid-mounted evaporation package|Reserve PLC interface/);
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
    const technicalSection = extractBusinessSection(detail.text, 'technical', 'quote');
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
            category: 'requirement',
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
            category: 'requirement',
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

test('opportunity workflow panels use the approved unified light-blue headers', async () => {
  const { agent } = await createLoggedInAgent();

  const detail = await agent.get('/opportunities/30');

  assert.equal(detail.status, 200);
  assert.match(detail.text, /class="content-section business-section business-section-basic"/);
  assert.match(detail.text, /class="content-section business-section opportunity-workflow-section business-section-requirement"/);
  assert.match(detail.text, /class="content-section business-section opportunity-workflow-section business-section-technical(?: business-section-future)?"/);
  assert.match(detail.text, /class="content-section business-section opportunity-workflow-section business-section-quote(?: business-section-future)?"/);
  assert.match(detail.text, /class="content-section business-section opportunity-workflow-section business-section-contract(?: business-section-future)?"/);
  assert.match(detail.text, /\.business-section-basic\s*\{[\s\S]*background:\s*#f4f7fb;/);
  assert.match(detail.text, /\.business-section-basic > h2\s*\{[\s\S]*background:\s*#1e3a5f;/);
  for (const section of ['requirement', 'technical', 'quote', 'contract']) {
    assert.match(detail.text, new RegExp(`\\.business-section-${section}\\s*\\{[\\s\\S]*background:\\s*#fff;`));
    assert.match(detail.text, new RegExp(`\\.business-section-${section} > h2\\s*\\{[\\s\\S]*background:\\s*#47739f;`));
  }
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
    opportunityRepository: {
      async getOpportunityDetail() {
        return opportunityDetail({ status: STATUSES.CONTRACT_REJECTED, quotationEngineerId: 3 });
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
    }
  });

  const detail = await agent.get('/opportunities/30');

  assert.equal(detail.status, 200);
  assert.match(detail.text, /Customer Requirement[\s\S]*requirement-spec\.pdf/);
  assert.match(detail.text, /requirement-row requirement-row-file[\s\S]*2026-06-05 \d{2}:00[\s\S]*requirement-spec\.pdf[\s\S]*Preview[\s\S]*Download/);
  assert.match(detail.text, /class="requirement-action-download"[^>]*href="\/opportunities\/30\/attachments\/51\/download"/);
  assert.doesNotMatch(detail.text, /class="requirement-action-download"[^>]*download=/);
  assert.doesNotMatch(detail.text, /class="requirement-action-download"[^>]*target="_blank"/);
  assert.match(detail.text, /Commercial Proposal[\s\S]*quote-v1\.xlsx/);
  assert.match(detail.text, /Contract[\s\S]*contract-draft\.docx/);
});

test('opportunity detail omits legacy technical text versions from the file timeline', async () => {
  const { agent } = await createLoggedInAgent({
    opportunityRepository: {
      async getOpportunityDetail() {
        return opportunityDetail({ status: STATUSES.TECHNICAL_SOLUTION_PENDING, quotationEngineerId: 3 });
      }
    },
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
  const technicalSection = extractBusinessSection(detail.text, 'technical', 'quote');
  assert.doesNotMatch(technicalSection, /Version History/);
  assert.doesNotMatch(technicalSection, /Updated cabinet control solution|V2|approved/);
  assert.doesNotMatch(technicalSection, /IP65, stainless cabinet/);
  assert.doesNotMatch(technicalSection, /Revise drawings and wiring plan/);
});

test('opportunity detail shows file versions inline without separate version timelines', async () => {
  const { agent } = await createLoggedInAgent({
    opportunityRepository: {
      async getOpportunityDetail() {
        return opportunityDetail({ status: STATUSES.CONTRACT_REJECTED, quotationEngineerId: 3 });
      }
    },
    attachmentRepository: {
      async listByOpportunity() {
        return [
          {
            id: 51,
            opportunityId: 30,
            opportunityMaterialVersionId: 101,
            category: 'technical_solution',
            originalName: 'technical-solution.pdf',
            storedPath: 'technical-solution.pdf',
            mimeType: 'application/pdf',
            fileSize: 2048,
            uploadedBy: 3,
            uploadedAt: '2026-06-05T11:30:00.000Z'
          },
          {
            id: 52,
            opportunityId: 30,
            opportunityMaterialVersionId: 102,
            category: 'commercial_quote',
            originalName: 'commercial-quote.xlsx',
            storedPath: 'commercial-quote.xlsx',
            mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            fileSize: 2048,
            uploadedBy: 3,
            uploadedAt: '2026-06-06T09:00:00.000Z'
          },
          {
            id: 53,
            opportunityId: 30,
            opportunityMaterialVersionId: 103,
            category: 'contract',
            originalName: 'contract.docx',
            storedPath: 'contract.docx',
            mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            fileSize: 2048,
            uploadedBy: 7,
            uploadedAt: '2026-06-07T09:00:00.000Z'
          }
        ];
      }
    },
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
  const technicalSection = extractBusinessSection(detail.text, 'technical', 'quote');
  const quoteSection = extractBusinessSection(detail.text, 'quote', 'contract');
  const contractSection = extractBusinessSection(detail.text, 'contract', 'audit');
  assert.match(technicalSection, /2026-06-05 \d{2}:30[\s\S]*technical-solution\.pdf[\s\S]*class="file-version">V1[\s\S]*Preview[\s\S]*Download/);
  assert.match(quoteSection, /2026-06-06 \d{2}:00[\s\S]*commercial-quote\.xlsx[\s\S]*class="file-version">V2[\s\S]*Preview[\s\S]*Download/);
  assert.match(contractSection, /2026-06-07 \d{2}:00[\s\S]*contract\.docx[\s\S]*class="file-version">V1[\s\S]*Preview[\s\S]*Download/);
  assert.doesNotMatch(`${technicalSection}${quoteSection}${contractSection}`, /material-version-strip|Version History/);
});

test('opportunity detail hides commercial quote version history because quote rows are dated', async () => {
  const { agent } = await createLoggedInAgent({
    opportunityRepository: {
      async getOpportunityDetail() {
        return opportunityDetail({ status: STATUSES.CUSTOMER_NEGOTIATION, quotationEngineerId: 3 });
      }
    },
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
  const quoteSection = extractBusinessSection(detail.text, 'quote', 'contract');
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
  const contractSection = extractBusinessSection(detail.text, 'contract', 'audit');
  assert.doesNotMatch(contractSection, /Contract Approvals|Version History/);
  assert.doesNotMatch(contractSection, /V2|Legal One|missing clause/);
});

test('opportunity detail shows upload forms in each business material panel', async () => {
  const { agent } = await createLoggedInAgent({
    user: { roles: [ROLES.ADMINISTRATOR] },
    opportunityRepository: {
      async getOpportunityDetail() {
        return opportunityDetail({ status: STATUSES.CONTRACT_REJECTED, quotationEngineerId: 3 });
      }
    }
  });

  const detail = await agent.get('/opportunities/30');

  assert.equal(detail.status, 200);
  assert.equal((detail.text.match(/action="\/opportunities\/30\/attachments"/g) || []).length, 4);
  assert.equal((detail.text.match(/class="form-panel attachment-upload-panel"/g) || []).length, 3);
  assert.equal((detail.text.match(/class="attachment-upload-panel requirement-file-upload"/g) || []).length, 1);
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
  assert.match(detail.text, /Upload file/);
  assert.equal((detail.text.match(/Upload proposal/g) || []).length, 2);
  assert.match(detail.text, /Upload contract/);
  const requirementSection = extractBusinessSection(detail.text, 'requirement', 'technical');
  assert.match(requirementSection, /name="category" value="requirement"/);
  assert.doesNotMatch(requirementSection, /<select name="category"/);
  assert.match(detail.text, /Technical Proposal[\s\S]*name="category" value="technical_solution"/);
  assert.match(detail.text, /Commercial Proposal[\s\S]*name="category" value="commercial_quote"/);
  assert.match(detail.text, /Contract[\s\S]*name="category" value="contract"/);
});

test('opportunity detail hides technical upload from users without category permission', async () => {
  const { agent } = await createLoggedInAgent();

  const detail = await agent.get('/opportunities/30');

  assert.equal(detail.status, 200);
  assert.match(detail.text, /Customer Requirement[\s\S]*name="category" value="requirement"/);
  assert.doesNotMatch(detail.text, /Technical Proposal[\s\S]*name="category" value="technical_solution"/);
});

test('technical proposal submission uses the uploaded file without duplicate text fields', async () => {
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
  assert.match(detail.text, /Submit to Technical Manager/);
  assert.doesNotMatch(detail.text, /Technical Solution Description|name="solutionSummary"/);
  assert.doesNotMatch(detail.text, /name="solutionParameters"/);
  assert.doesNotMatch(detail.text, /name="implementationPlan"/);
});

test('versioned technical approval directs the Project Lead to TS-D drafts', async () => {
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
    opportunityTechnicalDraftRepository: {
      supportsVersionedTechnicalApproval: true
    }
  });

  const detail = await agent.get('/opportunities/30');

  assert.equal(detail.status, 200);
  assert.match(detail.text, /href="\/opportunities\/30\/technical-drafts"/);
  assert.doesNotMatch(detail.text, /Technical approval is submitted from a validated TS-D project draft/);
  assert.doesNotMatch(detail.text, /name="solutionSummary"/);
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
  assert.match(detail.text, /Customer Requirement[\s\S]*Initial Requirement[\s\S]*Upgrade production line/);
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

test('duplicate requirement text is not saved again', async () => {
  let createCalled = false;
  const { agent } = await createLoggedInAgent({
    requirementUpdateRepository: {
      async listByOpportunity() {
        return [];
      },
      async create() {
        createCalled = true;
        throw new Error('duplicate requirement should not be saved');
      }
    }
  });

  const response = await agent
    .post('/opportunities/30/requirement-updates')
    .type('form')
    .send({
      requirementText: '  UPGRADE   production line  ',
      reason: 'Customer requirement update'
    });

  assert.equal(response.status, 302);
  assert.equal(response.headers.location, '/opportunities/30?requirement=duplicate#requirement-materials');
  assert.equal(createCalled, false);

  const detail = await agent.get('/opportunities/30?requirement=duplicate');
  assert.equal(detail.status, 200);
  assert.match(detail.text, /No new changes\. Duplicate requirement was not saved\./);
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
  assert.match(detail.text, /Customer Requirement[\s\S]*requirement-spec\.pdf[\s\S]*\/opportunities\/30\/attachments\/55\/delete/);
  assert.match(detail.text, /onsubmit="return confirm\('Delete this requirement file\?'\)"/);
  assert.match(detail.text, /Customer Requirement[\s\S]*Delete/);
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
    user: {
      id: 3,
      username: 'quote01',
      displayName: 'Quote Engineer',
      roles: [ROLES.QUOTATION_ENGINEER]
    },
    opportunityRepository: {
      async getOpportunityDetail() {
        return opportunityDetail({ status: STATUSES.COMMERCIAL_QUOTE_IN_PROGRESS, quotationEngineerId: 3 });
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
  const quoteSection = extractBusinessSection(detail.text, 'quote', 'contract');
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
      user: {
        id: 3,
        username: 'quote01',
        displayName: 'Quote Engineer',
        roles: [ROLES.QUOTATION_ENGINEER]
      },
      opportunityRepository: {
        async getOpportunityDetail() {
          return opportunityDetail({ status: STATUSES.COMMERCIAL_QUOTE_IN_PROGRESS, quotationEngineerId: 3 });
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
    const quoteSection = extractBusinessSection(detail.text, 'quote', 'contract');
    assert.doesNotMatch(quoteSection, /\/opportunities\/30\/attachments\/55\/delete/);

    const response = await agent.post('/opportunities/30/attachments/55/delete').type('form').send();

    assert.equal(response.status, 403);
    assert.equal(deleteCalled, false);
    assert.equal(existsSync(path.join(uploadDir, 'quote.txt')), true);
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
});

test('customer negotiation keeps contract content fully collapsed until the opportunity is won', async () => {
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
  assert.match(detail.text, /business-section-contract business-section-future[\s\S]*Contract[\s\S]*Not started/);
  assert.doesNotMatch(detail.text, /contract-v1\.docx|submit_contract_approval|name="category" value="contract"/);
});

test('contract attachment before negotiation remains hidden with the future contract stage', async () => {
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
  assert.match(detail.text, /business-section-contract business-section-future[\s\S]*Contract[\s\S]*Not started/);
  assert.doesNotMatch(detail.text, /contract-v1\.docx|Submit Contract Approval|name="category" value="contract"/);
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
  const contractSection = extractBusinessSection(detail.text, 'contract', 'audit');
  assert.match(contractSection, /Revised Contract attachment is required after rejection/);
  assert.match(contractSection, /name="action" value="submit_contract_approval"[\s\S]*?<button[\s\S]*?disabled[\s\S]*?>Submit Contract Approval<\/button>/);
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
  const contractSection = extractBusinessSection(detail.text, 'contract', 'audit');
  assert.match(contractSection, /Revised Contract attachment is required after rejection/);
  assert.match(contractSection, /name="action" value="submit_contract_approval"[\s\S]*?<button[\s\S]*?disabled[\s\S]*?>Submit Contract Approval<\/button>/);
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
  const contractSection = extractBusinessSection(detail.text, 'contract', 'audit');
  assert.doesNotMatch(contractSection, /Revised Contract attachment is required after rejection/);
  assert.match(contractSection, /submit_contract_approval/);
  assert.match(contractSection, /name="action" value="submit_contract_approval"[\s\S]*?<button[\s\S]*?>Submit Contract Approval<\/button>/);
  assert.doesNotMatch(contractSection.match(/name="action" value="submit_contract_approval"[\s\S]*?<\/button>/)?.[0] || '', /disabled/);
});

test('customer negotiation blocks contract attachment deletion before the contract stage', async () => {
  const uploadDir = await mkdtemp(path.join(os.tmpdir(), 'bestcrm-delete-contract-'));
  try {
    await writeFile(path.join(uploadDir, 'contract.txt'), 'contract file', 'utf8');
    let deleteCalled = false;
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
        async deleteById() {
          deleteCalled = true;
          throw new Error('should not delete before the contract stage');
        },
        async findById() {
          return attachment;
        }
      }
    });

    const response = await agent.post('/opportunities/30/attachments/57/delete').type('form').send();

    assert.equal(response.status, 403);
    assert.equal(deleteCalled, false);
    assert.equal(existsSync(path.join(uploadDir, 'contract.txt')), true);
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
    const contractSection = extractBusinessSection(detail.text, 'contract', 'audit');
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
    const { agent, uploadedAttachments } = await createLoggedInAgent({
      uploadDir,
      user: {
        id: 3,
        username: 'quote01',
        displayName: 'Quote Engineer',
        roles: [ROLES.QUOTATION_ENGINEER]
      },
      opportunityRepository: {
        async getOpportunityDetail() {
          return opportunityDetail({ status: STATUSES.COMMERCIAL_QUOTE_IN_PROGRESS, quotationEngineerId: 3 });
        }
      }
    });

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
    assert.equal(uploadedAttachments[0].uploadedBy, 3);
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
      .field('category', 'requirement')
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

test('salesperson cannot upload the quotation engineer commercial quote', async () => {
  const uploadDir = await mkdtemp(path.join(os.tmpdir(), 'bestcrm-category-upload-'));
  let createCalled = false;
  try {
    const { agent } = await createLoggedInAgent({
      uploadDir,
      opportunityRepository: {
        async getOpportunityDetail() {
          return opportunityDetail({ status: STATUSES.COMMERCIAL_QUOTE_IN_PROGRESS, quotationEngineerId: 3 });
        }
      },
      attachmentRepository: {
        async createAttachment() {
          createCalled = true;
          throw new Error('should not create attachment');
        }
      }
    });

    const response = await agent
      .post('/opportunities/30/attachments')
      .field('category', 'commercial_quote')
      .attach('attachment', Buffer.from('commercial quote'), {
        filename: 'commercial-quote.xlsx',
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

test('page form cannot create an opportunity without an inquiry', async () => {
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

  assert.equal(response.status, 403);
  assert.deepEqual(created, []);
});

test('csrf protection does not reopen the blocked direct opportunity endpoint', async () => {
  const { agent, created } = await createLoggedInAgent({ csrfProtection: true });

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

  assert.equal(response.status, 403);
  assert.deepEqual(created, []);
});

test('JSON API blocks direct opportunity creation', async () => {
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

  assert.equal(response.status, 403);
  assert.match(response.body.error, /Create and review an inquiry/);
  assert.deepEqual(created, []);
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
  assert.match(detail.text, /Customer Requirement[\s\S]*Submit to Sales Manager[\s\S]*Technical Proposal/);
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
    .send({
      action: ACTIONS.APPROVE_INITIATION,
      quotationEngineerId: '3',
      technicalPlanSubmitDate: '2026-09-16',
      comment: 'approved'
    });

  assert.equal(response.status, 302);
  assert.equal(response.headers.location, '/opportunities/30');
  assert.equal(getOpportunity().status, STATUSES.TECHNICAL_SOLUTION_IN_PROGRESS);
  assert.equal(getOpportunity().quotationEngineerId, 3);
  assert.deepEqual(calls.filter((call) => call[0] !== 'listUsersByRole'), [
    ['findOpportunity', 30],
    ['updateOpportunity', 30, { status: STATUSES.TECHNICAL_SOLUTION_IN_PROGRESS, quotationEngineerId: 3, technicalPlanSubmitDate: '2026-09-16' }],
    ['createEvent', {
      opportunityId: 30,
      eventType: ACTIONS.APPROVE_INITIATION,
      fromStatus: STATUSES.INITIATION_PENDING,
      toStatus: STATUSES.TECHNICAL_SOLUTION_IN_PROGRESS,
      actorUserId: 2,
      targetUserId: 3,
      comment: 'approved\nPlan to submit: 2026-09-16'
    }],
    ['closeTodos', 30, 'completed'],
    ['createTodo', { opportunityId: 30, assigneeUserId: 3, title: 'Prepare technical solution', dueAt: '2026-09-16T23:59:59+08:00' }]
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
  const quoteSection = extractBusinessSection(detail.text, 'quote', 'contract');
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

test('Supporting Engineer cannot submit the integrated technical solution', async () => {
  const { agent, calls, getOpportunity } = await createWorkflowAgent({
    user: {
      id: 8,
      username: 'support01',
      displayName: 'Support Engineer',
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
      solutionSummary: 'Attempted final submission'
    });

  assert.equal(response.status, 403);
  assert.equal(getOpportunity().status, STATUSES.TECHNICAL_SOLUTION_IN_PROGRESS);
  assert.deepEqual(calls, [
    ['findOpportunity', 30],
    ['findActiveApprovalSetting', 'technical_solution']
  ]);
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

test('Project Approval selects multiple engineers and stores the technical proposal deadline', async () => {
  const assignmentCalls = [];
  const opportunityResponsibilityRepository = {
    async listTeamMembersByOpportunity(opportunityId) {
      assignmentCalls.push(['listMembers', opportunityId]);
      return [];
    },
    async addTeamMember(input) {
      assignmentCalls.push(['addMember', input]);
      return { id: 41, ...input };
    },
    async removeTeamMember(input) {
      assignmentCalls.push(['removeMember', input]);
      return { id: input.memberId };
    }
  };
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
      [ROLES.QUOTATION_ENGINEER]: [
        { id: 3, displayName: 'Quote Engineer One', username: 'quote01', roles: [ROLES.QUOTATION_ENGINEER] },
        { id: 8, displayName: 'Quote Engineer Two', username: 'quote02', roles: [ROLES.QUOTATION_ENGINEER] }
      ]
    },
    opportunityResponsibilityRepository
  });

  const detail = await agent.get('/opportunities/30');
  assert.equal(detail.status, 200);
  const approvalSection = extractBusinessSection(detail.text, 'project-approval', 'technical');
  assert.match(approvalSection, /<h2>Project Approval<\/h2>/);
  assert.equal((approvalSection.match(/name="quotationEngineerIds"/g) || []).length, 2);
  assert.match(approvalSection, /Quote Engineer One/);
  assert.match(approvalSection, /Quote Engineer Two/);
  assert.match(approvalSection, /name="technicalPlanSubmitDate" type="date"[^>]*required/);
  assert.match(approvalSection, /Approve/);
  assert.match(approvalSection, /Reject[\s\S]*Reason/);

  const response = await agent
    .post('/opportunities/30/workflow')
    .type('form')
    .send({
      action: ACTIONS.APPROVE_INITIATION,
      quotationEngineerIds: ['3', '8'],
      quotationEngineerLeadId: '3',
      technicalPlanSubmitDate: '2026-09-16'
    });

  assert.equal(response.status, 302);
  assert.equal(getOpportunity().status, STATUSES.TECHNICAL_SOLUTION_IN_PROGRESS);
  assert.equal(getOpportunity().quotationEngineerId, 3);
  assert.equal(getOpportunity().technicalPlanSubmitDate, '2026-09-16');
  assert.deepEqual(calls.filter((call) => call[0] === 'createTodo'), [
    ['createTodo', { opportunityId: 30, assigneeUserId: 3, title: 'Prepare technical solution', dueAt: '2026-09-16T23:59:59+08:00' }],
    ['createTodo', { opportunityId: 30, assigneeUserId: 8, title: 'Prepare technical solution', dueAt: '2026-09-16T23:59:59+08:00' }]
  ]);
  assert.deepEqual(assignmentCalls, [
    ['listMembers', 30],
    ['listMembers', 30],
    ['addMember', {
      opportunityId: 30,
      userId: 8,
      roleCode: ROLES.QUOTATION_ENGINEER,
      permissionLevel: 'edit',
      assignmentScope: 'Technical Proposal',
      taskDescription: 'Prepare technical proposal',
      dueDate: '2026-09-16',
      canSendExternalEmail: false,
      addedBy: 2
    }]
  ]);
  assert.match(calls.find((call) => call[0] === 'createEvent')?.[1]?.comment || '', /Plan to submit: 2026-09-16/);
});

test('workflow actions use the approved compact single-row layout', async () => {
  const { agent } = await createWorkflowAgent({
    user: {
      id: 4,
      username: 'tech01',
      displayName: 'Technical Manager',
      roles: [ROLES.SALES_MANAGER, ROLES.TECHNICAL_MANAGER]
    },
    opportunity: {
      status: STATUSES.TECHNICAL_SOLUTION_PENDING,
      salespersonId: 7,
      salesManagerId: 4,
      quotationEngineerId: 3,
      technicalManagerId: 4
    },
    roleUsers: {
      [ROLES.QUOTATION_ENGINEER]: [{
        id: 3,
        username: 'quote01',
        displayName: 'Quote Engineer',
        roles: [ROLES.QUOTATION_ENGINEER]
      }]
    }
  });

  const detail = await agent.get('/opportunities/30');

  assert.equal(detail.status, 200);
  assert.doesNotMatch(detail.text, /class="workflow-actions-section"/);
  assert.match(detail.text, /class="workflow-action-list stage-workflow-actions"/);
  assert.equal((detail.text.match(/class="workflow-compact-row /g) || []).length, 3);
  assert.match(detail.text, /Change Project Lead Engineer/);
  assert.match(detail.text, /Approve Proposal/);
  assert.match(detail.text, /Reject Proposal/);
  assert.doesNotMatch(detail.text, /name="improvement"/);
  assert.match(detail.text, /\.workflow-compact-row\s*\{[\s\S]*display:\s*flex;[\s\S]*flex-wrap:\s*wrap;/);
  assert.match(detail.text, /\.workflow-action-button\s*\{[\s\S]*flex:\s*0 0 190px;[\s\S]*width:\s*190px;/);
  assert.match(detail.text, /\.workflow-inline-field\s*\{[\s\S]*grid-template-columns:\s*max-content minmax\(0, 1fr\);/);
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
  const contractSection = extractBusinessSection(detail.text, 'contract', 'audit');
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
