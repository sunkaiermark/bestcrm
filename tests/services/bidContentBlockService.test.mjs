import test from 'node:test';
import assert from 'node:assert/strict';
import { BID_LIBRARY_TYPES } from '../../src/domain/bidCenterLibrary.mjs';
import { ROLES } from '../../src/domain/roles.mjs';
import {
  canAuthorBidContentBlock,
  canViewBidContentBlock,
  createBidContentBlockService,
  normalizeBidContentBlockInput
} from '../../src/services/bidContentBlockService.mjs';

const actor = (role, id = 7) => ({ id, roles: [role] });

function block(overrides = {}) {
  return {
    id: 8,
    blockCode: 'PAYMENT-01',
    category: 'commercial',
    ownerRoleCode: ROLES.COMMERCIAL_MANAGER,
    currentPublishedRevisionId: 30,
    isActive: true,
    latestRevisionStatus: 'published',
    currentSensitivity: 'confidential',
    sensitivity: 'confidential',
    libraryType: BID_LIBRARY_TYPES.STANDARD_CLAUSE,
    revisions: [{
      id: 30,
      status: 'published',
      libraryType: BID_LIBRARY_TYPES.STANDARD_CLAUSE,
      attachmentSha256: '',
      sourceMetadata: { libraryType: BID_LIBRARY_TYPES.STANDARD_CLAUSE }
    }],
    ...overrides
  };
}

test('content visibility blocks technical-only roles from sensitive commercial clauses', () => {
  const commercial = block();
  assert.equal(canViewBidContentBlock(actor(ROLES.TECHNICAL_MANAGER), commercial), false);
  assert.equal(canViewBidContentBlock(actor(ROLES.COMMERCIAL_MANAGER), commercial), true);
  assert.equal(canViewBidContentBlock(actor(ROLES.SALES_MANAGER), commercial), true);
  assert.equal(canViewBidContentBlock(actor(ROLES.SALESPERSON), commercial), false);
  assert.equal(canViewBidContentBlock(actor(ROLES.ADMINISTRATOR), commercial), true);
  assert.equal(canAuthorBidContentBlock(actor(ROLES.COMMERCIAL_MANAGER), commercial), true);
  assert.equal(canAuthorBidContentBlock(actor(ROLES.ADMINISTRATOR), commercial), false);
});

test('category determines the independent business owner', () => {
  const technical = normalizeBidContentBlockInput({
    blockCode: 'fat-01', category: 'technical', ownerRoleCode: ROLES.COMMERCIAL_MANAGER,
    nameEn: 'FAT', nameZh: '出厂验收', language: 'bilingual', componentType: 'narrative',
    sensitivity: 'internal', changeSummary: 'Initial'
  }, { libraryType: BID_LIBRARY_TYPES.STANDARD_CLAUSE });
  const commercial = normalizeBidContentBlockInput({
    blockCode: 'payment-01', category: 'commercial', ownerRoleCode: ROLES.TECHNICAL_MANAGER,
    nameEn: 'Payment', nameZh: '付款', language: 'bilingual', componentType: 'narrative',
    sensitivity: 'confidential', changeSummary: 'Initial'
  }, { libraryType: BID_LIBRARY_TYPES.STANDARD_CLAUSE });
  assert.equal(technical.ownerRoleCode, ROLES.TECHNICAL_MANAGER);
  assert.equal(commercial.ownerRoleCode, ROLES.COMMERCIAL_MANAGER);
});

test('controlled attachments require a SHA-256 bound file and valid dates', () => {
  const input = {
    blockCode: 'iso-9001', category: 'common', ownerRoleCode: ROLES.COMMERCIAL_MANAGER,
    nameEn: 'ISO 9001 Certificate', nameZh: 'ISO 9001 证书', language: 'bilingual',
    componentType: 'controlled_attachment', sensitivity: 'internal', changeSummary: 'Initial',
    effectiveDate: '2026-09-01', expiresAt: '2025-09-01'
  };
  assert.throws(() => normalizeBidContentBlockInput(input, {
    libraryType: BID_LIBRARY_TYPES.PUBLIC_MATERIAL
  }), /Expiry date/);
  input.expiresAt = '2027-09-01';
  assert.throws(() => normalizeBidContentBlockInput(input, {
    libraryType: BID_LIBRARY_TYPES.PUBLIC_MATERIAL
  }), /requires a controlled attachment/);
  const normalized = normalizeBidContentBlockInput(input, {
    libraryType: BID_LIBRARY_TYPES.PUBLIC_MATERIAL,
    attachment: { storedPath: 'bid-content/a.pdf', originalName: 'iso.pdf', mimeType: 'application/pdf', byteSize: 12, sha256: 'a'.repeat(64) }
  });
  assert.equal(normalized.attachment.sha256, 'a'.repeat(64));
});

test('only the owning manager creates and publishes a content category', async () => {
  const calls = [];
  const record = block({
    latestRevisionStatus: 'review_pending',
    revisions: [{
      id: 30,
      status: 'review_pending',
      libraryType: BID_LIBRARY_TYPES.STANDARD_CLAUSE,
      attachmentSha256: '',
      sourceMetadata: { libraryType: BID_LIBRARY_TYPES.STANDARD_CLAUSE }
    }]
  });
  const service = createBidContentBlockService({
    enabled: true,
    repository: {
      async createBlock(input, actorUserId) { calls.push({ method: 'create', input, actorUserId }); return { id: 8, revisionId: 30 }; },
      async getBlockDetail() { return structuredClone(record); },
      async publishRevision(revisionId, actorUserId) { calls.push({ method: 'publish', revisionId, actorUserId }); return { id: revisionId, contentBlockId: 8 }; }
    }
  });
  await service.create(actor(ROLES.COMMERCIAL_MANAGER, 5), BID_LIBRARY_TYPES.STANDARD_CLAUSE, {
    blockCode: 'payment-01', category: 'commercial', nameEn: 'Payment', nameZh: '付款',
    language: 'bilingual', componentType: 'narrative', sensitivity: 'confidential', changeSummary: 'Initial'
  });
  await service.publish(actor(ROLES.COMMERCIAL_MANAGER, 5), BID_LIBRARY_TYPES.STANDARD_CLAUSE, 8, 30);
  assert.deepEqual(calls.map((call) => call.method), ['create', 'publish']);
  await assert.rejects(
    service.publish(actor(ROLES.TECHNICAL_MANAGER), BID_LIBRARY_TYPES.STANDARD_CLAUSE, 8, 30),
    (error) => error.statusCode === 403
  );
  await assert.rejects(
    service.publish(actor(ROLES.ADMINISTRATOR), BID_LIBRARY_TYPES.STANDARD_CLAUSE, 8, 30),
    (error) => error.statusCode === 403
  );
});

test('content lifecycle binds the revision to the content block in the direct URL', async () => {
  let publishCalls = 0;
  const record = block({
    revisions: [{
      id: 30,
      status: 'review_pending',
      libraryType: BID_LIBRARY_TYPES.STANDARD_CLAUSE,
      attachmentSha256: '',
      sourceMetadata: { libraryType: BID_LIBRARY_TYPES.STANDARD_CLAUSE }
    }]
  });
  const service = createBidContentBlockService({
    enabled: true,
    repository: {
      async getBlockDetail() { return structuredClone(record); },
      async publishRevision() { publishCalls += 1; return { id: 31, contentBlockId: 8 }; }
    }
  });
  await assert.rejects(
    service.publish(actor(ROLES.COMMERCIAL_MANAGER), BID_LIBRARY_TYPES.STANDARD_CLAUSE, 8, 31),
    (error) => error.statusCode === 404
  );
  assert.equal(publishCalls, 0);
});

test('direct attachment access filters unpublished revisions for non-owners', async () => {
  const record = block({
    currentSensitivity: 'internal',
    sensitivity: 'internal',
    revisions: [
      { id: 31, status: 'draft', attachmentSha256: 'b'.repeat(64), sourceMetadata: { libraryType: BID_LIBRARY_TYPES.STANDARD_CLAUSE } },
      { id: 30, status: 'published', attachmentSha256: 'a'.repeat(64), sourceMetadata: { libraryType: BID_LIBRARY_TYPES.STANDARD_CLAUSE } }
    ]
  });
  const service = createBidContentBlockService({
    enabled: true,
    repository: { async getBlockDetail() { return structuredClone(record); } }
  });
  await assert.rejects(
    service.getAttachment(actor(ROLES.SALESPERSON), BID_LIBRARY_TYPES.STANDARD_CLAUSE, 8, 31),
    (error) => error.statusCode === 404
  );
  const published = await service.getAttachment(actor(ROLES.SALESPERSON), BID_LIBRARY_TYPES.STANDARD_CLAUSE, 8, 30);
  assert.equal(published.id, 30);
});
