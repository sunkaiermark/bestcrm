import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { ROLES } from '../../src/domain/roles.mjs';
import { hashPassword } from '../../src/services/authService.mjs';
import { createApp } from '../../src/server.mjs';

async function createTechnicalTemplateAgent(options = {}) {
  const currentUser = {
    id: options.userId || 7,
    username: options.username || 'tech01',
    passwordHash: await hashPassword('ChangeMe123!'),
    displayName: options.displayName || 'Technical Manager',
    isActive: true,
    roles: options.roles || [ROLES.TECHNICAL_MANAGER]
  };
  const revisionStatus = options.revisionStatus || 'published';
  const template = {
    id: 4,
    templateCode: 'MX-100',
    name: 'Mixer Technical Agreement',
    productFamily: 'Mixing',
    productModel: 'MX-100',
    application: 'Polymerization',
    language: 'bilingual',
    currentPublishedRevisionId: revisionStatus === 'published' ? 9 : null,
    currentRevisionNo: revisionStatus === 'published' ? 1 : null,
    currentRevisionLabel: revisionStatus === 'published' ? 'TPL-R1' : '',
    currentRevisionStatus: revisionStatus === 'published' ? 'published' : '',
    latestRevisionNo: 1,
    latestRevisionStatus: revisionStatus,
    isActive: options.templateActive !== false,
    createdBy: 7,
    updatedBy: 7,
    createdAt: '2026-09-02T01:00:00.000Z',
    updatedAt: '2026-09-02T02:00:00.000Z',
    revisions: [{
      id: 9,
      templateId: 4,
      revisionNo: 1,
      revisionLabel: 'TPL-R1',
      status: revisionStatus,
      changeSummary: 'Initial controlled revision',
      contentSchema: {
        schemaVersion: 1,
        sections: [{ key: 'project_basis', labelEn: 'Project Basis', labelZh: '项目依据' }]
      },
      createdBy: 7,
      createdByDisplayName: 'Technical Manager',
      submittedByDisplayName: revisionStatus === 'draft' ? '' : 'Technical Manager',
      publishedByDisplayName: revisionStatus === 'published' ? 'Technical Manager' : '',
      retiredByDisplayName: '',
      variables: [{
        id: 12,
        templateRevisionId: 9,
        variableDefinitionId: 3,
        variableKey: 'capacity',
        labelEn: 'Capacity',
        labelZh: '处理能力',
        dataType: 'number',
        sourceField: 'capacity',
        isRequired: true,
        defaultValue: '',
        validationRules: { min: 1 },
        sortOrder: 1
      }]
    }],
    events: [{
      id: 21,
      templateId: 4,
      entityType: 'revision',
      entityId: 9,
      eventType: revisionStatus === 'published' ? 'published' : 'created',
      fromStatus: revisionStatus === 'published' ? 'review_pending' : '',
      toStatus: revisionStatus,
      actorUserId: 7,
      actorDisplayName: 'Technical Manager',
      details: {},
      createdAt: '2026-09-02T02:00:00.000Z'
    }]
  };
  const definition = {
    id: 3,
    variableKey: 'capacity',
    labelEn: 'Capacity',
    labelZh: '处理能力',
    dataType: 'number',
    sourceField: 'capacity',
    isActive: true,
    createdBy: 7,
    updatedBy: 7,
    createdAt: '2026-09-02',
    updatedAt: '2026-09-02'
  };
  const clause = {
    id: 30,
    clauseCode: 'FAT-01',
    revisionNo: 1,
    revisionLabel: 'FAT-01-R1',
    title: 'Factory Acceptance Test',
    language: 'bilingual',
    productFamily: 'Mixing',
    productModel: '',
    application: '',
    content: 'A documented FAT shall be completed.',
    conditionSchema: { all: [] },
    status: options.clauseStatus || 'published',
    changeSummary: 'Initial clause',
    createdBy: 7,
    createdByDisplayName: 'Technical Manager'
  };
  const calls = [];
  const technicalTemplateRepository = {
    async listTemplates(filter) { calls.push({ method: 'listTemplates', filter }); return [template]; },
    async getTemplateDetail(id) { calls.push({ method: 'getTemplateDetail', id: Number(id) }); return Number(id) === 4 ? template : null; },
    async findRevisionById(id) { return Number(id) === 9 ? template.revisions[0] : null; },
    async createTemplate(input, actorUserId) { calls.push({ method: 'createTemplate', input, actorUserId }); return { id: 4, revisionId: 9 }; },
    async updateTemplate(id, input, actorUserId) { calls.push({ method: 'updateTemplate', id: Number(id), input, actorUserId }); return { id: Number(id) }; },
    async createRevision(templateId, changeSummary, actorUserId) { calls.push({ method: 'createRevision', templateId: Number(templateId), changeSummary, actorUserId }); return { id: 10, templateId: Number(templateId), revisionNo: 2 }; },
    async submitRevision(revisionId, actorUserId) { calls.push({ method: 'submitRevision', revisionId: Number(revisionId), actorUserId }); return { id: Number(revisionId), templateId: 4 }; },
    async publishRevision(revisionId, actorUserId) { calls.push({ method: 'publishRevision', revisionId: Number(revisionId), actorUserId }); return { id: Number(revisionId), templateId: 4 }; },
    async retireRevision(revisionId, actorUserId) { calls.push({ method: 'retireRevision', revisionId: Number(revisionId), actorUserId }); return { id: Number(revisionId), templateId: 4 }; },
    async upsertRevisionVariable(revisionId, input, actorUserId) { calls.push({ method: 'upsertRevisionVariable', revisionId: Number(revisionId), input, actorUserId }); return { id: 12, templateRevisionId: Number(revisionId), ...input }; },
    async removeRevisionVariable(revisionId, variableId, actorUserId) { calls.push({ method: 'removeRevisionVariable', revisionId: Number(revisionId), variableId: Number(variableId), actorUserId }); return { id: Number(variableId), templateId: 4 }; },
    async listVariableDefinitions(filter) { calls.push({ method: 'listVariableDefinitions', filter }); return [definition]; },
    async findVariableDefinitionById(id) { return Number(id) === 3 ? definition : null; },
    async createVariableDefinition(input, actorUserId) { calls.push({ method: 'createVariableDefinition', input, actorUserId }); return { id: 3, ...input }; },
    async updateVariableDefinition(id, input, actorUserId) { calls.push({ method: 'updateVariableDefinition', id: Number(id), input, actorUserId }); return { id: Number(id), ...input }; },
    async deactivateVariableDefinition(id, actorUserId) { calls.push({ method: 'deactivateVariableDefinition', id: Number(id), actorUserId }); return { id: Number(id), isActive: false }; },
    async listClauses(filter) { calls.push({ method: 'listClauses', filter }); return [clause]; },
    async findClauseById(id) { return Number(id) === 30 ? clause : null; },
    async createClause(input, actorUserId) { calls.push({ method: 'createClause', input, actorUserId }); return { id: 30, ...input }; },
    async updateClause(id, input, actorUserId) { calls.push({ method: 'updateClause', id: Number(id), input, actorUserId }); return { id: Number(id), ...clause, ...input }; },
    async createClauseRevision(id, changeSummary, actorUserId) { calls.push({ method: 'createClauseRevision', id: Number(id), changeSummary, actorUserId }); return { id: 31, clauseCode: clause.clauseCode, revisionNo: 2 }; },
    async submitClause(id, actorUserId) { calls.push({ method: 'submitClause', id: Number(id), actorUserId }); return { ...clause, id: Number(id), status: 'review_pending' }; },
    async publishClause(id, actorUserId) { calls.push({ method: 'publishClause', id: Number(id), actorUserId }); return { ...clause, id: Number(id), status: 'published' }; },
    async retireClause(id, actorUserId) { calls.push({ method: 'retireClause', id: Number(id), actorUserId }); return { ...clause, id: Number(id), status: 'retired' }; }
  };
  const app = createApp({
    sessionSecret: 'test-secret',
    csrfProtection: false,
    userRepository: {
      async findByIdWithRoles(id) { return Number(id) === currentUser.id ? currentUser : null; },
      async findByUsernameWithRoles(username) { return username === currentUser.username ? currentUser : null; }
    },
    technicalTemplateRepository
  });
  const agent = request.agent(app);
  if (options.language) {
    await agent.get(`/language?lang=${options.language}&returnTo=/login`);
  }
  await agent.post('/login').type('form').send({ username: currentUser.username, password: 'ChangeMe123!' });
  return { agent, calls, template, definition, clause };
}

test('anonymous users are redirected from technical template and clause libraries', async () => {
  const app = createApp({ databaseUrl: '', sessionSecret: 'test-secret' });
  for (const path of ['/technical-templates', '/technical-clauses']) {
    const response = await request(app).get(path);
    assert.equal(response.status, 302);
    assert.equal(response.headers.location, '/login');
  }
});

test('salespeople cannot view or mutate technical template routes directly', async () => {
  const { agent, calls } = await createTechnicalTemplateAgent({
    username: 'sales01',
    displayName: 'Sales User',
    roles: [ROLES.SALESPERSON]
  });
  for (const requestCall of [
    () => agent.get('/technical-templates'),
    () => agent.get('/technical-templates/4'),
    () => agent.post('/technical-templates').type('form').send({}),
    () => agent.get('/technical-clauses'),
    () => agent.post('/technical-clauses/30/publish').type('form').send({})
  ]) {
    const response = await requestCall();
    assert.equal(response.status, 403);
    assert.match(response.text, /Forbidden/);
  }
  assert.deepEqual(calls, []);
});

test('quotation engineers only receive published templates and clauses', async () => {
  const { agent, calls } = await createTechnicalTemplateAgent({
    username: 'quote01',
    displayName: 'Quotation Engineer',
    roles: [ROLES.QUOTATION_ENGINEER]
  });

  const templates = await agent.get('/technical-templates');
  assert.equal(templates.status, 200);
  assert.match(templates.text, /Technical Agreement Templates/);
  assert.match(templates.text, /MX-100/);
  assert.match(templates.text, /href="\/technical-templates"/);
  assert.match(templates.text, /href="\/technical-clauses"/);
  assert.doesNotMatch(templates.text, /New Technical Template/);
  assert.deepEqual(calls[0], { method: 'listTemplates', filter: { publishedOnly: true } });

  const clauses = await agent.get('/technical-clauses');
  assert.equal(clauses.status, 200);
  assert.match(clauses.text, /FAT-01-R1/);
  assert.deepEqual(calls.at(-1), { method: 'listClauses', filter: { publishedOnly: true } });
});

test('quotation engineers cannot open a draft template by direct URL', async () => {
  const { agent } = await createTechnicalTemplateAgent({
    username: 'quote01',
    roles: [ROLES.QUOTATION_ENGINEER],
    revisionStatus: 'draft'
  });
  const response = await agent.get('/technical-templates/4');
  assert.equal(response.status, 403);
  assert.match(response.text, /Forbidden/);
});

test('technical manager sees bilingual template controls and revision audit data', async () => {
  const { agent } = await createTechnicalTemplateAgent({ language: 'zh', revisionStatus: 'draft' });
  const response = await agent.get('/technical-templates/4');

  assert.equal(response.status, 200);
  assert.match(response.text, /产品技术协议模板/);
  assert.match(response.text, /TPL-R1/);
  assert.match(response.text, /项目依据/);
  assert.match(response.text, /处理能力/);
  assert.match(response.text, /安全变量目录/);
  assert.match(response.text, /提交审核/);
  assert.match(response.text, /模板审计历史/);
  assert.match(response.text, /name="variableDefinitionId"/);
  assert.match(response.text, /name="isRequired"/);
  assert.match(response.text, /name="_csrf"/);
});

test('technical manager creates and advances template revisions through controlled routes', async () => {
  const { agent, calls } = await createTechnicalTemplateAgent({ revisionStatus: 'draft' });

  const created = await agent.post('/technical-templates').type('form').send({
    templateCode: 'rx-1',
    name: 'Reactor Agreement',
    productFamily: 'Reactor',
    productModel: 'RX-1',
    application: 'Polymerization',
    language: 'en',
    changeSummary: 'Initial revision'
  });
  assert.equal(created.status, 302);
  assert.equal(created.headers.location, '/technical-templates/4');
  assert.equal(calls[0].method, 'createTemplate');
  assert.equal(calls[0].input.templateCode, 'RX-1');
  assert.equal(calls[0].input.contentSchema.sections.length, 18);

  const submitted = await agent.post('/technical-templates/4/revisions/9/submit').type('form').send();
  const published = await agent.post('/technical-templates/4/revisions/9/publish').type('form').send();
  const retired = await agent.post('/technical-templates/4/revisions/9/retire').type('form').send();
  assert.equal(submitted.status, 302);
  assert.equal(published.status, 302);
  assert.equal(retired.status, 302);
  assert.deepEqual(calls.slice(1, 4), [
    { method: 'submitRevision', revisionId: 9, actorUserId: 7 },
    { method: 'publishRevision', revisionId: 9, actorUserId: 7 },
    { method: 'retireRevision', revisionId: 9, actorUserId: 7 }
  ]);
});

test('technical manager configures draft variables and controlled standard clauses', async () => {
  const { agent, calls } = await createTechnicalTemplateAgent({ revisionStatus: 'draft', clauseStatus: 'draft' });

  const variable = await agent.post('/technical-templates/4/revisions/9/variables').type('form').send({
    variableDefinitionId: '3',
    isRequired: 'on',
    minValue: '1',
    maxValue: '100',
    allowedValues: '10,20',
    sortOrder: '2'
  });
  assert.equal(variable.status, 302);
  assert.equal(calls[0].method, 'upsertRevisionVariable');
  assert.deepEqual(calls[0].input.validationRules, { min: 1, max: 100, allowedValues: ['10', '20'] });

  const clause = await agent.post('/technical-clauses').type('form').send({
    clauseCode: 'fat-02',
    title: 'Factory Acceptance Test',
    language: 'bilingual',
    productFamily: 'Mixing',
    content: 'A documented FAT shall be completed.',
    changeSummary: 'Initial controlled clause'
  });
  assert.equal(clause.status, 302);
  assert.equal(clause.headers.location, '/technical-clauses');
  assert.equal(calls[1].method, 'createClause');
  assert.equal(calls[1].input.clauseCode, 'FAT-02');
  assert.deepEqual(calls[1].input.conditionSchema, { all: [] });
});

test('administrator manages safe variables but cannot publish technical content', async () => {
  const { agent, calls } = await createTechnicalTemplateAgent({
    username: 'admin01',
    displayName: 'Administrator',
    roles: [ROLES.ADMINISTRATOR]
  });

  const list = await agent.get('/technical-templates/variables');
  assert.equal(list.status, 200);
  assert.match(list.text, /Safe Variable Catalogue/);
  assert.match(list.text, /capacity/);

  const created = await agent.post('/technical-templates/variables').type('form').send({
    variableKey: 'design_pressure',
    labelEn: 'Design Pressure',
    labelZh: '设计压力',
    dataType: 'number',
    sourceField: 'pressure',
    isActive: 'on'
  });
  assert.equal(created.status, 302);
  assert.equal(created.headers.location, '/technical-templates/variables');
  assert.equal(calls.at(-1).method, 'createVariableDefinition');

  for (const requestCall of [
    () => agent.get('/technical-templates/new'),
    () => agent.post('/technical-templates').type('form').send({}),
    () => agent.post('/technical-templates/4/revisions/9/publish').type('form').send(),
    () => agent.get('/technical-clauses/new'),
    () => agent.post('/technical-clauses/30/publish').type('form').send()
  ]) {
    const response = await requestCall();
    assert.equal(response.status, 403);
    assert.match(response.text, /Forbidden/);
  }
});
