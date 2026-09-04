import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { createQuotationPackageDocumentService } from '../../src/services/quotationPackageDocumentService.mjs';
import { ROLES } from '../../src/domain/roles.mjs';

const workspace = {
  id: 40, opportunityId: 20, language: 'bilingual', outputProfileId: 5,
  sourceMetadata: { outputProfile: { id: 5, revisionNo: 2, layoutSettings: {}, brandAssets: {} } },
  outputProfile: { id: 5, revisionNo: 2 },
  opportunity: {
    id: 20, opportunityNo: '812345', title: 'Anonymous Project', customerName: 'Example Customer',
    salespersonId: 7, salesManagerId: 8, quotationEngineerId: 9,
    technicalManagerId: 10, commercialManagerId: 12
  }
};
const packageVersion = {
  id: 60, workspaceId: 40, opportunityId: 20, status: 'approved', versionNo: 1,
  technicalSolutionVersionId: 41, commercialDraftId: 42, commercialQuoteId: 43,
  commercialLineItems: [{ itemName: 'Mixer', quantity: 1, unit: 'set', unitPrice: 100, subtotal: 100 }],
  currency: 'USD', totalPrice: 100, deliveryPeriod: '12 weeks', paymentTerms: '30/60/10',
  validUntil: '2026-12-31', reviewedAt: '2026-09-01T08:00:00.000Z',
  reviewedBy: 8, reviewerDisplayName: 'Sales Manager', reviewComment: 'Approved', attachments: []
};
const technicalDraft = {
  id: 41, status: 'approved', formalVersionNo: 2, formalVersionLabel: 'TS-V2',
  language: 'bilingual', reviewedAt: '2026-08-30T08:00:00.000Z', renderedContent: { variables: [], sections: [] },
  sourceMetadata: {}
};
const commercialDraft = {
  id: 42, status: 'approved', formalVersionNo: 3, formalVersionLabel: 'CP-V3',
  language: 'bilingual', reviewedAt: '2026-08-31T08:00:00.000Z', renderedContent: { variables: [], sections: [] },
  sourceMetadata: { contentComponentSnapshots: [] }
};

function fixture() {
  const stored = [];
  const events = [];
  const renderer = {
    async generatePackage(input) {
      const contentA = Buffer.from(`${input.packageType}:docx:${input.versionLabel}`);
      const contentB = Buffer.from(`${input.packageType}:pdf:${input.versionLabel}`);
      return [
        { documentNo: input.versionLabel, format: 'docx', originalName: `${input.packageType}.docx`, mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', content: contentA, byteSize: contentA.length, sha256: 'a'.repeat(64) },
        { documentNo: input.versionLabel, format: 'pdf', originalName: `${input.packageType}.pdf`, mimeType: 'application/pdf', content: contentB, byteSize: contentB.length, sha256: 'b'.repeat(64) }
      ];
    }
  };
  const quotationPackageDocumentRepository = {
    async lockPackage() {},
    async listByPackage() { return stored; },
    async listByWorkspace() { return stored; },
    async findById(id) { return stored.find((item) => item.id === Number(id)) || null; },
    async createMany(input) {
      input.documents.forEach((document, index) => stored.push({
        ...document, id: index + 1, quotationPackageVersionId: input.quotationPackageVersionId,
        workspaceId: input.workspaceId, generationKey: input.generationKey,
        sourceSnapshotSha256: input.sourceSnapshotSha256, generatorVersion: input.generatorVersion
      }));
      return stored;
    }
  };
  const dependencies = {
    bidPackageApprovalService: { async _completeContext() { return { workspace, source: packageVersion }; } },
    bidWorkspaceRepository: { async getWorkspaceDetail() { return workspace; } },
    quotationPackageRepository: {
      async listByOpportunity() { return [packageVersion]; },
      async getPackageDetail() { return packageVersion; }
    },
    opportunityTechnicalDraftRepository: { async getDraftDetail() { return technicalDraft; } },
    opportunityCommercialDraftRepository: { async getDraftDetail() { return commercialDraft; } },
    bidPackageEditorRepository: {
      async listAttachments() { return []; },
      async insertEvent(event) { events.push(event); return event; }
    },
    quotationPackageDocumentRepository,
    async workflowTransaction(callback) { return callback(dependencies); }
  };
  const service = createQuotationPackageDocumentService({
    enabled: true, dependencies, options: { bidDocumentRenderer: renderer }
  });
  return { service, stored, events };
}

test('assigned Project Lead QE generates one idempotent eight-file controlled set', async () => {
  const { service, stored, events } = fixture();
  const actor = { id: 9, displayName: 'Lead QE', roles: [ROLES.QUOTATION_ENGINEER] };
  const first = await service.generate(actor, 40, 60);
  const second = await service.generate(actor, 40, 60);
  assert.equal(first.length, 8);
  assert.equal(second.length, 8);
  assert.equal(stored.length, 8);
  assert.deepEqual(new Set(stored.map((item) => item.documentType)), new Set([
    'technical_docx', 'technical_pdf', 'commercial_docx', 'commercial_pdf',
    'complete_docx', 'complete_pdf', 'attachments_zip', 'manifest_json'
  ]));
  assert.equal(new Set(stored.map((item) => item.generationKey)).size, 1);
  const manifest = JSON.parse(stored.find((item) => item.documentType === 'manifest_json').content.toString('utf8'));
  assert.equal(manifest.files.length, 7);
  assert.equal(manifest.manifest.excludedFromFilesToAvoidCircularHash, true);
  const archive = await JSZip.loadAsync(stored.find((item) => item.documentType === 'attachments_zip').content);
  assert.ok(archive.file('attachments-manifest.json'));
  assert.equal(events.filter((item) => item.eventType === 'generated_bid_package_outputs').length, 1);
});

test('generation is denied to administrators and unresolved frozen placeholders fail closed', async () => {
  const adminFixture = fixture();
  await assert.rejects(
    adminFixture.service.generate({ id: 1, roles: [ROLES.ADMINISTRATOR] }, 40, 60),
    (error) => error.statusCode === 403
  );
  const placeholderFixture = fixture();
  const original = technicalDraft.renderedContent;
  technicalDraft.renderedContent = { sections: [{ bodyEn: '{{missing}}' }] };
  try {
    await assert.rejects(
      placeholderFixture.service.generate({ id: 9, roles: [ROLES.QUOTATION_ENGINEER] }, 40, 60),
      (error) => error.statusCode === 409
    );
    assert.equal(placeholderFixture.stored.length, 0);
  } finally {
    technicalDraft.renderedContent = original;
  }
});

test('technical output download is available to an authorized technical viewer but commercial output is not', async () => {
  const { service, stored, events } = fixture();
  await service.generate({ id: 9, roles: [ROLES.QUOTATION_ENGINEER] }, 40, 60);
  const viewer = { id: 11, roles: [ROLES.QUOTATION_ENGINEER] };
  const technical = stored.find((item) => item.documentType === 'technical_pdf');
  const commercial = stored.find((item) => item.documentType === 'commercial_pdf');
  assert.equal((await service.download(viewer, 40, technical.id)).id, technical.id);
  await assert.rejects(service.download(viewer, 40, commercial.id), (error) => error.statusCode === 403);
  assert.equal(events.some((item) => item.eventType === 'downloaded_bid_output'), true);
});
