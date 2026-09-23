import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { ROLES } from '../../src/domain/roles.mjs';
import { hashPassword } from '../../src/services/authService.mjs';
import { renderTechnicalDraftContent } from '../../src/services/opportunityTechnicalDraftService.mjs';
import { createApp } from '../../src/server.mjs';

function standardSection(overrides = {}) {
  return {
    key: 'design_parameters', labelEn: 'Design Parameters', labelZh: '设计参数', enabled: true,
    sortOrder: 1, sectionType: 'parameter_table', bodyEn: 'Standard parameters', bodyZh: '标准参数',
    tableRowsEn: [['Item', 'Value']], tableRowsZh: [['项目', '数值']],
    condition: { operator: 'always', variableKey: '', value: '' },
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
    language: options.language || 'en',
    content: options.language === 'zh' ? '需执行并记录工厂验收。' : 'Documented FAT required.',
    conditionSchema: {}, status: 'published'
  };
  const template = {
    id: 5, templateCode: 'MX-100', name: 'Mixer Agreement', productFamily: 'Mixing', productModel: 'MX-100',
    nameEn: 'Mixer Agreement', nameZh: '搅拌机协议', productCategoryCode: 'mixer',
    language: 'bilingual', isActive: true, currentPublishedRevisionId: 9,
    currentRevisionLabel: 'TPL-R1', revisions: [{ id: 9, revisionNo: 1, status: 'published', contentSchema, variables }]
  };
  const selectedClauses = [{ ...clause, sectionKey: 'design_parameters', isTemplateDefault: true, standardChanged: false }];
  const variableValues = { capacity: options.capacity ?? '' };
  const draft = {
    id: 41,
    opportunityId: 20,
    templateRevisionId: 9,
    sourceKind: options.sourceKind || 'template',
    deliverableType: options.deliverableType || 'technical_agreement',
    uploadedAttachmentId: options.uploadedAttachmentId || null,
    uploadedFile: options.uploadedFile || null,
    uploadedFiles: options.uploadedFiles || (options.uploadedFile ? [options.uploadedFile] : []),
    draftRevisionNo: 1,
    draftLabel: 'TS-D1',
    status: options.draftStatus || 'draft',
    formalVersionNo: options.formalVersionNo || null,
    formalVersionLabel: options.formalVersionNo ? `TS-V${options.formalVersionNo}` : '',
    language: options.language || 'en',
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
    documents: options.documents || [],
    createdBy: 3,
    updatedBy: 3,
    updatedByDisplayName: 'Lead Engineer',
    updatedAt: '2026-09-02'
  };
  const calls = [];
  const reviewAttachments = options.reviewAttachments || [];
  const opportunityTechnicalDraftRepository = {
    async getGenerationContext(id) { calls.push(['getGenerationContext', Number(id)]); return { customerName: 'Acme', opportunityTitle: opportunity.title, productName: 'Mixer', opportunityOwner: 'Sales One' }; },
    async listByOpportunity(id) { calls.push(['listByOpportunity', Number(id)]); return [draft]; },
    async getDraftDetail(id) { calls.push(['getDraftDetail', Number(id)]); return Number(id) === 41 ? draft : null; },
    async findDocument(draftId, documentId) {
      calls.push(['findDocument', Number(draftId), Number(documentId)]);
      return (draft.documents || []).find((document) => Number(document.id) === Number(documentId)) || null;
    },
    async createDraft(input) { calls.push(['createDraft', input]); return { ...draft, ...input }; },
    async setUploadedFiles(input) {
      calls.push(['setUploadedFiles', input]);
      draft.uploadedAttachmentId = input.attachmentIds[0];
      draft.uploadedFiles = input.attachmentIds.map((id) => ({ id }));
      draft.status = 'ready';
      return draft;
    },
    async addReviewAttachments(input) {
      calls.push(['addReviewAttachments', input]);
      for (const attachmentId of input.attachmentIds) {
        const attachment = await options.attachmentRepository?.findById(attachmentId);
        reviewAttachments.push({
          technicalDraftId: input.draftId,
          attachmentId,
          originalName: attachment?.originalName || '',
          mimeType: attachment?.mimeType || 'application/octet-stream'
        });
      }
      return input.attachmentIds;
    },
    async hasReviewAttachments({ draftId, opportunityId }) {
      calls.push(['hasReviewAttachments', draftId, opportunityId]);
      return Number(opportunityId) === opportunity.id
        && reviewAttachments.some((file) => Number(file.technicalDraftId) === Number(draftId));
    },
    async listReviewAttachmentsByOpportunity() { return reviewAttachments; },
    async listReviewAttachmentsByDraft() { return reviewAttachments; },
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
    ...(options.attachmentRepository ? { attachmentRepository: options.attachmentRepository } : {}),
    ...(options.uploadDir ? { uploadDir: options.uploadDir } : {}),
    technicalTemplateRepository,
    opportunityTechnicalDraftRepository,
    workflowAction: options.workflowAction
  });
  const agent = request.agent(app);
  if (options.language) await agent.get(`/language?lang=${options.language}&returnTo=/login`);
  await agent.post('/login').type('form').send({ username: currentUser.username, password: 'ChangeMe123!' });
  return { agent, calls, draft, reviewAttachments };
}

test('anonymous users are redirected from project technical draft routes', async () => {
  const app = createApp({ databaseUrl: '', sessionSecret: 'test-secret' });
  const response = await request(app).get('/opportunities/20/technical-drafts');
  assert.equal(response.status, 302);
  assert.equal(response.headers.location, '/login');
});

test('Project Lead Engineer sees the login-language draft list and generation freezes that language', async () => {
  const { agent, calls } = await createDraftAgent({ language: 'zh' });
  const list = await agent.get('/opportunities/20/technical-drafts');
  assert.equal(list.status, 200);
  assert.match(list.text, /项目技术方案草稿/);
  assert.match(list.text, /TS-D1/);
  assert.match(list.text, /生成技术方案草稿/);

  const created = await agent.post('/opportunities/20/technical-drafts').type('form').send({ templateId: 5 });
  assert.equal(created.status, 302);
  assert.equal(created.headers.location, '/opportunities/20/technical-drafts/41');
  assert.ok(calls.some(([method, input]) => method === 'createDraft' && input.language === 'zh'));
});

test('uploaded technical draft requires one of the three approved deliverable types', async () => {
  const { agent, calls } = await createDraftAgent();
  const invalid = await agent.post('/opportunities/20/technical-drafts').type('form').send({
    sourceKind: 'uploaded_file', deliverableType: 'other'
  });
  assert.equal(invalid.status, 400);
  const created = await agent.post('/opportunities/20/technical-drafts').type('form').send({
    sourceKind: 'uploaded_file', deliverableType: 'datasheet', returnTo: 'opportunity'
  });
  assert.equal(created.status, 302);
  assert.equal(created.headers.location, '/opportunities/20#technical-proposal');
  assert.ok(calls.some(([method, input]) => method === 'createDraft'
    && input.sourceKind === 'uploaded_file'
    && input.deliverableType === 'datasheet'
    && input.templateRevisionId === null));
});

test('uploaded technical file is shown for preview and submission while template editing is hidden', async () => {
  const uploadedFile = { id: 81, originalName: 'Datasheet.pdf', fileSize: 8 };
  const { agent } = await createDraftAgent({
    sourceKind: 'uploaded_file', deliverableType: 'datasheet', draftStatus: 'ready',
    uploadedAttachmentId: 81, uploadedFile
  });
  const detail = await agent.get('/opportunities/20/technical-drafts/41');
  assert.equal(detail.status, 200);
  assert.match(detail.text, /Datasheet\.pdf/);
  assert.match(detail.text, /attachments\/81\/preview/);
  assert.match(detail.text, /Submit for Technical Approval/);
  assert.match(detail.text, /data-localized-file-picker data-empty-label="No files selected"/);
  assert.match(detail.text, /name="attachment" required multiple/);
  assert.match(detail.text, />Choose file<\/span>/);
  assert.match(detail.text, /src="\/assets\/localized-file-picker\.js"/);
  assert.doesNotMatch(detail.text, /Project Variables|Structured Technical Content|TPL-R1/);
});

test('project lead upload persists a technical file before submission', async () => {
  const uploadDir = await mkdtemp(path.join(tmpdir(), 'bestcrm-technical-upload-'));
  let savedAttachment = null;
  try {
    const attachmentRepository = {
      async createAttachment(input) {
        savedAttachment = { id: 81, ...input };
        return savedAttachment;
      },
      async findById(id) { return Number(id) === 81 ? savedAttachment : null; }
    };
    const { agent, calls } = await createDraftAgent({
      sourceKind: 'uploaded_file', deliverableType: 'datasheet',
      uploadDir, attachmentRepository
    });
    const uploaded = await agent.post('/opportunities/20/technical-drafts/41/file')
      .field('returnTo', 'opportunity')
      .attach('attachment', Buffer.from('%PDF-1.4\nTechnical datasheet'), 'Datasheet.pdf');
    assert.equal(uploaded.status, 302);
    assert.equal(uploaded.headers.location, '/opportunities/20#technical-proposal');
    assert.equal(savedAttachment.category, 'technical_solution');
    assert.equal(savedAttachment.originalName, 'Datasheet.pdf');
    assert.equal((await readFile(path.join(uploadDir, savedAttachment.storedPath))).toString(), '%PDF-1.4\nTechnical datasheet');
    assert.ok(calls.some(([method, input]) => method === 'setUploadedFiles' && input.attachmentIds[0] === 81));
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
});

test('one upload can persist several technical files under the same TS-D version', async () => {
  const uploadDir = await mkdtemp(path.join(tmpdir(), 'bestcrm-technical-multi-upload-'));
  const savedAttachments = [];
  try {
    const attachmentRepository = {
      async createAttachment(input) {
        const attachment = { id: 81 + savedAttachments.length, ...input };
        savedAttachments.push(attachment);
        return attachment;
      },
      async findById(id) { return savedAttachments.find((file) => file.id === Number(id)) || null; }
    };
    const { agent, calls } = await createDraftAgent({
      sourceKind: 'uploaded_file', deliverableType: 'technical_agreement',
      uploadDir, attachmentRepository
    });
    const uploaded = await agent.post('/opportunities/20/technical-drafts/41/file')
      .field('returnTo', 'opportunity')
      .attach('attachment', Buffer.from('%PDF-1.4\nAgreement'), 'Agreement.pdf')
      .attach('attachment', Buffer.from('PK\u0003\u0004Datasheet'), 'Datasheet.xlsx');
    assert.equal(uploaded.status, 302);
    assert.deepEqual(savedAttachments.map((file) => file.originalName), ['Agreement.pdf', 'Datasheet.xlsx']);
    const setFilesCall = calls.find(([method]) => method === 'setUploadedFiles');
    assert.deepEqual(setFilesCall[1].attachmentIds, [81, 82]);
    assert.equal(setFilesCall[1].draftId, 41);
    assert.equal((await readFile(path.join(uploadDir, savedAttachments[0].storedPath))).toString(), '%PDF-1.4\nAgreement');
    assert.equal((await readFile(path.join(uploadDir, savedAttachments[1].storedPath))).toString(), 'PK\u0003\u0004Datasheet');
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
});

test('technical manager must enter a rejection reason before the existing review action runs', async () => {
  const workflowCalls = [];
  const { agent } = await createDraftAgent({
    userId: 6, username: 'manager01', roles: [ROLES.TECHNICAL_MANAGER],
    sourceKind: 'uploaded_file', draftStatus: 'pending',
    uploadedAttachmentId: 81, uploadedFile: { id: 81, originalName: 'Datasheet.pdf' },
    workflowAction: async (input) => { workflowCalls.push(input); return {}; }
  });
  const detail = await agent.get('/opportunities/20/technical-drafts/41');
  assert.equal(detail.status, 200);
  assert.match(detail.text, /Datasheet\.pdf/);
  assert.match(detail.text, /attachments\/81\/preview/);
  assert.match(detail.text, /attachments\/81\/download/);
  assert.match(detail.text, /Reject Reason/);
  assert.match(detail.text, /Text Reason/);
  assert.match(detail.text, /Upload Files/);
  assert.match(detail.text, /name="decision" value="approve">Approve</);
  assert.match(detail.text, /name="decision" value="reject">Reject</);
  const missingReason = await agent.post('/opportunities/20/technical-drafts/41/review')
    .type('form').send({ decision: 'reject', comment: '  ' });
  assert.equal(missingReason.status, 400);
  assert.equal(workflowCalls.length, 0);
  const returned = await agent.post('/opportunities/20/technical-drafts/41/review')
    .type('form').send({ decision: 'reject', comment: 'Revise capacity', returnTo: 'opportunity' });
  assert.equal(returned.status, 302);
  assert.equal(returned.headers.location, '/opportunities/20#technical-proposal');
  assert.equal(workflowCalls.length, 1);
});

test('technical manager can reject with a review file instead of text and the file remains available', async () => {
  const uploadDir = await mkdtemp(path.join(tmpdir(), 'bestcrm-technical-review-'));
  let savedAttachment = null;
  const workflowCalls = [];
  try {
    const attachmentRepository = {
      async createAttachment(input) {
        savedAttachment = { id: 82, ...input };
        return savedAttachment;
      },
      async findById(id) { return Number(id) === 82 ? savedAttachment : null; }
    };
    const { agent, calls, draft } = await createDraftAgent({
      userId: 6, username: 'manager02', roles: [ROLES.TECHNICAL_MANAGER],
      sourceKind: 'uploaded_file', draftStatus: 'pending',
      uploadedAttachmentId: 81, uploadedFile: { id: 81, originalName: 'Datasheet.pdf' },
      uploadDir, attachmentRepository,
      workflowAction: async (input) => { workflowCalls.push(input); return {}; }
    });
    const returned = await agent.post('/opportunities/20/technical-drafts/41/review')
      .field('decision', 'reject')
      .field('returnTo', 'opportunity')
      .attach('reviewFiles', Buffer.from('%PDF-1.4\nReview notes'), 'Review notes.pdf');
    assert.equal(returned.status, 302);
    assert.equal(savedAttachment.category, 'technical_review');
    assert.equal(savedAttachment.originalName, 'Review notes.pdf');
    assert.equal((await readFile(path.join(uploadDir, savedAttachment.storedPath))).toString(), '%PDF-1.4\nReview notes');
    assert.ok(calls.some(([method, input]) => method === 'addReviewAttachments' && input.attachmentIds[0] === 82));
    assert.equal(workflowCalls[0].action, 'reject_technical_solution');
    assert.equal(workflowCalls[0].payload.comment, '');
    draft.status = 'rejected';
    const detail = await agent.get('/opportunities/20/technical-drafts/41');
    assert.equal(detail.status, 200);
    assert.match(detail.text, /Review notes\.pdf/);
    assert.match(detail.text, /attachments\/82\/preview/);
    assert.match(detail.text, /attachments\/82\/download/);
    const preview = await agent.get('/opportunities/20/attachments/82/preview');
    assert.equal(preview.status, 200);
    assert.match(preview.headers['content-disposition'], /^inline;/);
    const download = await agent.get('/opportunities/20/attachments/82/download');
    assert.equal(download.status, 200);
    assert.match(download.headers['content-disposition'], /^attachment;/);
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
});

test('technical manager can approve without a reason but cannot attach rejection files to approval', async () => {
  const uploadDir = await mkdtemp(path.join(tmpdir(), 'bestcrm-technical-approve-'));
  const workflowCalls = [];
  try {
    const { agent } = await createDraftAgent({
      userId: 6, username: 'manager03', roles: [ROLES.TECHNICAL_MANAGER],
      sourceKind: 'uploaded_file', draftStatus: 'pending',
      uploadedAttachmentId: 81, uploadedFile: { id: 81, originalName: 'Datasheet.pdf' },
      uploadDir,
      workflowAction: async (input) => { workflowCalls.push(input); return {}; }
    });
    const invalid = await agent.post('/opportunities/20/technical-drafts/41/review')
      .field('decision', 'approve')
      .attach('reviewFiles', Buffer.from('%PDF-1.4\nReview notes'), 'Review notes.pdf');
    assert.equal(invalid.status, 400);
    assert.equal(workflowCalls.length, 0);

    const approved = await agent.post('/opportunities/20/technical-drafts/41/review')
      .type('form').send({ decision: 'approve' });
    assert.equal(approved.status, 302);
    assert.equal(workflowCalls.length, 1);
    assert.equal(workflowCalls[0].action, 'approve_technical_solution');
    assert.equal(workflowCalls[0].payload.comment, '');
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
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
  assert.doesNotMatch(response.text, /Capacity|Standard parameters|Documented FAT required\./);
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
    body: 'Project parameters', tableRows: 'Capacity | 20 t/h'
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

test('ready TS-D draft submits through the existing technical approval workflow', async () => {
  const workflowCalls = [];
  const { agent } = await createDraftAgent({
    capacity: 50,
    draftStatus: 'ready',
    workflowAction: async (input) => { workflowCalls.push(input); return {}; }
  });
  const detail = await agent.get('/opportunities/20/technical-drafts/41');
  assert.equal(detail.status, 200);
  assert.match(detail.text, /Submit Technical Version for Approval/);
  const response = await agent.post('/opportunities/20/technical-drafts/41/submit').type('form').send({ comment: 'Ready' });
  assert.equal(response.status, 302);
  assert.equal(workflowCalls[0].action, 'submit_technical_solution');
  assert.equal(workflowCalls[0].payload.technicalDraftId, 41);
});

test('assigned Technical Manager can approve or return a pending TS-D snapshot', async () => {
  const workflowCalls = [];
  const { agent } = await createDraftAgent({
    userId: 6,
    username: 'tech-manager',
    displayName: 'Technical Manager',
    roles: [ROLES.TECHNICAL_MANAGER],
    draftStatus: 'pending',
    workflowAction: async (input) => { workflowCalls.push(input); return {}; }
  });
  const detail = await agent.get('/opportunities/20/technical-drafts/41');
  assert.equal(detail.status, 200);
  assert.match(detail.text, /Technical Manager Review/);
  assert.doesNotMatch(detail.text, /Save Project Section/);
  const response = await agent.post('/opportunities/20/technical-drafts/41/review').type('form').send({ decision: 'approve', comment: 'Approved' });
  assert.equal(response.status, 302);
  assert.equal(workflowCalls[0].action, 'approve_technical_solution');
});

test('approved TS-V files download with exact size and checksum headers', async () => {
  const content = Buffer.from('%PDF-technical-solution');
  const { agent, calls } = await createDraftAgent({
    draftStatus: 'approved',
    formalVersionNo: 1,
    documents: [{
      id: 90,
      technicalDraftId: 41,
      documentNo: 'TS-V1',
      format: 'pdf',
      originalName: 'OPP-20_TS-V1.pdf',
      mimeType: 'application/pdf',
      byteSize: content.length,
      sha256: 'a'.repeat(64),
      content
    }]
  });
  const detail = await agent.get('/opportunities/20/technical-drafts/41');
  assert.match(detail.text, /TS-V1/);
  assert.match(detail.text, new RegExp('a{64}'));
  const response = await agent.get('/opportunities/20/technical-drafts/41/documents/90/download');
  assert.equal(response.status, 200);
  assert.equal(response.headers['x-content-sha256'], 'a'.repeat(64));
  assert.equal(response.headers['content-length'], String(content.length));
  assert.ok(calls.some(([method]) => method === 'findDocument'));
});
