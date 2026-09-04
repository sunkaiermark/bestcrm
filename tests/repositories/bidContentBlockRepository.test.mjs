import test from 'node:test';
import assert from 'node:assert/strict';
import { createBidContentBlockRepository } from '../../src/repositories/bidContentBlockRepository.mjs';

function fakeTarget(responses = []) {
  return { queries: [], async query(sql, params) { this.queries.push({ sql, params }); return responses.shift() || { rows: [] }; } };
}

function blockRow(overrides = {}) {
  return {
    id: '8', block_code: 'PROFILE-01', category: 'common', name_en: 'Company Profile', name_zh: '公司简介',
    applicable_countries: [], applicable_industries: [], applicable_product_families: [],
    applicable_customer_types: [], applicable_sections: ['company_profile'], owner_role_code: 'commercial_manager',
    current_published_revision_id: '30', current_revision_no: '1', current_revision_status: 'published',
    current_language: 'bilingual', current_component_type: 'narrative', current_title_en: 'Profile', current_title_zh: '简介',
    current_sensitivity: 'internal', current_effective_date: '2026-09-01', current_expires_at: null,
    current_attachment_sha256: null, current_library_type: 'public_material',
    latest_revision_no: '2', latest_revision_status: 'draft', latest_language: 'bilingual',
    latest_component_type: 'narrative', latest_title_en: 'Draft profile', latest_title_zh: '草稿简介',
    latest_sensitivity: 'confidential', latest_effective_date: '2026-09-02', latest_expires_at: null,
    latest_attachment_sha256: null, latest_library_type: 'public_material', is_active: true,
    created_by: '5', updated_by: '5', ...overrides
  };
}

test('published-only content listing does not leak latest draft metadata', async () => {
  const target = fakeTarget([{ rows: [blockRow()] }]);
  const repository = createBidContentBlockRepository(target);
  const records = await repository.listBlocks({ categories: ['common'], libraryType: 'public_material', publishedOnly: true });
  assert.equal(records[0].latestRevisionLabel, 'PROFILE-01-R1');
  assert.equal(records[0].latestRevisionStatus, 'published');
  assert.equal(records[0].titleEn, 'Profile');
  assert.equal(records[0].sensitivity, 'internal');
  assert.match(target.queries[0].sql, /current_revision\.status = 'published'/);
  assert.deepEqual(target.queries[0].params, [['common'], 'public_material']);
});

test('content creation binds metadata, first revision, source type, and attachment hash atomically', async () => {
  const target = fakeTarget([{ rows: [{ id: '8', revision_id: '30' }] }]);
  const repository = createBidContentBlockRepository(target);
  const created = await repository.createBlock({
    blockCode: 'ISO-9001', category: 'common', nameEn: 'ISO', nameZh: 'ISO', applicableCountries: [],
    applicableIndustries: [], applicableProductFamilies: [], applicableCustomerTypes: [], applicableSections: [],
    ownerRoleCode: 'commercial_manager', language: 'bilingual', componentType: 'controlled_attachment',
    titleEn: 'ISO', titleZh: 'ISO', contentSchema: {}, conditionSchema: { all: [] }, allowedVariables: [],
    sourceMetadata: { libraryType: 'public_material' },
    attachment: { storedPath: 'bid-content/iso.pdf', originalName: 'iso.pdf', mimeType: 'application/pdf', byteSize: 10, sha256: 'a'.repeat(64) },
    effectiveDate: null, expiresAt: null, reviewDueAt: null, sensitivity: 'internal', changeSummary: 'Initial'
  }, 5);
  assert.deepEqual(created, { id: 8, revisionId: 30 });
  assert.match(target.queries[0].sql, /WITH inserted_block AS/);
  assert.match(target.queries[0].sql, /inserted_revision AS/);
  assert.equal(target.queries[0].params[23], 'a'.repeat(64));
});

test('draft metadata and body update share one atomic statement', async () => {
  const target = fakeTarget([{ rows: [{ id: '31', content_block_id: '8' }] }]);
  const repository = createBidContentBlockRepository(target);
  const result = await repository.updateDraft(8, 31, {
    nameEn: 'Profile', nameZh: '简介', applicableCountries: [], applicableIndustries: [],
    applicableProductFamilies: [], applicableCustomerTypes: [], applicableSections: []
  }, {
    language: 'bilingual', componentType: 'narrative', titleEn: 'Profile', titleZh: '简介',
    contentSchema: { bodyEn: 'Text' }, conditionSchema: { all: [] }, allowedVariables: [],
    sourceMetadata: { libraryType: 'public_material' }, attachment: null,
    effectiveDate: null, expiresAt: null, reviewDueAt: null, sensitivity: 'internal', changeSummary: 'Draft update'
  }, 5);
  assert.deepEqual(result, { id: 31, contentBlockId: 8 });
  assert.match(target.queries[0].sql, /WITH updated_block AS/);
  assert.match(target.queries[0].sql, /updated_revision AS/);
  assert.match(target.queries[0].sql, /revision\.status = 'draft'/);
});

test('content publishing retires the old current revision and moves the stable pointer', async () => {
  const target = fakeTarget([{ rows: [{ id: '31', content_block_id: '8' }] }]);
  const repository = createBidContentBlockRepository(target);
  const result = await repository.publishRevision(31, 5);
  assert.deepEqual(result, { id: 31, contentBlockId: 8 });
  assert.match(target.queries[0].sql, /old_revision\.status = 'published'/);
  assert.match(target.queries[0].sql, /current_published_revision_id = published\.id/);
});
