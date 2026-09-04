import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { ROLES } from '../../src/domain/roles.mjs';
import { hashPassword } from '../../src/services/authService.mjs';
import { createApp } from '../../src/server.mjs';

function csrfToken(html) {
  return html.match(/name="_csrf"\s+value="([^"]+)"/)?.[1] || '';
}

function commercialTemplate(status = 'draft') {
  return {
    id: 4, templateCode: 'COMM-GLOBAL', nameEn: 'Global Commercial Package', nameZh: '全球商务包',
    language: 'bilingual', applicableCountries: ['CN'], applicableIndustries: ['Chemical'], applicableCustomerTypes: [],
    currentPublishedRevisionId: status === 'published' ? 9 : null, currentRevisionLabel: status === 'published' ? 'CTPL-R1' : '',
    latestRevisionStatus: status, isActive: status === 'published',
    revisions: [{
      id: 9, revisionNo: 1, revisionLabel: 'CTPL-R1', status, changeSummary: 'Initial controlled revision',
      contentSchema: { schemaVersion: 1, sections: [{ key: 'commercial_cover', labelEn: 'Commercial Cover and Contents', labelZh: '商务封面和目录', sectionType: 'narrative', enabled: true, sortOrder: 1, bodyEn: '', bodyZh: '', tableRows: [], contentBlockIds: [] }] },
      createdBy: 5, createdByDisplayName: 'Commercial Manager', submittedByDisplayName: '', publishedByDisplayName: '', retiredByDisplayName: ''
    }]
  };
}

function contentBlock(overrides = {}) {
  return {
    id: 8, blockCode: 'PAYMENT-01', category: 'commercial', nameEn: 'Payment Terms', nameZh: '付款条件',
    applicableCountries: [], applicableIndustries: [], applicableProductFamilies: [], applicableCustomerTypes: [], applicableSections: ['payment_terms'],
    ownerRoleCode: ROLES.COMMERCIAL_MANAGER, currentPublishedRevisionId: 30, currentRevisionNo: 1,
    currentRevisionStatus: 'published', latestRevisionNo: 1, latestRevisionLabel: 'PAYMENT-01-R1', latestRevisionStatus: 'published',
    libraryType: 'standard_clause', language: 'bilingual', componentType: 'narrative', titleEn: 'Payment', titleZh: '付款',
    sensitivity: 'confidential', currentSensitivity: 'confidential', effectiveDate: '2026-09-01', expiresAt: null, isActive: true,
    revisions: [{
      id: 30, contentBlockId: 8, blockCode: 'PAYMENT-01', revisionNo: 1, revisionLabel: 'PAYMENT-01-R1', status: 'published',
      language: 'bilingual', componentType: 'narrative', titleEn: 'Payment', titleZh: '付款', bodyEn: 'Net payment terms.', bodyZh: '付款条款。', tableRows: [],
      sourceMetadata: { libraryType: 'standard_clause', sourceReference: 'Policy C-1' }, libraryType: 'standard_clause',
      attachmentStoredPath: '', attachmentOriginalName: '', attachmentMimeType: '', attachmentByteSize: null, attachmentSha256: '',
      effectiveDate: '2026-09-01', expiresAt: null, sensitivity: 'confidential', changeSummary: 'Initial'
    }],
    ...overrides
  };
}

async function createAgent({ role = ROLES.COMMERCIAL_MANAGER, enabled = true, language, templateStatus = 'draft', blockOverrides = {}, uploadDir, csrfProtection = false, maxUploadMb } = {}) {
  const currentUser = {
    id: role === ROLES.COMMERCIAL_MANAGER ? 5 : 7,
    username: `user-${role}`,
    passwordHash: await hashPassword('ChangeMe123!'),
    displayName: role,
    isActive: true,
    roles: [role]
  };
  const template = commercialTemplate(templateStatus);
  const block = contentBlock(blockOverrides);
  const calls = [];
  const commercialPackageTemplateRepository = {
    async listTemplates(filter) { calls.push({ method: 'listCommercial', filter }); return [template]; },
    async getTemplateDetail(id) { calls.push({ method: 'getCommercial', id: Number(id) }); return Number(id) === 4 ? structuredClone(template) : null; },
    async createTemplate(input, actorUserId) { calls.push({ method: 'createCommercial', input, actorUserId }); return { id: 4, revisionId: 9 }; },
    async updateTemplate() { return { id: 4 }; },
    async createRevision() { return { id: 10, templateId: 4, revisionNo: 2 }; },
    async updateRevisionContent(revisionId, contentSchema) { calls.push({ method: 'updateCommercialSection', revisionId: Number(revisionId), contentSchema }); return { id: Number(revisionId), templateId: 4 }; },
    async submitRevision(revisionId, actorUserId) { calls.push({ method: 'submitCommercial', revisionId: Number(revisionId), actorUserId }); template.revisions[0].status = 'review_pending'; return { id: Number(revisionId), templateId: 4 }; },
    async publishRevision(revisionId, actorUserId) { calls.push({ method: 'publishCommercial', revisionId: Number(revisionId), actorUserId }); template.revisions[0].status = 'published'; return { id: Number(revisionId), templateId: 4 }; },
    async retireRevision(revisionId, actorUserId) { calls.push({ method: 'retireCommercial', revisionId: Number(revisionId), actorUserId }); template.revisions[0].status = 'retired'; return { id: Number(revisionId), templateId: 4 }; }
  };
  const bidContentBlockRepository = {
    async listBlocks(filter) { calls.push({ method: 'listContent', filter }); return [block]; },
    async getBlockDetail(id) { calls.push({ method: 'getContent', id: Number(id) }); return Number(id) === 8 ? structuredClone(block) : null; },
    async createBlock(input, actorUserId) { calls.push({ method: 'createContent', input, actorUserId }); return { id: 8, revisionId: 30 }; },
    async updateDraft() { return { id: 30, contentBlockId: 8 }; },
    async createRevision() { return { id: 31, contentBlockId: 8, revisionNo: 2 }; },
    async submitRevision(revisionId, actorUserId) { calls.push({ method: 'submitContent', revisionId: Number(revisionId), actorUserId }); return { id: Number(revisionId), contentBlockId: 8 }; },
    async publishRevision(revisionId, actorUserId) { calls.push({ method: 'publishContent', revisionId: Number(revisionId), actorUserId }); return { id: Number(revisionId), contentBlockId: 8 }; },
    async retireRevision(revisionId, actorUserId) { calls.push({ method: 'retireContent', revisionId: Number(revisionId), actorUserId }); return { id: Number(revisionId), contentBlockId: 8 }; }
  };
  const appOptions = {
    sessionSecret: 'test-secret', csrfProtection, bidCenter: { enabled },
    userRepository: {
      async findByIdWithRoles(id) { return Number(id) === currentUser.id ? currentUser : null; },
      async findByUsernameWithRoles(username) { return username === currentUser.username ? currentUser : null; }
    },
    commercialPackageTemplateRepository,
    bidContentBlockRepository
  };
  if (uploadDir !== undefined) appOptions.uploadDir = uploadDir;
  if (maxUploadMb !== undefined) appOptions.maxUploadMb = maxUploadMb;
  const app = createApp(appOptions);
  const agent = request.agent(app);
  if (language) await agent.get(`/language?lang=${language}&returnTo=/login`);
  const loginPayload = { username: currentUser.username, password: 'ChangeMe123!' };
  if (csrfProtection) loginPayload._csrf = csrfToken((await agent.get('/login')).text);
  await agent.post('/login').type('form').send(loginPayload);
  return { agent, calls, template, block };
}

test('bid center stays invisible and returns 404 while its feature flag is off', async () => {
  const { agent, calls } = await createAgent({ enabled: false });
  const workbench = await agent.get('/workbench');
  assert.equal(workbench.status, 200);
  assert.doesNotMatch(workbench.text, /Bid Center/);
  const direct = await agent.get('/bid-center/commercial-templates');
  assert.equal(direct.status, 404);
  assert.match(direct.text, /Bid center is disabled/);
  assert.deepEqual(calls, []);
});

test('enabled bilingual navigation uses the frozen Bid Center structure without relabeling legacy URLs', async () => {
  const { agent } = await createAgent({ enabled: true, language: 'zh', role: ROLES.ADMINISTRATOR });
  const response = await agent.get('/workbench');
  assert.equal(response.status, 200);
  assert.match(response.text, /标书中心/);
  assert.match(response.text, /项目标书/);
  assert.match(response.text, /href="\/technical-templates">技术包/);
  assert.match(response.text, /href="\/bid-center\/commercial-templates">商务包/);
  assert.match(response.text, /href="\/bid-center\/clauses">标准条款/);
  assert.match(response.text, /href="\/bid-center\/public-materials">公共资料库/);
  assert.match(response.text, /输出记录/);
  assert.doesNotMatch(response.text, />技术标准</);
});

test('Commercial Manager creates and advances a CTPL revision through controlled routes', async () => {
  const { agent, calls } = await createAgent();
  const list = await agent.get('/bid-center/commercial-templates');
  assert.equal(list.status, 200);
  assert.match(list.text, /Commercial Packages/);
  const created = await agent.post('/bid-center/commercial-templates').type('form').send({
    templateCode: 'comm-global', nameEn: 'Global Commercial Package', nameZh: '全球商务包',
    language: 'bilingual', applicableCountries: 'CN, SG', changeSummary: 'Initial'
  });
  assert.equal(created.status, 302);
  assert.equal(created.headers.location, '/bid-center/commercial-templates/4');
  assert.equal(calls.find((call) => call.method === 'createCommercial').input.contentSchema.sections.length, 20);
  for (const action of ['submit', 'publish', 'retire']) {
    const response = await agent.post(`/bid-center/commercial-templates/4/revisions/9/${action}`).type('form').send();
    assert.equal(response.status, 302);
  }
  assert.ok(calls.some((call) => call.method === 'publishCommercial'));
});

test('technical-only roles cannot view commercial templates or sensitive commercial content by direct URL', async () => {
  const { agent, calls } = await createAgent({ role: ROLES.TECHNICAL_MANAGER });
  for (const pathValue of ['/bid-center/commercial-templates', '/bid-center/commercial-templates/4', '/bid-center/clauses/8']) {
    const response = await agent.get(pathValue);
    assert.equal(response.status, 403);
    assert.match(response.text, /Forbidden/);
  }
  assert.equal(calls.filter((call) => call.method === 'createCommercial' || call.method === 'publishContent').length, 0);
});

test('Administrator can inspect but cannot publish commercial or technical-owned content', async () => {
  const { agent, calls } = await createAgent({ role: ROLES.ADMINISTRATOR, templateStatus: 'published' });
  assert.equal((await agent.get('/bid-center/commercial-templates/4')).status, 200);
  assert.equal((await agent.get('/bid-center/clauses/8')).status, 200);
  assert.equal((await agent.post('/bid-center/commercial-templates/4/revisions/9/publish').type('form').send()).status, 403);
  assert.equal((await agent.post('/bid-center/clauses/8/revisions/30/publish').type('form').send()).status, 403);
  assert.equal(calls.filter((call) => call.method === 'publishCommercial' || call.method === 'publishContent').length, 0);
});

test('standard clause filters remain distinct from public materials', async () => {
  const { agent, calls } = await createAgent({ blockOverrides: { sensitivity: 'internal', currentSensitivity: 'internal' } });
  const clauses = await agent.get('/bid-center/clauses?category=commercial');
  assert.equal(clauses.status, 200);
  assert.match(clauses.text, /Standard Clauses/);
  assert.match(clauses.text, /Existing technical clauses remain compatible/);
  const publicMaterials = await agent.get('/bid-center/public-materials?category=common');
  assert.equal(publicMaterials.status, 200);
  const filters = calls.filter((call) => call.method === 'listContent').map((call) => call.filter);
  assert.equal(filters[0].libraryType, 'standard_clause');
  assert.equal(filters[1].libraryType, 'public_material');
});

test('controlled attachment download reuses service authorization and never exposes a static URL', async () => {
  const uploadDir = await mkdtemp(path.join(os.tmpdir(), 'bestcrm-bid-content-'));
  try {
    const storedPath = 'bid-content/2026/09/policy.pdf';
    await mkdir(path.join(uploadDir, 'bid-content/2026/09'), { recursive: true });
    await writeFile(path.join(uploadDir, storedPath), Buffer.from('controlled-policy'));
    const blockOverrides = {
      sensitivity: 'internal', currentSensitivity: 'internal',
      revisions: [{
        ...contentBlock().revisions[0], componentType: 'controlled_attachment',
        attachmentStoredPath: storedPath, attachmentOriginalName: 'policy.pdf', attachmentMimeType: 'application/pdf',
        attachmentByteSize: 17, attachmentSha256: 'a'.repeat(64)
      }]
    };
    const { agent } = await createAgent({ role: ROLES.SALESPERSON, uploadDir, blockOverrides });
    const response = await agent.get('/bid-center/clauses/8/revisions/30/attachment');
    assert.equal(response.status, 200);
    assert.match(response.headers['content-disposition'], /attachment/);
    assert.equal(response.body.toString(), 'controlled-policy');
    assert.doesNotMatch((await agent.get('/bid-center/clauses/8')).text, /href="\/assets\/.*policy/);
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
});

test('multipart content mutations validate CSRF after upload parsing', async () => {
  const { agent, calls } = await createAgent({ csrfProtection: true });
  const invalid = await agent.post('/bid-center/clauses').field('blockCode', 'PAYMENT-02');
  assert.equal(invalid.status, 403);
  assert.match(invalid.text, /Invalid CSRF token/);
  assert.equal(calls.filter((call) => call.method === 'createContent').length, 0);

  const form = await agent.get('/bid-center/clauses/new');
  const valid = await agent.post('/bid-center/clauses')
    .field('_csrf', csrfToken(form.text))
    .field('blockCode', 'PAYMENT-02')
    .field('category', 'commercial')
    .field('ownerRoleCode', ROLES.COMMERCIAL_MANAGER)
    .field('nameEn', 'Payment Terms')
    .field('nameZh', '付款条件')
    .field('language', 'bilingual')
    .field('componentType', 'narrative')
    .field('sensitivity', 'confidential')
    .field('changeSummary', 'Initial controlled clause');
  assert.equal(valid.status, 302);
  assert.equal(calls.filter((call) => call.method === 'createContent').length, 1);
});
