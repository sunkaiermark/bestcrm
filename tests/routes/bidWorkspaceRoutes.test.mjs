import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { ROLES } from '../../src/domain/roles.mjs';
import { hashPassword } from '../../src/services/authService.mjs';
import { createApp } from '../../src/server.mjs';

test('anonymous users are redirected only from project bid workspace route families', async () => {
  const app = createApp({
    databaseUrl: '',
    sessionSecret: 'test-secret',
    bidCenter: { enabled: true },
    emailCenter: { enabled: false }
  });
  assert.equal((await request(app).get('/bid-center/workspaces')).status, 302);
  assert.equal((await request(app).get('/opportunities/20/bid-workspace')).status, 302);
  assert.equal((await request(app).get('/email-center')).status, 404);
});

async function createWorkspaceAgent({ enabled = true, role = ROLES.QUOTATION_ENGINEER, userId = 3, visible = true } = {}) {
  const currentUser = {
    id: userId, username: `user-${userId}`, passwordHash: await hashPassword('ChangeMe123!'),
    displayName: `User ${userId}`, isActive: true, roles: [role]
  };
  const opportunity = {
    id: 20, opportunityNo: 'OPP-20', title: 'Bilingual Mixer Project', customerId: 8, customerName: 'Acme',
    primaryContactId: 9, primaryContactCode: 'CT000009', primaryContactName: 'Lee', requirement: '10 t/h', salespersonId: 7, salesManagerId: 2,
    quotationEngineerId: 3, technicalManagerId: 6, commercialManagerId: 5,
    status: 'technical_solution_in_progress'
  };
  const teamMembers = [{ userId: 4, roleCode: ROLES.QUOTATION_ENGINEER, isActive: true }];
  const technicalTemplate = {
    id: 4, templateCode: 'MX-100', name: 'Mixer Agreement', productModel: 'MX-100', language: 'bilingual',
    isActive: true, currentPublishedRevisionId: 9, currentRevisionLabel: 'TPL-R2',
    revisions: [{
      id: 9, revisionNo: 2, status: 'published',
      contentSchema: { schemaVersion: 1, sections: [{ key: 'cover', sortOrder: 1, enabled: true, defaultClauseIds: [] }] },
      variables: [{
        variableKey: 'customer_name', labelEn: 'Customer', labelZh: '客户', dataType: 'text',
        sourceField: 'customer_name', sectionKey: 'cover', isRequired: true, defaultValue: '', validationRules: {}
      }]
    }]
  };
  const commercialTemplate = {
    id: 5, templateCode: 'COMM-GLOBAL', nameEn: 'Global Commercial', nameZh: '全球商务包', language: 'bilingual',
    isActive: true, currentPublishedRevisionId: 10, currentRevisionLabel: 'CTPL-R1',
    revisions: [{
      id: 10, revisionNo: 1, status: 'published',
      contentSchema: { schemaVersion: 1, sections: [{ key: 'pricing', sortOrder: 1, contentBlockIds: [] }] },
      variableSchema: [{
        variableKey: 'total_price', labelEn: 'Total price', labelZh: '总价', dataType: 'number',
        sourceField: 'total_price', sectionKey: 'pricing', isRequired: true, defaultValue: '', validationRules: { min: 1 }, sortOrder: 1
      }],
      validationRules: {}
    }]
  };
  const outputProfile = {
    id: 30, profileCode: 'GLOBAL', revisionNo: 1, revisionLabel: 'GLOBAL-R1', nameEn: 'Global output',
    nameZh: '全球输出', languageMode: 'bilingual', layoutSettings: { pageSize: 'A4' }, brandAssets: {}
  };
  const context = {
    opportunityId: 20, opportunityNo: 'OPP-20', opportunityTitle: opportunity.title, requirementSummary: opportunity.requirement,
    customerId: 8, customerName: 'Acme', customerAddress: 'Shanghai', customerCountry: 'CN', customerRegion: 'East',
    customerIndustry: 'Chemical', contactId: 9, contactName: 'Lee', opportunityOwner: 'Sales', technicalManager: 'Tech',
    commercialManager: 'Commercial', totalPrice: 120000, quoteId: 12, quoteVersionNo: 3, quoteItems: []
  };
  const workspace = {
    id: 40, opportunityId: 20, status: 'in_progress', language: 'en',
    opportunity: { id: 20, opportunityNo: 'OPP-20', title: opportunity.title, customerName: 'Acme', primaryContactId: 9, primaryContactCode: 'CT000009', primaryContactName: 'Lee' },
    technicalTemplate: { id: 4, templateCode: 'MX-100', name: 'Mixer Agreement', revisionNo: 2 },
    commercialTemplate: { id: 5, templateCode: 'COMM-GLOBAL', nameEn: 'Global Commercial', nameZh: '全球商务包', revisionNo: 1 },
    outputProfile: { ...outputProfile },
    technicalDraft: { id: 41, draftLabel: 'TS-D1', status: 'draft', validationIssueCount: 0 },
    commercialDraft: { id: 42, draftLabel: 'CP-D1', status: 'draft', validationIssueCount: 0, sourceMetadata: { contentComponentSnapshots: [] } },
    sourceMetadata: { contentComponentReferences: [] }, createdAt: '2026-09-04T00:00:00Z'
  };
  const calls = [];
  let existing = null;
  const bidWorkspaceRepository = {
    async listWorkspaces(filter) { calls.push(['listWorkspaces', filter]); return visible ? [workspace] : []; },
    async getWorkspaceDetail(id, filter) { calls.push(['getWorkspaceDetail', Number(id), filter]); return visible ? structuredClone(workspace) : null; },
    async findByOpportunity(id) { calls.push(['findByOpportunity', Number(id)]); return existing; },
    async listPublishedOutputProfiles() { return [outputProfile]; },
    async findPublishedOutputProfile() { return outputProfile; },
    async getGenerationContext() { return context; },
    async listCurrentPublishedContentSnapshots() { return []; },
    async createWorkspace(input) { calls.push(['createWorkspace', input]); existing = workspace; return { id: 40 }; }
  };
  const opportunityTechnicalDraftRepository = {
    async createDraft(input) { calls.push(['createTechnicalDraft', input]); return { id: 41, ...input }; },
    async getDraftDetail() {
      return {
        id: 41, opportunityId: 20, status: 'draft', draftLabel: 'TS-D1', templateRevisionId: 9,
        templateRevisionNoSnapshot: 2, contentSchemaSnapshot: technicalTemplate.revisions[0].contentSchema,
        variableSchemaSnapshot: technicalTemplate.revisions[0].variables, variableValues: { customer_name: 'Acme' },
        selectedClauses: [], validationIssues: [], assignments: [],
        renderedContent: { schemaVersion: 1, sections: [{ key: 'cover', labelEn: 'Cover', labelZh: '封面', sortOrder: 1, included: true, bodyEn: '', bodyZh: '', tableRows: [], clauses: [] }], variables: [] }
      };
    }
  };
  const opportunityCommercialDraftRepository = {
    async createDraft(input) { calls.push(['createCommercialDraft', input]); return { id: 42, ...input }; },
    async getDraftDetail() {
      return {
        id: 42, workspaceId: 40, opportunityId: 20, status: 'draft', draftLabel: 'CP-D1', templateRevisionId: 10,
        templateRevisionNoSnapshot: 1, contentSchemaSnapshot: commercialTemplate.revisions[0].contentSchema,
        variableSchemaSnapshot: commercialTemplate.revisions[0].variableSchema, variableValues: { total_price: 120000 },
        validationIssues: [], sourceMetadata: { contentComponentSnapshots: [] },
        renderedContent: { schemaVersion: 1, sections: [{ key: 'pricing', labelEn: 'Pricing', labelZh: '价格', sortOrder: 1, included: true, bodyEn: '', bodyZh: '', tableRows: [], contentBlocks: [] }], variables: [] }
      };
    }
  };
  const bidPackageEditorRepository = {
    async listChanges() { return []; }, async listEvents() { return []; },
    async listAttachments() { return []; }, async listSuggestions() { return []; },
    async findAttachment() { return null; },
    async updateTechnicalDraft(input) { calls.push(['updateTechnicalPackage', input]); return true; },
    async updateCommercialDraft(input) { calls.push(['updateCommercialPackage', input]); return true; },
    async insertChange(input) { calls.push(['insertPackageChange', input]); return input; },
    async insertEvent(input) { calls.push(['insertPackageEvent', input]); return input; },
    async touchWorkspace(id, actorId) { calls.push(['touchWorkspace', Number(id), Number(actorId)]); }
  };
  const transactionRepositories = {
    bidWorkspaceRepository,
    opportunityTechnicalDraftRepository,
    opportunityCommercialDraftRepository,
    bidPackageEditorRepository,
    technicalTemplateRepository: {
      async listTemplates() { return [technicalTemplate]; },
      async getTemplateDetail() { return technicalTemplate; },
      async listClauses() { return []; }
    },
    commercialPackageTemplateRepository: {
      async listTemplates() { return [commercialTemplate]; },
      async getTemplateDetail() { return commercialTemplate; }
    }
  };
  const app = createApp({
    sessionSecret: 'test-secret', csrfProtection: false, bidCenter: { enabled },
    userRepository: {
      async findByIdWithRoles(id) { return Number(id) === currentUser.id ? currentUser : null; },
      async findByUsernameWithRoles(username) { return username === currentUser.username ? currentUser : null; }
    },
    opportunityRepository: {
      async getOpportunityDetail(id) { return Number(id) === 20 ? opportunity : null; },
      async listOpportunities() { return []; }
    },
    opportunityResponsibilityRepository: { async listTeamMembersByOpportunity() { return teamMembers; } },
    ...transactionRepositories,
    workflowTransaction: async (callback) => { calls.push(['transaction']); return callback(transactionRepositories); }
  });
  const agent = request.agent(app);
  await agent.post('/login').type('form').send({ username: currentUser.username, password: 'ChangeMe123!' });
  return { agent, calls };
}

test('project bid workspace routes stay unavailable while the frozen feature flag is off', async () => {
  const { agent, calls } = await createWorkspaceAgent({ enabled: false });
  const response = await agent.get('/bid-center/workspaces');
  assert.equal(response.status, 404);
  assert.match(response.text, /Bid center is disabled/);
  assert.equal(calls.some(([method]) => method === 'listWorkspaces'), false);
});

test('Project Lead Engineer selects published sources, reviews CRM prefill, and creates one workspace', async () => {
  const { agent, calls } = await createWorkspaceAgent();
  const selection = await agent.get('/opportunities/20/bid-workspace');
  assert.equal(selection.status, 200);
  assert.match(selection.text, /MX-100/);
  assert.match(selection.text, /COMM-GLOBAL/);
  assert.match(selection.text, /GLOBAL-R1/);
  assert.match(selection.text, /CT000009 · Lee/);

  const preview = await agent.post('/opportunities/20/bid-workspace/preview').type('form').send({
    language: 'en', technicalTemplateRevisionId: 9, commercialTemplateRevisionId: 10, outputProfileId: 30
  });
  assert.equal(preview.status, 200);
  assert.match(preview.text, /name="technical__customer_name" value="Acme"/);
  assert.match(preview.text, /name="commercial__total_price" value="120000"/);
  assert.match(preview.text, /CRM/);
  assert.match(preview.text, /CT000009 · Lee/);

  const created = await agent.post('/opportunities/20/bid-workspace').type('form').send({
    language: 'en', technicalTemplateRevisionId: 9, commercialTemplateRevisionId: 10, outputProfileId: 30,
    technical__customer_name: 'Acme International', commercial__total_price: '150000'
  });
  assert.equal(created.status, 302);
  assert.equal(created.headers.location, '/bid-center/workspaces/40');
  assert.ok(calls.some(([method]) => method === 'transaction'));
  assert.equal(calls.find(([method]) => method === 'createCommercialDraft')[1].variableValues.total_price, 150000);
});

test('an existing opportunity workspace redirects to its single canonical project workspace', async () => {
  const { agent } = await createWorkspaceAgent();
  await agent.post('/opportunities/20/bid-workspace').type('form').send({
    language: 'en', technicalTemplateRevisionId: 9, commercialTemplateRevisionId: 10, outputProfileId: 30
  });
  const response = await agent.get('/opportunities/20/bid-workspace');
  assert.equal(response.status, 302);
  assert.equal(response.headers.location, '/bid-center/workspaces/40');
});

test('supporting engineers cannot create and invisible direct workspace URLs disclose no data', async () => {
  const supporting = await createWorkspaceAgent({ userId: 4 });
  assert.equal((await supporting.agent.get('/opportunities/20/bid-workspace')).status, 403);
  const invisible = await createWorkspaceAgent({ userId: 99, role: ROLES.SALESPERSON, visible: false });
  const response = await invisible.agent.get('/bid-center/workspaces/40');
  assert.equal(response.status, 404);
  assert.match(response.text, /Bid workspace not found/);
  const attachment = await invisible.agent.get('/bid-center/workspaces/40/materials/31/attachment');
  assert.equal(attachment.status, 404);
  assert.match(attachment.text, /Bid workspace not found/);
});

test('workspace index and detail expose frozen package identifiers without mutable source bodies', async () => {
  const { agent } = await createWorkspaceAgent();
  const list = await agent.get('/bid-center/workspaces');
  assert.equal(list.status, 200);
  assert.match(list.text, /OPP-20/);
  assert.match(list.text, /CT000009 · Lee/);
  assert.match(list.text, /TS-D1/);
  assert.match(list.text, /CP-D1/);
  const detail = await agent.get('/bid-center/workspaces/40');
  assert.equal(detail.status, 200);
  assert.match(detail.text, /TPL-R2/);
  assert.match(detail.text, /CTPL-R1/);
  assert.match(detail.text, /GLOBAL-R1/);
  assert.match(detail.text, /CT000009 · Lee/);
  assert.match(detail.text, /\.bid-output-scroll\s*\{[\s\S]*max-width:\s*100%;[\s\S]*overflow-x:\s*auto;/);
});

test('project package editor renders the frozen three-pane technical workspace', async () => {
  const { agent } = await createWorkspaceAgent();
  const response = await agent.get('/bid-center/workspaces/40/packages/technical?section=cover');
  assert.equal(response.status, 200);
  assert.match(response.text, /Sections &amp; owners/);
  assert.match(response.text, /Standard source &amp; diff/);
  assert.match(response.text, /Save project draft/);
  assert.match(response.text, /Project copy; the standard template remains unchanged/);
});

test('technical-only users cannot retrieve commercial editor content by direct URL', async () => {
  const { agent } = await createWorkspaceAgent();
  const response = await agent.get('/bid-center/workspaces/40/packages/commercial?section=pricing');
  assert.equal(response.status, 403);
  assert.match(response.text, /Forbidden/);
});

test('section editor POST persists the project copy and redirects to the selected section', async () => {
  const { agent, calls } = await createWorkspaceAgent();
  const response = await agent.post('/bid-center/workspaces/40/packages/technical/sections/cover').type('form').send({
    bodyEn: 'Project cover', bodyZh: '项目封面', tableRows: 'A | B',
    modificationStatus: 'customized', reason: 'Customer-specific cover'
  });
  assert.equal(response.status, 302);
  assert.equal(response.headers.location, '/bid-center/workspaces/40/packages/technical?section=cover');
  assert.equal(calls.find(([name]) => name === 'updateTechnicalPackage')[1].renderedContent.sections[0].bodyEn, 'Project cover');
  assert.equal(calls.find(([name]) => name === 'insertPackageChange')[1].reason, 'Customer-specific cover');
  assert.equal(calls.find(([name]) => name === 'insertPackageEvent')[1].eventType, 'section_saved');
});

test('direct package submission POST denies a non-owner before workflow side effects', async () => {
  const { agent, calls } = await createWorkspaceAgent({ role: ROLES.SALESPERSON, userId: 7 });
  const response = await agent.post('/bid-center/workspaces/40/packages/technical/submit')
    .type('form').send({ comment: 'bypass attempt' });
  assert.equal(response.status, 403);
  assert.match(response.text, /Forbidden/);
  assert.equal(calls.some(([name]) => name === 'insertPackageEvent'), false);
});

test('generated output download sets integrity headers and blocks commercial bytes from technical-only users', async () => {
  const passwordHash = await hashPassword('ChangeMe123!');
  const user = { id: 11, username: 'support-qe', passwordHash, displayName: 'Support QE', isActive: true, roles: [ROLES.QUOTATION_ENGINEER] };
  const outputBytes = Buffer.from('controlled technical PDF');
  const events = [];
  const document = (id, documentType) => ({
    id, workspaceId: 40, quotationPackageVersionId: 60, documentType,
    originalName: documentType === 'technical_pdf' ? '812345_Technical-Package.pdf' : '812345_Commercial-Package.pdf',
    mimeType: 'application/pdf', content: outputBytes, byteSize: outputBytes.length, sha256: 'a'.repeat(64)
  });
  const app = createApp({
    databaseUrl: '', sessionSecret: 'test-secret', csrfProtection: false,
    bidCenter: { enabled: true }, workflowTransaction: null,
    userRepository: {
      async findByIdWithRoles(id) { return Number(id) === user.id ? user : null; },
      async findByUsernameWithRoles(username) { return username === user.username ? user : null; }
    },
    bidWorkspaceRepository: {
      async getWorkspaceDetail() {
        return {
          id: 40, opportunityId: 20, outputProfileId: 5, sourceMetadata: {}, outputProfile: { revisionNo: 1 },
          opportunity: {
            id: 20, salespersonId: 7, salesManagerId: 8, quotationEngineerId: 9,
            technicalManagerId: 10, commercialManagerId: 12
          }
        };
      },
      async listWorkspaces() { return []; }, async findByOpportunity() { return null; }
    },
    quotationPackageDocumentRepository: {
      async listByWorkspace() { return []; }, async listByPackage() { return []; }, async lockPackage() {},
      async findById(id) { return Number(id) === 1 ? document(1, 'technical_pdf') : document(2, 'commercial_pdf'); }
    },
    bidPackageEditorRepository: {
      async insertEvent(value) { events.push(value); return value; },
      async listChanges() { return []; }, async listEvents() { return []; },
      async listAttachments() { return []; }, async listSuggestions() { return []; }, async findAttachment() { return null; }
    }
  });
  const agent = request.agent(app);
  await agent.post('/login').type('form').send({ username: user.username, password: 'ChangeMe123!' });
  const technical = await agent.get('/bid-center/workspaces/40/outputs/1/download');
  assert.equal(technical.status, 200);
  assert.equal(technical.headers['x-document-sha256'], 'a'.repeat(64));
  assert.equal(technical.headers['cache-control'], 'private, no-store');
  assert.match(technical.headers['content-disposition'], /attachment/);
  assert.equal(events[0].eventType, 'downloaded_bid_output');
  const preview = await agent.get('/bid-center/workspaces/40/outputs/1/download?inline=1');
  assert.match(preview.headers['content-disposition'], /^inline;/);
  const commercial = await agent.get('/bid-center/workspaces/40/outputs/2/download');
  assert.equal(commercial.status, 403);
  assert.match(commercial.text, /Forbidden/);
});
