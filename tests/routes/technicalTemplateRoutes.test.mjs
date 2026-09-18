import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { ROLES } from '../../src/domain/roles.mjs';
import { hashPassword } from '../../src/services/authService.mjs';
import { createApp } from '../../src/server.mjs';

function csrfToken(html) {
  return html.match(/name="_csrf"\s+value="([^"]+)"/)?.[1] || '';
}

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
    nameEn: 'Mixer Technical Agreement',
    nameZh: '搅拌机技术协议',
    documentType: 'technical_agreement',
    productCategoryCode: 'mixer',
    productFamily: 'Mixing',
    productModel: 'MX-100',
    application: 'Polymerization',
    applicationEn: 'Polymerization',
    applicationZh: '聚合工艺',
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
        sections: [{
          key: 'project_basis', labelEn: 'Project Basis', labelZh: '项目依据',
          bodyEn: 'Customer requirements.', bodyZh: '客户要求。',
          tableRowsEn: [['Item', 'Value']], tableRowsZh: [['项目', '数值']],
          sortOrder: 1, enabled: true, sectionType: 'narrative',
          condition: { operator: 'always', variableKey: '', value: '' }, defaultClauseIds: [30]
        }]
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
        sectionKey: 'project_basis',
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
    title: options.language === 'zh' ? '工厂验收试验' : 'Factory Acceptance Test',
    language: options.clauseLanguage || options.language || 'en',
    productFamily: 'Mixing',
    productModel: '',
    application: '',
    content: options.language === 'zh' ? '应完成并记录工厂验收试验。' : 'A documented FAT shall be completed.',
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
    async updateRevisionContent(revisionId, contentSchema, actorUserId) { calls.push({ method: 'updateRevisionContent', revisionId: Number(revisionId), contentSchema, actorUserId }); return { id: Number(revisionId), templateId: 4 }; },
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
    csrfProtection: options.csrfProtection === true,
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
  const loginPayload = { username: currentUser.username, password: 'ChangeMe123!' };
  if (options.csrfProtection === true) {
    loginPayload._csrf = csrfToken((await agent.get('/login')).text);
  }
  await agent.post('/login').type('form').send(loginPayload);
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
  assert.match(templates.text, /Technical Document Templates/);
  assert.match(templates.text, /MX-100/);
  assert.match(templates.text, /Technical Documents/);
  assert.match(templates.text, /href="\/technical-templates"/);
  assert.match(templates.text, /href="\/technical-clauses"/);
  assert.doesNotMatch(templates.text, /\/bid-center\//);
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

test('technical manager sees only the login-language template content and revision audit data', async () => {
  const { agent } = await createTechnicalTemplateAgent({ language: 'zh', revisionStatus: 'draft' });
  const response = await agent.get('/technical-templates/4');

  assert.equal(response.status, 200);
  assert.match(response.text, /技术资料中心/);
  assert.doesNotMatch(response.text, /标书中心|\/bid-center\//);
  assert.match(response.text, /产品技术资料模板/);
  assert.match(response.text, /TPL-R1/);
  assert.match(response.text, /项目依据/);
  assert.match(response.text, /处理能力/);
  assert.doesNotMatch(response.text, /Project Basis|Capacity/);
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
    documentType: 'technical_agreement',
    productCategoryCode: 'mixer',
    productFamily: 'Reactor',
    productModel: 'RX-1',
    application: 'Polymerization',
    changeSummary: 'Initial revision'
  });
  assert.equal(created.status, 302);
  assert.equal(created.headers.location, '/technical-templates/4');
  assert.equal(calls[0].method, 'createTemplate');
  assert.equal(calls[0].input.templateCode, 'RX-1');
  assert.equal(calls[0].input.nameEn, 'Reactor Agreement');
  assert.equal(calls[0].input.nameZh, null);
  assert.equal(calls[0].input.language, 'bilingual');
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
    label: 'Design Pressure',
    dataType: 'number',
    sourceField: 'pressure',
    isActive: 'on'
  });
  assert.equal(created.status, 302);
  assert.equal(created.headers.location, '/technical-templates/variables');
  assert.equal(calls.at(-1).method, 'createVariableDefinition');
  assert.equal(calls.at(-1).input.labelEn, 'Design Pressure');
  assert.equal(calls.at(-1).input.labelZh, 'design_pressure');

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

test('variable and clause administration render only the login language', async () => {
  const { agent, calls } = await createTechnicalTemplateAgent({
    username: 'adminzh',
    displayName: '管理员',
    roles: [ROLES.ADMINISTRATOR],
    language: 'zh'
  });

  const variables = await agent.get('/technical-templates/variables');
  assert.equal(variables.status, 200);
  assert.match(variables.text, /处理能力/);
  assert.doesNotMatch(variables.text, />Capacity</);

  const variableForm = await agent.get('/technical-templates/variables/new');
  assert.match(variableForm.text, /name="label"/);
  assert.doesNotMatch(variableForm.text, /name="labelEn"|name="labelZh"/);

  const createdVariable = await agent.post('/technical-templates/variables').type('form').send({
    variableKey: 'design_pressure', label: '设计压力', dataType: 'number', sourceField: 'pressure', isActive: 'on'
  });
  assert.equal(createdVariable.status, 302);
  const variableCall = calls.find((call) => call.method === 'createVariableDefinition');
  assert.equal(variableCall.input.labelZh, '设计压力');
  assert.equal(variableCall.input.labelEn, 'design_pressure');
});

test('standard clause routes filter and create using the login language without a language selector', async () => {
  const { agent, calls } = await createTechnicalTemplateAgent({ language: 'zh', clauseStatus: 'draft' });
  const list = await agent.get('/technical-clauses');
  assert.equal(list.status, 200);
  assert.match(list.text, /工厂验收试验/);
  assert.doesNotMatch(list.text, /Factory Acceptance Test|name="language"/);

  const form = await agent.get('/technical-clauses/new');
  assert.equal(form.status, 200);
  assert.doesNotMatch(form.text, /name="language"/);

  const created = await agent.post('/technical-clauses').type('form').send({
    clauseCode: 'fat-zh', title: '工厂验收', language: 'en',
    productFamily: '搅拌机', content: '应执行工厂验收。', changeSummary: '初始版本'
  });
  assert.equal(created.status, 302);
  const clauseCall = calls.find((call) => call.method === 'createClause');
  assert.equal(clauseCall.input.language, 'zh');
});

test('technical manager opens and saves only the login-language section fields', async () => {
  const { agent, calls } = await createTechnicalTemplateAgent({ language: 'zh', revisionStatus: 'draft' });
  const editor = await agent.get('/technical-templates/4/revisions/9/editor');
  assert.equal(editor.status, 200);
  assert.match(editor.text, /技术模板编辑器/);
  assert.match(editor.text, /项目依据/);
  assert.match(editor.text, /结构化表格行/);
  assert.match(editor.text, /FAT-01-R1/);
  assert.match(editor.text, /name="label"/);
  assert.match(editor.text, /name="body"/);
  assert.match(editor.text, /name="columnWidths"/);
  assert.match(editor.text, /name="columnAlignments"/);
  assert.match(editor.text, /name="tableMerges"/);
  assert.match(editor.text, /name="sectionImage"/);
  assert.match(editor.text, /technical-template-editor\.js/);
  assert.doesNotMatch(editor.text, /name="labelEn"|name="labelZh"|name="bodyEn"|name="bodyZh"|Project Basis|Customer requirements\./);

  const saved = await agent.post('/technical-templates/4/revisions/9/sections/project_basis').type('form').send({
    label: '项目依据',
    enabled: 'on',
    sortOrder: 1,
    sectionType: 'narrative',
    body: '客户需求和设计依据。',
    tableRows: '项目 | 数值',
    conditionOperator: 'always',
    defaultClauseIds: 30
  });
  assert.equal(saved.status, 302);
  assert.equal(saved.headers.location, '/technical-templates/4/revisions/9/editor');
  const updateCall = calls.find((call) => call.method === 'updateRevisionContent');
  assert.equal(updateCall.revisionId, 9);
  assert.equal(updateCall.contentSchema.sections[0].bodyZh, '客户需求和设计依据。');
  assert.equal(updateCall.contentSchema.sections[0].bodyEn, 'Customer requirements.');
  assert.deepEqual(updateCall.contentSchema.sections[0].tableRowsEn, [['Item', 'Value']]);
});

test('technical manager saves controlled table layout and a safe section image', async () => {
  const { agent, calls } = await createTechnicalTemplateAgent({ language: 'zh', revisionStatus: 'draft' });
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  const response = await agent
    .post('/technical-templates/4/revisions/9/sections/project_basis')
    .field('label', '项目依据')
    .field('enabled', 'on')
    .field('sortOrder', '1')
    .field('sectionType', 'parameter_table')
    .field('body', '项目设计依据。')
    .field('tableRows', '项目 | 数值\n处理能力 | 10 t/h')
    .field('tableHeaderRow', 'true')
    .field('pageBreakBefore', 'true')
    .field('columnWidths', '40 | 60')
    .field('columnAlignments', 'left | center')
    .field('tableMerges', '1,1,2')
    .field('conditionOperator', 'always')
    .field('defaultClauseIds', '30')
    .field('imageCaption', '工艺布置示意图')
    .field('imageAlignment', 'center')
    .field('imageWidthPercent', '65')
    .attach('sectionImage', png, { filename: 'process.png', contentType: 'image/png' });

  assert.equal(response.status, 302);
  const updateCall = calls.find((call) => call.method === 'updateRevisionContent');
  const section = updateCall.contentSchema.sections[0];
  assert.deepEqual(section.layout.table.columnWidths, [40, 60]);
  assert.deepEqual(section.layout.table.merges, [{ row: 1, column: 1, span: 2 }]);
  assert.equal(section.layout.pageBreakBefore, true);
  assert.equal(section.layout.image.mimeType, 'image/png');
  assert.equal(section.layout.image.captionZh, '工艺布置示意图');
  assert.equal(section.layout.image.widthPercent, 65);
});

test('section image upload validates multipart CSRF before changing a template revision', async () => {
  const { agent, calls } = await createTechnicalTemplateAgent({ revisionStatus: 'draft', csrfProtection: true });
  const editor = await agent.get('/technical-templates/4/revisions/9/editor');
  const token = csrfToken(editor.text);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  assert.ok(token);

  const rejected = await agent
    .post('/technical-templates/4/revisions/9/sections/project_basis')
    .field('label', 'Project Basis')
    .attach('sectionImage', png, { filename: 'process.png', contentType: 'image/png' });
  assert.equal(rejected.status, 403);
  assert.equal(calls.some((call) => call.method === 'updateRevisionContent'), false);

  const accepted = await agent
    .post('/technical-templates/4/revisions/9/sections/project_basis')
    .field('_csrf', token)
    .field('label', 'Project Basis')
    .field('enabled', 'on')
    .field('sortOrder', '1')
    .field('sectionType', 'narrative')
    .field('body', 'Customer requirements.')
    .field('tableRows', 'Item | Value')
    .field('tableHeaderRow', 'true')
    .field('columnWidths', '40 | 60')
    .field('columnAlignments', 'left | left')
    .field('conditionOperator', 'always')
    .field('defaultClauseIds', '30')
    .field('imageCaption', 'Process arrangement')
    .field('imageAlignment', 'center')
    .field('imageWidthPercent', '60')
    .attach('sectionImage', png, { filename: 'process.png', contentType: 'image/png' });
  assert.equal(accepted.status, 302);
  assert.equal(calls.filter((call) => call.method === 'updateRevisionContent').length, 1);
});

test('published template revisions cannot be opened in the editor by direct URL', async () => {
  const { agent } = await createTechnicalTemplateAgent({ revisionStatus: 'published' });
  const response = await agent.get('/technical-templates/4/revisions/9/editor');
  assert.equal(response.status, 409);
});
