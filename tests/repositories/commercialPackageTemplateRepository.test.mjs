import test from 'node:test';
import assert from 'node:assert/strict';
import { createCommercialPackageTemplateRepository } from '../../src/repositories/commercialPackageTemplateRepository.mjs';

function fakeTarget(responses = []) {
  return { queries: [], async query(sql, params) { this.queries.push({ sql, params }); return responses.shift() || { rows: [] }; } };
}

test('commercial template repository maps CTPL revisions and published-only lookup', async () => {
  const target = fakeTarget([{ rows: [{
    id: '4', template_code: 'COMM-GLOBAL', name_en: 'Global Commercial Package', name_zh: '全球商务包',
    language: 'bilingual', applicable_countries: ['CN'], applicable_industries: [], applicable_customer_types: [],
    current_published_revision_id: '9', current_revision_no: '2', current_revision_status: 'published',
    latest_revision_no: '2', latest_revision_status: 'published', is_active: true,
    created_by: '5', updated_by: '5'
  }] }]);
  const repository = createCommercialPackageTemplateRepository(target);
  const records = await repository.listTemplates({ publishedOnly: true });
  assert.equal(records[0].currentRevisionLabel, 'CTPL-R2');
  assert.deepEqual(records[0].applicableCountries, ['CN']);
  assert.match(target.queries[0].sql, /current_revision\.status = 'published'/);
});

test('commercial template creation stores template and first draft in one statement', async () => {
  const target = fakeTarget([{ rows: [{ id: '4', revision_id: '9' }] }]);
  const repository = createCommercialPackageTemplateRepository(target);
  const created = await repository.createTemplate({
    templateCode: 'COMM-GLOBAL', nameEn: 'Global', nameZh: '全球', language: 'bilingual',
    applicableCountries: [], applicableIndustries: [], applicableCustomerTypes: [],
    changeSummary: 'Initial', contentSchema: { schemaVersion: 1, sections: [] }
  }, 5);
  assert.deepEqual(created, { id: 4, revisionId: 9 });
  assert.match(target.queries[0].sql, /WITH inserted_template AS/);
  assert.match(target.queries[0].sql, /inserted_revision AS/);
});

test('commercial publishing atomically retires the prior current revision and updates the master', async () => {
  const target = fakeTarget([{ rows: [{ id: '10', template_id: '4' }] }]);
  const repository = createCommercialPackageTemplateRepository(target);
  const result = await repository.publishRevision(10, 5);
  assert.deepEqual(result, { id: 10, templateId: 4 });
  assert.match(target.queries[0].sql, /old_revision\.status = 'published'/);
  assert.match(target.queries[0].sql, /current_published_revision_id = published\.id/);
});

test('commercial revision cloning refuses a second open revision in SQL', async () => {
  const target = fakeTarget([{ rows: [{ id: '10', template_id: '4', revision_no: '2' }] }]);
  const repository = createCommercialPackageTemplateRepository(target);
  const result = await repository.createRevision(4, 'Annual update', 5);
  assert.equal(result.revisionNo, 2);
  assert.match(target.queries[0].sql, /NOT EXISTS/);
  assert.match(target.queries[0].sql, /status IN \('draft', 'review_pending'\)/);
});
