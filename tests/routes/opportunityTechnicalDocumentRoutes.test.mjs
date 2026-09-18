import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import JSZip from 'jszip';
import { ROLES } from '../../src/domain/roles.mjs';
import { hashPassword } from '../../src/services/authService.mjs';
import { createApp } from '../../src/server.mjs';

function csrfToken(html) {
  return html.match(/name="_csrf"\s+value="([^"]+)"/)?.[1] || '';
}

async function validDocxBuffer() {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types/>');
  zip.file('word/document.xml', '<document/>');
  return zip.generateAsync({ type: 'nodebuffer' });
}

async function createTechnicalDocumentAgent(options = {}) {
  const currentUser = {
    id: options.userId || 3,
    username: options.username || 'quote01',
    passwordHash: await hashPassword('ChangeMe123!'),
    displayName: options.displayName || 'Quotation Engineer',
    isActive: true,
    roles: options.roles || [ROLES.QUOTATION_ENGINEER]
  };
  const opportunity = {
    id: 20,
    opportunityNo: 'OPP-20',
    title: 'Mixer Project',
    customerId: 8,
    customerName: 'Acme',
    salespersonId: 7,
    quotationEngineerId: 3,
    technicalManagerId: 6,
    archivedAt: null,
    status: 'technical_solution_in_progress'
  };
  const item = {
    id: 11, opportunityId: 20, itemNo: 1, productCategoryCode: 'mixer',
    equipmentName: 'Main Mixer', model: 'MX-10', quantity: 1,
    technicalParameters: [{ key: 'capacity', label: '处理能力', value: '10 t/h' }],
    archivedAt: null, createdBy: 3, updatedBy: 3
  };
  const template = {
    id: 5, templateCode: 'MIX-DS', name: 'Mixer Datasheet', documentType: 'datasheet',
    nameEn: 'Mixer Datasheet', nameZh: '搅拌机技术数据表',
    productCategoryCode: 'mixer', productFamily: '搅拌机', language: 'bilingual',
    currentPublishedRevisionId: 9, isActive: true,
    revisions: [{
      id: 9, revisionNo: 1, status: 'published', variables: [],
      contentSchema: { schemaVersion: 1, sections: [] }
    }]
  };
  const fileContent = Buffer.from('%PDF-route');
  const document = {
    id: 30, opportunityId: 20, documentType: 'datasheet', primaryEquipmentItemId: 11,
    documentCode: 'OPP-20-01-DATASHEET', title: 'Main Mixer - Datasheet',
    currentVersionNo: 1, currentVersionLabel: 'OPP-20-01-DATASHEET-V1',
    createdBy: 3, createdByDisplayName: 'Quotation Engineer',
    versions: [{
      id: 40, documentId: 30, versionNo: 1, versionLabel: 'OPP-20-01-DATASHEET-V1',
      creationMethod: 'generated', basedOnVersionId: null,
      changeSummary: 'Initial generated version', createdBy: 3,
      createdByDisplayName: 'Quotation Engineer', createdAt: '2026-09-15',
      items: [{
        id: 1, itemNo: 1, productCategoryName: '搅拌机', equipmentName: 'Main Mixer',
        model: 'MX-10', quantity: 1, templateCode: 'MIX-DS', templateRevisionNo: 1
      }],
      files: [{
        id: 50, versionId: 40, format: 'pdf', originalName: 'OPP-20-01-DATASHEET-V1.pdf',
        mimeType: 'application/pdf', byteSize: fileContent.length, sha256: 'a'.repeat(64)
      }]
    }],
    events: []
  };
  const calls = [];
  const opportunityTechnicalDocumentRepository = {
    async listEquipmentByOpportunity(id, filter) { calls.push(['listEquipment', Number(id), filter]); return [item]; },
    async listDocumentsByOpportunity(id) { calls.push(['listDocuments', Number(id)]); return [document]; },
    async findEquipmentItem() { return item; },
    async createEquipment(input) { calls.push(['createEquipment', input]); return { ...item, ...input }; },
    async updateEquipment(input) { calls.push(['updateEquipment', input]); return { ...item, ...input }; },
    async archiveEquipment(input) { calls.push(['archiveEquipment', input]); return { ...item, archivedAt: '2026-09-15' }; },
    async findDocumentByIdentity() { return null; },
    async createDocumentVersionOne(input) { calls.push(['createDocument', input]); return { documentId: 30, versionId: 40, versionNo: 1 }; },
    async getDocumentDetail() { return document; },
    async addUploadedVersion(input) { calls.push(['uploadVersion', input]); return { documentId: 30, versionId: 41, versionNo: 2 }; },
    async findFile() { return { ...document.versions[0].files[0], content: fileContent, sha256: options.fileSha256 || document.versions[0].files[0].sha256 }; }
  };
  if (!options.fileSha256) {
    const { createHash } = await import('node:crypto');
    document.versions[0].files[0].sha256 = createHash('sha256').update(fileContent).digest('hex');
  }
  const technicalTemplateRepository = {
    async listTemplates(filter) {
      calls.push(['listTemplates', filter]);
      return [{ ...template, documentType: filter.documentType || template.documentType }];
    },
    async getTemplateDetail() { return { ...template, documentType: 'datasheet' }; },
    async listClauses() { return []; }
  };
  const technicalMaterialDocumentService = {
    async generateVersionOne(input) {
      calls.push(['generateVersionOne', input]);
      return [
        { format: 'docx', originalName: 'v1.docx', mimeType: 'docx', content: Buffer.from('docx'), byteSize: 4, sha256: 'b'.repeat(64) },
        { format: 'pdf', originalName: 'v1.pdf', mimeType: 'pdf', content: Buffer.from('pdf'), byteSize: 3, sha256: 'c'.repeat(64) }
      ];
    }
  };
  const app = createApp({
    sessionSecret: 'test-secret',
    csrfProtection: options.csrfProtection === true,
    userRepository: {
      async findByIdWithRoles(id) { return Number(id) === currentUser.id ? currentUser : null; },
      async findByUsernameWithRoles(username) { return username === currentUser.username ? currentUser : null; }
    },
    opportunityRepository: {
      async getOpportunityDetail(id) { return Number(id) === 20 ? opportunity : null; },
      async listOpportunities() { return []; }
    },
    opportunityResponsibilityRepository: { async listTeamMembersByOpportunity() { return []; } },
    opportunityTechnicalDocumentRepository,
    technicalTemplateRepository,
    technicalMaterialDocumentService
  });
  const agent = request.agent(app);
  if (options.language) await agent.get(`/language?lang=${options.language}&returnTo=/login`);
  const loginPayload = { username: currentUser.username, password: 'ChangeMe123!' };
  if (options.csrfProtection === true) {
    loginPayload._csrf = csrfToken((await agent.get('/login')).text);
  }
  await agent.post('/login').type('form').send(loginPayload);
  return { agent, calls, item, document };
}

test('anonymous users are redirected from Opportunity technical documents', async () => {
  const app = createApp({ databaseUrl: '', sessionSecret: 'test-secret' });
  const response = await request(app).get('/opportunities/20/technical-documents');
  assert.equal(response.status, 302);
  assert.equal(response.headers.location, '/login');
});

test('assigned Quotation Engineer sees equipment and immutable document versions', async () => {
  const { agent } = await createTechnicalDocumentAgent({ language: 'zh' });
  const response = await agent.get('/opportunities/20/technical-documents');
  assert.equal(response.status, 200);
  assert.match(response.text, /商机技术资料/);
  assert.match(response.text, /Main Mixer/);
  assert.match(response.text, /OPP-20-01-DATASHEET-V1/);
  assert.match(response.text, /新增设备/);
});

test('assigned Quotation Engineer adds structured equipment and opens template coverage selection', async () => {
  const { agent, calls } = await createTechnicalDocumentAgent({ language: 'zh' });
  const created = await agent.post('/opportunities/20/technical-documents/equipment').type('form').send({
    productCategoryCode: 'mixer', equipmentName: 'Second Mixer', model: 'MX-20', quantity: '2',
    technicalParameters: 'capacity | 20 t/h'
  });
  assert.equal(created.status, 302);
  assert.ok(calls.some(([name, input]) => name === 'createEquipment' && input.technicalParameters[0].key === 'capacity'));

  const selection = await agent.get('/opportunities/20/technical-documents/new?type=datasheet');
  assert.equal(selection.status, 200);
  assert.match(selection.text, /已发布模板就绪/);
  assert.match(selection.text, /type="radio" name="equipmentItemIds"/);
});

test('formal V1 generation resolves the item template and redirects to the document', async () => {
  const { agent, calls } = await createTechnicalDocumentAgent({ language: 'zh' });
  const response = await agent.post('/opportunities/20/technical-documents').type('form').send({
    documentType: 'datasheet', equipmentItemIds: '11'
  });
  assert.equal(response.status, 302);
  assert.equal(response.headers.location, '/opportunities/20/technical-documents/30');
  assert.ok(calls.some(([name, input]) => name === 'generateVersionOne' && input.language === 'zh'));
  assert.ok(calls.some(([name, input]) => (
    name === 'createDocument'
    && input.documentCode === 'OPP-20-01-DATASHEET'
    && input.sourceSnapshot.language === 'zh'
  )));
});

test('document detail downloads integrity-checked files and accepts a paired external V2', async () => {
  const { agent, calls, document } = await createTechnicalDocumentAgent({ language: 'zh' });
  const detail = await agent.get('/opportunities/20/technical-documents/30');
  assert.equal(detail.status, 200);
  assert.match(detail.text, /版本历史/);
  assert.match(detail.text, new RegExp(document.versions[0].files[0].sha256));

  const download = await agent.get('/opportunities/20/technical-documents/30/files/50/download');
  assert.equal(download.status, 200);
  assert.equal(download.headers['content-length'], String(Buffer.from('%PDF-route').length));
  assert.equal(download.headers['x-content-sha256'], document.versions[0].files[0].sha256);

  const upload = await agent.post('/opportunities/20/technical-documents/30/versions')
    .field('changeSummary', 'Customer comments incorporated')
    .field('sourceVersionNo', '1')
    .attach('docxFile', await validDocxBuffer(), 'edited.docx')
    .attach('pdfFile', Buffer.from('%PDF-1.7\nupdated'), 'edited.pdf');
  assert.equal(upload.status, 302);
  assert.ok(calls.some(([name, input]) => name === 'uploadVersion' && input.files.length === 2));
});

test('paired external version upload validates multipart CSRF before mutation', async () => {
  const { agent, calls } = await createTechnicalDocumentAgent({ csrfProtection: true });
  const detail = await agent.get('/opportunities/20/technical-documents/30');
  const token = csrfToken(detail.text);
  assert.ok(token);

  const rejected = await agent.post('/opportunities/20/technical-documents/30/versions')
    .field('changeSummary', 'No CSRF token')
    .field('sourceVersionNo', '1')
    .attach('docxFile', await validDocxBuffer(), 'edited.docx')
    .attach('pdfFile', Buffer.from('%PDF-1.7\nupdated'), 'edited.pdf');
  assert.equal(rejected.status, 403);
  assert.equal(calls.some(([name]) => name === 'uploadVersion'), false);

  const accepted = await agent.post('/opportunities/20/technical-documents/30/versions')
    .field('_csrf', token)
    .field('changeSummary', 'Valid CSRF token')
    .field('sourceVersionNo', '1')
    .attach('docxFile', await validDocxBuffer(), 'edited.docx')
    .attach('pdfFile', Buffer.from('%PDF-1.7\nupdated'), 'edited.pdf');
  assert.equal(accepted.status, 302);
  assert.equal(calls.filter(([name]) => name === 'uploadVersion').length, 1);
});

test('sales Opportunity viewer can read documents but cannot change equipment or versions', async () => {
  const { agent } = await createTechnicalDocumentAgent({
    userId: 7, username: 'sales01', roles: [ROLES.SALESPERSON]
  });
  const list = await agent.get('/opportunities/20/technical-documents');
  assert.equal(list.status, 200);
  assert.doesNotMatch(list.text, /Add Equipment Item/);
  const mutation = await agent.post('/opportunities/20/technical-documents/equipment').type('form').send({});
  assert.equal(mutation.status, 403);
  const newDocument = await agent.get('/opportunities/20/technical-documents/new?type=datasheet');
  assert.equal(newDocument.status, 403);
});
