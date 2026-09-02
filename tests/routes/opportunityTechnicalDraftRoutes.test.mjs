import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { ROLES } from '../../src/domain/roles.mjs';
import { hashPassword } from '../../src/services/authService.mjs';
import { renderTechnicalDraftContent } from '../../src/services/opportunityTechnicalDraftService.mjs';
import { createApp } from '../../src/server.mjs';

function standardSection(overrides = {}) {
  return {
    key: 'design_parameters', labelEn: 'Design Parameters', labelZh: '设计参数', enabled: true,
    sortOrder: 1, sectionType: 'parameter_table', bodyEn: 'Standard parameters', bodyZh: '标准参数',
    tableRows: [['Item', 'Value']], condition: { operator: 'always', variableKey: '', value: '' },
    defaultClauseIds: [30], blocks: [], ...overrides
  };
}

async function createDraftAgent(options = {}) {
  const currentUser = {
    id: options.userId || 3,
    username: options.username || 'lead01',
    passwordHash: await hashPassword('ChangeMe123!'),
    displayName: options.displayName || 'Lead Engineer',
    isActive: true,
    roles: options.roles || [ROLES.QUOTATION_ENGINEER]
  };
  const opportunity = {
    id: 20,
    opportunityNo: 'OPP-20',
    title: 'Bilingual Mixer Project',
    customerId: 8,
    customerName: 'Acme',
    primaryContactId: 9,
    salespersonId: 7,
    quotationEngineerId: 3,
    technicalManagerId: 6,
    status: 'technical_solution_in_progress'
  };
  const teamMembers = [{
    id: 11, opportunityId: 20, userId: 4, username: 'support01', userDisplayName: 'Support Engineer',
    roleCode: ROLES.QUOTATION_ENGINEER, isActive: true
  }];
  const variables = [{
    variableKey: 'capacity', labelEn: 'Capacity', labelZh: '处理能力', dataType: 'number',
    sourceField: 'capacity', sectionKey: 'design_parameters', isRequired: true, defaultValue: '',
    validationRules: { min: 1, max: 100 }
  }];
  const contentSchema = { schemaVersion: 1, sections: [standardSection(), standardSection({
    key: 'utilities', labelEn: 'Utilities', labelZh: '公用工程', sortOrder: 2, defaultClauseIds: []
  })] };
  const clause = {
    id: 30, clauseCode: 'FAT-01', revisionNo: 1, revisionLabel: 'FAT-01-R1', title: 'Factory Acceptance Test',
    language: 'bilingual', content: 'Documented FAT required.', conditionSchema: {}, status: 'published'
  };
  const template = {
    id: 5, templateCode: 'MX-100', name: 'Mixer Agreement', productFamily: 'Mixing', productModel: 'MX-100',
    language: 'bilingual', isActive: true, currentPublishedRevisionId: 9,
    currentRevisionLabel: 'TPL-R1', revisions: [{ id: 9, revisionNo: 1, status: 'published', contentSchema, variables }]
  };
  const selectedClauses = [{ ...clause, sectionKey: 'design_parameters', isTemplateDefault: true, standardChanged: false }];
  const variableValues = { capacity: options.capacity ?? '' };
  const draft = {
    id: 41,
    opportunityId: 20,
    templateRevisionId: 9,
    draftRevisionNo: 1,
    draftLabel: 'TS-D1',
    status: options.draftStatus || 'draft',
    language: 'bilingual',
    templateCodeSnapshot: 'MX-100',
    templateNameSnapshot: 'Mixer Agreement',
    templateRevisionNoSnapshot: 1,
    contentSchemaSnapshot: contentSchema,
    variableSchemaSnapshot: variables,
    variableValues,
    selectedClauses,
    renderedContent: renderTechnicalDraftContent({ contentSchema, variableSchema: variables, variableValues, selectedClauses }),
    validationIssues: variableValues.capacity === '' ? [{ variableKey: 'capacity', sectionKey: 'design_parameters', code: 'required', labelEn: 'Capacity', labelZh: '处理能力' }] : [],
    assignments: [{ id: 70, technicalDraftId: 41, sectionKey: 'design_parameters', assigneeUserId: 4, assigneeDisplayName: 'Support Engineer', isActive: true }],
    events: [{ id: 1, eventType: 'created', sectionKey: '', actorUserId: 3, actorDisplayName: 'Lead Engineer', createdAt: '2026-09-02' }],
    createdBy: 3,
    updatedBy: 3,
    updatedByDisplayName: 'Lead Engineer',
    updatedAt: '2026-09-02'
  };
  const calls = [];
  const opportunityTechnicalDraftRepository = {
    async getGenerationContext(id) { calls.push(['getGenerationContext', Number(id)]); return { customerName: 'Acme', opportunityTitle: opportunity.title, productName: 'Mixer', opportunityOwner: 'Sales One' }; },
    async listByOpportunity(id) { calls.push(['listByOpportunity', Number(id)]); return [draft]; },
    async getDraftDetail(id) { calls.push(['getDraftDetail', Number(id)]); return Number(id) === 41 ? draft : null; },
    async createDraft(input) { calls.push(['createDraft', input]); return { ...draft, ...input }; },
    async updateVariables(input) { calls.push(['updateVariables', input]); return { ...draft, ...input }; },
    async updateSection(input) { calls.push(['updateSection', input]); return { ...draft, ...input }; },
    async updateClauses(input) { calls.push(['updateClauses', input]); return { ...draft, ...input }; },
    async addAssignment(input) { calls.push(['addAssignment', input]); return { id: 71, ...input }; },
    async removeAssignment(input) { calls.push(['removeAssignment', input]); return { id: input.assignmentId }; },
    async markReady(input) { calls.push(['markReady', input]); return { ...draft, status: 'ready' }; }
  };
  const technicalTemplateRepository = {
    async listTemplates(filter) { calls.push(['listTemplates', filter]); return [template]; },
    async getTemplateDetail(id) { calls.push(['getTemplateDetail', Number(id)]); return Number(id) === 5 ? template : null; },
    async listClauses(filter) { calls.push(['listClauses', filter]); return [clause]; }
  };
  const app = createApp({
    sessionSecret: 'test-secret',
    csrfProtection: false,
    userRepository: {
      async findByIdWithRoles(id) { return Number(id) === currentUser.id ? currentUser : null; },
      async findByUsernameWithRoles(username) { return username === currentUser.username ? currentUser : null; },
      async listUsersByRole() { return []; }
    },
    opportunityRepository: {
      async getOpportunityDetail(id) { return Number(id) === 20 ? opportunity : null; },
      async listOpportunities() { return []; }
    },
    opportunityResponsibilityRepository: {
      async listTeamMembersByOpportunity() { return teamMembers; }
    },
    technicalTemplateRepository,
    opportunityTechnicalDraftRepository
  });
  const agent = request.agent(app);
  if (options.language) await agent.get(`/language?lang=${options.language}&returnTo=/login`);
  await agent.post('/login').type('form').send({ username: currentUser.username, password: 'ChangeMe123!' });
  return { agent, calls, draft };
}

test('anonymous users are redirected from project technical draft routes', async () => {
  const app = createApp({ databaseUrl: '', sessionSecret: 'test-secret' });
  const response = await request(app).get('/opportunities/20/technical-drafts');
  assert.equal(response.status, 302);
  assert.equal(response.headers.location, '/login');
});

test('Project Lead Engineer sees bilingual draft list and can generate from a published template', async () => {
  const { agent, calls } = await createDraftAgent({ language: 'zh' });
  const list = await agent.get('/opportunities/20/technical-drafts');
  assert.equal(list.status, 200);
  assert.match(list.text, /项目技术方案草稿/);
  assert.match(list.text, /TS-D1/);
  assert.match(list.text, /生成技术方案草稿/);

  const created = await agent.post('/opportunities/20/technical-drafts').type('form').send({ templateId: 5 });
  assert.equal(created.status, 302);
  assert.equal(created.headers.location, '/opportunities/20/technical-drafts/41');
  assert.ok(calls.some(([method]) => method === 'createDraft'));
});

test('draft detail shows snapshot validation structured sections clauses and contribution history', async () => {
  const { agent } = await createDraftAgent({ language: 'zh' });
  const response = await agent.get('/opportunities/20/technical-drafts/41');
  assert.equal(response.status, 200);
  assert.match(response.text, /MX-100/);
  assert.match(response.text, /TPL-R1/);
  assert.match(response.text, /处理能力/);
  assert.match(response.text, /缺少必填值/);
  assert.match(response.text, /标准条款选择/);
  assert.match(response.text, /FAT-01-R1/);
  assert.match(response.text, /草稿贡献历史/);
});

test('sales owner can read the generated project draft but cannot mutate engineering content', async () => {
  const { agent } = await createDraftAgent({ userId: 7, username: 'sales01', roles: [ROLES.SALESPERSON] });
  const detail = await agent.get('/opportunities/20/technical-drafts/41');
  assert.equal(detail.status, 200);
  assert.doesNotMatch(detail.text, /保存项目章节/);
  const mutation = await agent.post('/opportunities/20/technical-drafts/41/sections/design_parameters').type('form').send({ bodyEn: 'Changed' });
  assert.equal(mutation.status, 403);
});

test('Supporting Engineer edits an assigned section but cannot edit an unassigned section', async () => {
  const { agent, calls } = await createDraftAgent({ userId: 4, username: 'support01', displayName: 'Support Engineer' });
  const assigned = await agent.post('/opportunities/20/technical-drafts/41/sections/design_parameters').type('form').send({
    bodyEn: 'Project parameters', bodyZh: '项目参数', tableRows: 'Capacity | 20 t/h'
  });
  assert.equal(assigned.status, 302);
  assert.ok(calls.some(([method, input]) => method === 'updateSection' && input.sectionKey === 'design_parameters' && input.actorUserId === 4));

  const denied = await agent.post('/opportunities/20/technical-drafts/41/sections/utilities').type('form').send({ bodyEn: 'Changed utilities' });
  assert.equal(denied.status, 403);
});

test('only the Project Lead Engineer assigns sections and changes controlled clauses', async () => {
  const { agent, calls } = await createDraftAgent();
  const assigned = await agent.post('/opportunities/20/technical-drafts/41/assignments').type('form').send({
    sectionKey: 'utilities', assigneeUserId: 4, dueDate: '2026-09-10'
  });
  assert.equal(assigned.status, 302);
  const clauses = await agent.post('/opportunities/20/technical-drafts/41/clauses').type('form').send({ clauseIds: 30 });
  assert.equal(clauses.status, 302);
  assert.ok(calls.some(([method]) => method === 'addAssignment'));
  assert.ok(calls.some(([method]) => method === 'updateClauses'));
});

test('readiness returns a conflict while required project variables are missing', async () => {
  const { agent } = await createDraftAgent();
  const response = await agent.post('/opportunities/20/technical-drafts/41/readiness').type('form').send();
  assert.equal(response.status, 409);
  assert.match(response.text, /engineering-range variables/);
});

test('valid project values can be saved and marked ready by the Lead Engineer', async () => {
  const { agent, calls } = await createDraftAgent({ capacity: 50 });
  const variableSave = await agent.post('/opportunities/20/technical-drafts/41/variables').type('form').send({ capacity: 60 });
  assert.equal(variableSave.status, 302);
  const ready = await agent.post('/opportunities/20/technical-drafts/41/readiness').type('form').send();
  assert.equal(ready.status, 302);
  assert.ok(calls.some(([method]) => method === 'updateVariables'));
  assert.ok(calls.some(([method]) => method === 'markReady'));
});
