import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLES } from '../../src/domain/roles.mjs';
import { createBidPackageEditorService } from '../../src/services/bidPackageEditorService.mjs';

const lead = { id: 3, roles: [ROLES.QUOTATION_ENGINEER] };
const support = { id: 4, roles: [ROLES.QUOTATION_ENGINEER] };
const commercialManager = { id: 5, roles: [ROLES.COMMERCIAL_MANAGER] };
const salesperson = { id: 7, roles: [ROLES.SALESPERSON] };

function setup() {
  const calls = [];
  const frozenCommercialBlock = { blockId: 8, blockCode: 'PAY-01', revisionId: 31, revisionNo: 1, contentSchema: { bodyEn: 'Standard terms' } };
  const standardClause = {
    id: 61, clauseCode: 'TECH-CLAUSE-01', revisionNo: 1, revisionLabel: 'TECH-CLAUSE-01-R1',
    title: 'Technical compliance', language: 'bilingual', content: 'Comply with specification',
    conditionSchema: {}, status: 'published'
  };
  const publicMaterialBlock = {
    id: 9, blockCode: 'PUBLIC-01', category: 'commercial', ownerRoleCode: ROLES.COMMERCIAL_MANAGER,
    nameEn: 'Public profile', nameZh: '公开资料', isActive: true, currentPublishedRevisionId: 32,
    currentSensitivity: 'internal', sensitivity: 'internal', libraryType: 'public_material',
    revisions: [{ id: 32, revisionNo: 1, revisionLabel: 'PUBLIC-01-R1', status: 'published',
      language: 'bilingual', componentType: 'narrative', titleEn: 'Profile', titleZh: '资料',
      contentSchema: { bodyEn: 'Public profile' }, sensitivity: 'internal', libraryType: 'public_material' }]
  };
  const opportunity = {
    id: 20, opportunityNo: 'OPP-20', title: 'Mixer', customerId: 8,
    salespersonId: 7, salesManagerId: 2, quotationEngineerId: 3,
    technicalManagerId: 6, commercialManagerId: 5
  };
  const workspace = {
    id: 40, status: 'in_progress', language: 'bilingual',
    sourceMetadata: { technicalClauseSnapshots: [{ ...standardClause, sectionKey: 'process', isTemplateDefault: true }] },
    opportunity: { ...opportunity, customerName: 'Acme' },
    technicalTemplate: { templateCode: 'TECH-1', revisionNo: 1 },
    commercialTemplate: { templateCode: 'COMM-1', revisionNo: 1 },
    technicalDraft: { id: 41 }, commercialDraft: { id: 42 }
  };
  const technicalDraft = {
    id: 41, opportunityId: 20, status: 'draft', draftLabel: 'TS-D1', templateRevisionId: 9,
    templateRevisionNoSnapshot: 1,
    contentSchemaSnapshot: { sections: [
      { key: 'process', labelEn: 'Process', labelZh: '工艺', sortOrder: 1, enabled: true, bodyEn: 'Standard process', bodyZh: '标准工艺', tableRows: [] },
      { key: 'documentation', labelEn: 'Documents', labelZh: '文件', sortOrder: 2, enabled: true, bodyEn: '', bodyZh: '', tableRows: [] }
    ] },
    variableSchemaSnapshot: [{ variableKey: 'capacity', labelEn: 'Capacity', labelZh: '产能', dataType: 'text', sourceField: 'manual', sectionKey: 'process', isRequired: true, validationRules: {} }],
    variableValues: { capacity: '10 t/h' }, selectedClauses: [], validationIssues: [],
    renderedContent: { schemaVersion: 1, sections: [
      { key: 'process', labelEn: 'Process', labelZh: '工艺', sortOrder: 1, included: true, bodyEn: 'Standard process', bodyZh: '标准工艺', tableRows: [], clauses: [] },
      { key: 'documentation', labelEn: 'Documents', labelZh: '文件', sortOrder: 2, included: true, bodyEn: '', bodyZh: '', tableRows: [], clauses: [] }
    ], variables: [{ variableKey: 'capacity', sectionKey: 'process', value: '10 t/h' }] },
    assignments: [{ id: 51, sectionKey: 'process', assigneeUserId: 4, assigneeDisplayName: 'Support', isActive: true }]
  };
  const commercialDraft = {
    id: 42, workspaceId: 40, opportunityId: 20, status: 'draft', draftLabel: 'CP-D1', templateRevisionId: 10,
    templateRevisionNoSnapshot: 1,
    contentSchemaSnapshot: { sections: [
      { key: 'company_profile', labelEn: 'Company', labelZh: '公司', sortOrder: 1, enabled: true, bodyEn: 'Standard company', bodyZh: '', tableRows: [], contentBlockIds: [] },
      { key: 'pricing', labelEn: 'Pricing', labelZh: '价格', sortOrder: 2, enabled: true, bodyEn: 'Standard price', bodyZh: '', tableRows: [], contentBlockIds: [8] }
    ] },
    variableSchemaSnapshot: [{ variableKey: 'total_price', labelEn: 'Total price', labelZh: '总价', dataType: 'number', sourceField: 'total_price', sectionKey: 'pricing', isRequired: true, validationRules: { min: 1 } }],
    variableValues: { total_price: 120000 }, validationIssues: [], sourceMetadata: { contentComponentSnapshots: [frozenCommercialBlock] },
    renderedContent: { schemaVersion: 1, sections: [
      { key: 'company_profile', labelEn: 'Company', labelZh: '公司', sortOrder: 1, included: true, bodyEn: 'Standard company', bodyZh: '', tableRows: [], contentBlocks: [] },
      { key: 'pricing', labelEn: 'Pricing', labelZh: '价格', sortOrder: 2, included: true, bodyEn: 'Standard price', bodyZh: '', tableRows: [], contentBlocks: [frozenCommercialBlock] }
    ], variables: [{ variableKey: 'total_price', sectionKey: 'pricing', value: 120000 }] }
  };
  const editorRepository = {
    async listChanges() { return []; },
    async listEvents() { return []; },
    async listAttachments() { return []; },
    async listSuggestions() { return []; },
    async findAttachment() { return null; },
    async updateTechnicalDraft(input) { calls.push(['updateTechnicalDraft', structuredClone(input)]); return true; },
    async updateCommercialDraft(input) { calls.push(['updateCommercialDraft', structuredClone(input)]); return true; },
    async insertChange(input) { calls.push(['insertChange', structuredClone(input)]); return { id: 90, ...input }; },
    async insertEvent(input) { calls.push(['insertEvent', structuredClone(input)]); return { id: 91, ...input }; },
    async touchWorkspace(id, actorId) { calls.push(['touchWorkspace', id, actorId]); },
    async createAttachment(input) { calls.push(['createAttachment', input]); return { id: 70, ...input }; },
    async removeAttachment(input) { calls.push(['removeAttachment', input]); return input; },
    async createSuggestion(input) { calls.push(['createSuggestion', structuredClone(input)]); return { id: 80, ...input, status: 'draft' }; }
  };
  const dependencies = {
    bidWorkspaceRepository: { async getWorkspaceDetail() { return structuredClone(workspace); } },
    opportunityRepository: { async getOpportunityDetail() { return structuredClone(opportunity); } },
    opportunityResponsibilityRepository: { async listTeamMembersByOpportunity() { return [{ userId: 4, displayName: 'Support', roleCode: ROLES.QUOTATION_ENGINEER, isActive: true }]; } },
    opportunityTechnicalDraftRepository: {
      async getDraftDetail() { return structuredClone(technicalDraft); },
      async addAssignment() { return { id: 52, sectionKey: 'documentation', assigneeUserId: 4 }; },
      async removeAssignment() { return { id: 51 }; }
    },
    opportunityCommercialDraftRepository: { async getDraftDetail() { return structuredClone(commercialDraft); } },
    technicalTemplateRepository: { async listClauses() { return [standardClause]; } },
    bidContentBlockRepository: {
      async listBlocks() { return [publicMaterialBlock]; },
      async getBlockDetail(id) { return Number(id) === 9 ? publicMaterialBlock : null; }
    },
    bidPackageEditorRepository: editorRepository,
    workflowTransaction: null
  };
  return { service: createBidPackageEditorService({ enabled: true, dependencies }), calls, technicalDraft, commercialDraft };
}

test('three-pane technical editor exposes assignment-scoped editing and standard diff state', async () => {
  const { service } = setup();
  const editor = await service.getEditor(support, 40, 'technical', 'process');
  assert.equal(editor.activeSection.key, 'process');
  assert.equal(editor.activeSection.canEdit, true);
  assert.equal(editor.sections.find((section) => section.key === 'documentation').canEdit, false);
  assert.equal(editor.activeSection.modificationStatus, 'standard');
  assert.equal(editor.activeSection.responsibleNames[0], 'Support');
});

test('assigned Quotation Engineer owns commercial editing while salesperson pricing remains read-only', async () => {
  const { service } = setup();
  const leadEditor = await service.getEditor(lead, 40, 'commercial', 'pricing');
  assert.equal(leadEditor.canEditActiveSection, true);
  assert.equal(leadEditor.isPackageLead, true);
  const editor = await service.getEditor(salesperson, 40, 'commercial', 'pricing');
  assert.equal(editor.canEditActiveSection, false);
  assert.equal(editor.activeSection.modificationStatus, 'standard');
  assert.equal(editor.activeSection.diff.contentBlocksChanged, false);
  assert.equal(editor.sections.find((section) => section.key === 'company_profile').canEdit, true);
});

test('section saves alter only the project draft and append both change and actor audit events', async () => {
  const { service, calls } = setup();
  await service.saveSection(lead, 40, 'technical', 'process', {
    bodyEn: 'Project-specific process', bodyZh: '项目工艺', tableRows: 'A | B',
    modificationStatus: 'needs_review', reason: 'Customer specification'
  });
  const update = calls.find(([name]) => name === 'updateTechnicalDraft')[1];
  assert.equal(update.renderedContent.sections[0].bodyEn, 'Project-specific process');
  const change = calls.find(([name]) => name === 'insertChange')[1];
  assert.equal(change.modificationStatus, 'needs_review');
  assert.equal(change.reason, 'Customer specification');
  assert.equal(calls.find(([name]) => name === 'insertEvent')[1].eventType, 'section_saved');
});

test('restore affects one project section and records the frozen template source', async () => {
  const { service, calls, technicalDraft } = setup();
  technicalDraft.selectedClauses = [{ id: 99, clauseCode: 'PROJECT-ONLY', sectionKey: 'process', isTemplateDefault: false }];
  technicalDraft.renderedContent.sections[0].clauses = structuredClone(technicalDraft.selectedClauses);
  await service.restoreSection(lead, 40, 'technical', 'process', { reason: 'Revert rejected customization' });
  const update = calls.find(([name]) => name === 'updateTechnicalDraft')[1];
  assert.equal(update.renderedContent.sections[0].bodyEn, 'Standard process');
  assert.equal(update.renderedContent.sections[1].key, 'documentation');
  assert.equal(update.selectedClauses[0].id, 61);
  assert.equal(update.selectedClauses[0].isTemplateDefault, true);
  assert.equal(calls.find(([name]) => name === 'insertChange')[1].changeType, 'restored');
});

test('package leads can add and reorder project-only sections without changing template snapshots', async () => {
  const { service, calls } = setup();
  const key = await service.addSection(lead, 40, 'technical', {
    sectionKey: 'site_constraints', labelEn: 'Site Constraints', labelZh: '现场条件', reason: 'Tender requirement'
  });
  assert.equal(key, 'site_constraints');
  const update = calls.find(([name]) => name === 'updateTechnicalDraft')[1];
  assert.equal(update.renderedContent.sections.at(-1).projectAdded, true);
  assert.equal(calls.find(([name]) => name === 'insertChange')[1].modificationStatus, 'project_added');
});

test('commercial variables validate typed values and persist actor audit data', async () => {
  const { service, calls } = setup();
  await service.saveVariables(commercialManager, 40, 'commercial', 'pricing', { total_price: '150000', reason: 'Approved quotation' });
  const update = calls.find(([name]) => name === 'updateCommercialDraft')[1];
  assert.equal(update.variableValues.total_price, 150000);
  assert.equal(calls.find(([name]) => name === 'insertEvent')[1].details.changedKeys[0], 'total_price');
  assert.equal(calls.find(([name]) => name === 'insertChange')[1].actorUserId, 5);
});

test('technical clause selection is section-scoped and copied into the project draft', async () => {
  const { service, calls } = setup();
  await service.selectContent(lead, 40, 'technical', 'process', {
    contentIds: ['61'], reason: 'Applicable technical compliance clause'
  });
  const update = calls.find(([name]) => name === 'updateTechnicalDraft')[1];
  assert.equal(update.selectedClauses[0].sectionKey, 'process');
  assert.equal(update.renderedContent.sections[0].clauses[0].clauseCode, 'TECH-CLAUSE-01');
  assert.equal(calls.find(([name]) => name === 'insertEvent')[1].eventType, 'content_selected');
});

test('commercial public material selection deep-copies the published revision into one project section', async () => {
  const { service, calls } = setup();
  await service.selectContent(commercialManager, 40, 'commercial', 'pricing', {
    contentIds: ['9'], reason: 'Include published company profile'
  });
  const update = calls.find(([name]) => name === 'updateCommercialDraft')[1];
  const selected = update.renderedContent.sections.find((section) => section.key === 'pricing').contentBlocks[0];
  assert.equal(selected.blockCode, 'PUBLIC-01');
  assert.equal(selected.revisionId, 32);
  assert.equal(calls.find(([name]) => name === 'insertChange')[1].changeType, 'source_changed');
});

test('library suggestions create a separate draft snapshot and never mutate controlled sources', async () => {
  const { service, calls } = setup();
  await service.suggestLibrary(commercialManager, 40, 'commercial', 'pricing', {
    title: 'Reusable pricing note', targetKind: 'content_block', reason: 'Useful for similar tenders'
  });
  const suggestion = calls.find(([name]) => name === 'createSuggestion')[1];
  assert.equal(suggestion.contentSnapshot.section.key, 'pricing');
  assert.equal(suggestion.targetKind, 'content_block');
  assert.equal(calls.some(([name]) => name === 'updateCommercialDraft'), false);
});

test('mutations require a non-empty reason and submitted drafts remain read-only', async () => {
  const { service, commercialDraft } = setup();
  await assert.rejects(() => service.saveSection(commercialManager, 40, 'commercial', 'pricing', {
    bodyEn: 'Changed', bodyZh: '', tableRows: '', reason: ''
  }), /Change reason is required/);
  commercialDraft.status = 'review_pending';
  await assert.rejects(() => service.saveSection(commercialManager, 40, 'commercial', 'pricing', {
    bodyEn: 'Changed', bodyZh: '', tableRows: '', reason: 'Late edit'
  }), (error) => error.statusCode === 409);
});
