import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLES } from '../../src/domain/roles.mjs';
import {
  canCreateBidWorkspace,
  collectBidWorkspaceVariableOverrides,
  createBidWorkspaceService
} from '../../src/services/bidWorkspaceService.mjs';

const lead = { id: 3, roles: [ROLES.QUOTATION_ENGINEER] };
const support = { id: 4, roles: [ROLES.QUOTATION_ENGINEER] };

function opportunity(overrides = {}) {
  return {
    id: 20, opportunityNo: 'OPP-20', title: 'Mixer Project', customerId: 8, primaryContactId: 9,
    salespersonId: 7, salesManagerId: 2, quotationEngineerId: 3, technicalManagerId: 6,
    commercialManagerId: 5,
    teamMembers: [{ userId: 4, roleCode: ROLES.QUOTATION_ENGINEER, isActive: true }],
    ...overrides
  };
}

function fixtures() {
  const technicalRevision = {
    id: 9, revisionNo: 2, status: 'published',
    contentSchema: { schemaVersion: 1, sections: [{ key: 'cover', sortOrder: 1, enabled: true, defaultClauseIds: [] }] },
    variables: []
  };
  const technicalTemplate = {
    id: 4, templateCode: 'MX-100', name: 'Mixer Agreement', productModel: 'MX-100', language: 'bilingual',
    isActive: true, currentPublishedRevisionId: 9, revisions: [technicalRevision]
  };
  const commercialRevision = {
    id: 10, revisionNo: 1, status: 'published',
    contentSchema: { schemaVersion: 1, sections: [{ key: 'pricing', sortOrder: 1, contentBlockIds: [8] }] },
    variableSchema: [{
      variableKey: 'total_price', labelEn: 'Total price', labelZh: '总价', dataType: 'number',
      sourceField: 'total_price', sectionKey: 'pricing', isRequired: true, defaultValue: '',
      validationRules: { min: 1 }, sortOrder: 1
    }],
    validationRules: {}
  };
  const commercialTemplate = {
    id: 5, templateCode: 'COMM-GLOBAL', nameEn: 'Global Commercial', nameZh: '全球商务包',
    language: 'bilingual', isActive: true, currentPublishedRevisionId: 10, revisions: [commercialRevision]
  };
  const outputProfile = {
    id: 30, profileCode: 'GLOBAL', revisionNo: 1, revisionLabel: 'GLOBAL-R1', nameEn: 'Global output',
    nameZh: '全球输出', languageMode: 'bilingual', layoutSettings: { pageSize: 'A4' }, brandAssets: { logo: 'SUNKAIER' }
  };
  const content = {
    blockId: 8, blockCode: 'PAYMENT-01', category: 'commercial', ownerRoleCode: ROLES.COMMERCIAL_MANAGER,
    revisionId: 31, revisionNo: 1, revisionLabel: 'PAYMENT-01-R1', language: 'bilingual',
    componentType: 'controlled_attachment', titleEn: 'Payment', titleZh: '付款', contentSchema: {},
    effectiveDate: '2026-01-01', expiresAt: null, sensitivity: 'confidential',
    attachmentStoredPath: 'bid/payment.pdf', attachmentOriginalName: 'payment.pdf',
    attachmentMimeType: 'application/pdf', attachmentByteSize: 10, attachmentSha256: 'c'.repeat(64)
  };
  const context = {
    opportunityId: 20, opportunityNo: 'OPP-20', opportunityTitle: 'Mixer Project', requirementSummary: '10 t/h',
    estimatedAmount: 120000, productName: 'Mixer', projectType: 'Bid', deliveryCycle: '12 weeks',
    expectedBidDate: '2026-10-01', customerId: 8, customerName: 'Acme', customerAddress: 'Shanghai',
    customerCountry: 'CN', customerRegion: 'East', customerIndustry: 'Chemical', customerWebsite: 'https://acme.test',
    contactId: 9, contactName: 'Lee', contactTitle: 'Director', contactEmail: 'lee@acme.test', contactPhone: '123',
    opportunityOwner: 'Sales', technicalManager: 'Tech', commercialManager: 'Commercial', quoteId: 12,
    quoteVersionNo: 3, quotationNumber: 'Q12-V3', totalPrice: 120000, paymentTerms: '30/70', quoteItems: []
  };
  return { technicalTemplate, commercialTemplate, outputProfile, content, context };
}

function setup({ existing = null, workspaceVisible = true, transaction = true } = {}) {
  const source = fixtures();
  const calls = [];
  const created = {};
  const detail = {
    id: 40, opportunityId: 20, language: 'en', status: 'in_progress',
    commercialTemplate: { templateCode: 'COMM-GLOBAL' },
    commercialDraft: { id: 42, draftLabel: 'CP-D1', status: 'draft', sourceMetadata: { contentComponentSnapshots: [source.content] } }
  };
  const repositories = {
    bidWorkspaceRepository: {
      async listWorkspaces(filter) { calls.push(['listWorkspaces', filter]); return workspaceVisible ? [detail] : []; },
      async getWorkspaceDetail(id, filter) { calls.push(['getWorkspaceDetail', Number(id), filter]); return workspaceVisible ? structuredClone(detail) : null; },
      async findByOpportunity(id) { calls.push(['findByOpportunity', Number(id)]); return existing; },
      async listPublishedOutputProfiles() { return [source.outputProfile]; },
      async findPublishedOutputProfile(id) { return Number(id) === 30 ? source.outputProfile : null; },
      async getGenerationContext() { return source.context; },
      async listCurrentPublishedContentSnapshots() { return [source.content]; },
      async createWorkspace(input) { created.workspace = structuredClone(input); return { id: 40 }; }
    },
    technicalTemplateRepository: {
      async listTemplates() { return [source.technicalTemplate]; },
      async getTemplateDetail() { return source.technicalTemplate; },
      async listClauses() { return []; }
    },
    commercialPackageTemplateRepository: {
      async listTemplates() { return [source.commercialTemplate]; },
      async getTemplateDetail() { return source.commercialTemplate; }
    },
    opportunityTechnicalDraftRepository: {
      async createDraft(input) { created.technical = structuredClone(input); return { id: 41, ...input }; }
    },
    opportunityCommercialDraftRepository: {
      async createDraft(input) { created.commercial = structuredClone(input); return { id: 42, ...input }; }
    }
  };
  const workflowTransaction = transaction ? async (callback) => {
    calls.push(['transaction']);
    return callback(repositories);
  } : null;
  const service = createBidWorkspaceService({ enabled: true, dependencies: { ...repositories, workflowTransaction } });
  return { service, calls, created, source, detail };
}

test('workspace creation roles require both an approved role and direct opportunity responsibility', () => {
  assert.equal(canCreateBidWorkspace(lead, opportunity()), true);
  assert.equal(canCreateBidWorkspace(support, opportunity()), false);
  assert.equal(canCreateBidWorkspace({ id: 2, roles: [ROLES.SALES_MANAGER] }, opportunity()), true);
  assert.equal(canCreateBidWorkspace({ id: 99, roles: [ROLES.SALES_MANAGER] }, opportunity()), false);
  assert.equal(canCreateBidWorkspace({ id: 99, roles: [ROLES.ADMINISTRATOR] }, opportunity()), true);
});

test('variable override collection accepts only scoped safe keys', () => {
  assert.deepEqual(collectBidWorkspaceVariableOverrides({
    technical__capacity: '10', commercial__price: '20', technical__Bad: 'x', arbitrary: 'x'
  }, 'technical'), { capacity: '10' });
});

test('workspace list and direct detail always pass the actor visibility filter to the repository', async () => {
  const { service, calls } = setup({ transaction: false });
  await service.list({ id: 7, roles: [ROLES.SALESPERSON] });
  await service.get({ id: 7, roles: [ROLES.SALESPERSON] }, 40);
  assert.deepEqual(calls.find(([method]) => method === 'listWorkspaces')[1], { visibleToUserId: 7 });
  assert.deepEqual(calls.find(([method]) => method === 'getWorkspaceDetail')[2], { visibleToUserId: 7 });
});

test('workspace creation atomically freezes one technical and one commercial project snapshot', async () => {
  const { service, calls, created, source } = setup();
  const result = await service.create(lead, opportunity(), {
    language: 'en', technicalTemplateRevisionId: 9, commercialTemplateRevisionId: 10,
    outputProfileId: 30, commercial__total_price: '150000'
  });
  assert.equal(result.id, 40);
  assert.ok(calls.some(([method]) => method === 'transaction'));
  assert.equal(created.workspace.technicalTemplateRevisionId, 9);
  assert.equal(created.workspace.commercialTemplateRevisionId, 10);
  assert.equal(created.workspace.sourceMetadata.outputProfile.layoutSettings.pageSize, 'A4');
  assert.equal(created.workspace.sourceMetadata.contentComponentReferences[0].attachmentSha256, 'c'.repeat(64));
  assert.equal(created.technical.templateRevisionNoSnapshot, 2);
  assert.equal(created.commercial.workspaceId, 40);
  assert.equal(created.commercial.variableValues.total_price, 150000);
  assert.equal(created.commercial.sourceMetadata.variableValueSources.total_price.sourceType, 'manual_override');
  source.outputProfile.layoutSettings.pageSize = 'Letter';
  source.content.attachmentSha256 = 'd'.repeat(64);
  assert.equal(created.workspace.sourceMetadata.outputProfile.layoutSettings.pageSize, 'A4');
  assert.equal(created.commercial.sourceMetadata.contentComponentSnapshots[0].attachmentSha256, 'c'.repeat(64));
});

test('creation refuses stale selections and a second workspace for the same opportunity', async () => {
  const duplicate = setup({ existing: { id: 40 }, transaction: false });
  await assert.rejects(() => duplicate.service.create(lead, opportunity(), {
    language: 'en', technicalTemplateRevisionId: 9, commercialTemplateRevisionId: 10, outputProfileId: 30
  }), (error) => error.statusCode === 409);

  const stale = setup({ transaction: false });
  await assert.rejects(() => stale.service.preview(lead, opportunity(), {
    language: 'en', technicalTemplateRevisionId: 999, commercialTemplateRevisionId: 10, outputProfileId: 30
  }), /no longer current and published/);
});

test('required and typed values are validated while valid CRM values remain traceable', async () => {
  const { service } = setup({ transaction: false });
  await assert.rejects(() => service.preview(lead, opportunity(), {
    language: 'en', technicalTemplateRevisionId: 9, commercialTemplateRevisionId: 10,
    outputProfileId: 30, commercial__total_price: 'not-a-number'
  }), /invalid number/);
  const preview = await service.preview(lead, opportunity(), {
    language: 'en', technicalTemplateRevisionId: 9, commercialTemplateRevisionId: 10, outputProfileId: 30
  });
  assert.equal(preview.commercialSnapshot.variableValues.total_price, 120000);
  assert.equal(preview.commercialSnapshot.sourceMetadata.variableValueSources.total_price.sourceType, 'crm');
});

test('supporting engineer cannot create, and invisible direct workspace access returns not found', async () => {
  const denied = setup({ transaction: false });
  await assert.rejects(() => denied.service.preview(support, opportunity(), {}), (error) => error.statusCode === 403);
  const invisible = setup({ transaction: false, workspaceVisible: false });
  await assert.rejects(() => invisible.service.get({ id: 99, roles: [ROLES.SALESPERSON] }, 40), (error) => error.statusCode === 404);
});

test('controlled workspace attachments enforce category and sensitivity after opportunity access', async () => {
  const { service } = setup({ transaction: false });
  const salesManager = { id: 2, roles: [ROLES.SALES_MANAGER] };
  const attachment = await service.getAttachment(salesManager, 40, 31);
  assert.equal(attachment.attachmentOriginalName, 'payment.pdf');
  await assert.rejects(() => service.getAttachment({ id: 6, roles: [ROLES.TECHNICAL_MANAGER] }, 40, 31),
    (error) => error.statusCode === 403);
});

test('feature flag denies all project workspace access before repositories are called', async () => {
  let called = false;
  const service = createBidWorkspaceService({ enabled: false, dependencies: {
    bidWorkspaceRepository: { async listWorkspaces() { called = true; return []; } }
  } });
  await assert.rejects(() => service.list(lead), (error) => error.statusCode === 404);
  assert.equal(called, false);
});
