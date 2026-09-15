import test from 'node:test';
import assert from 'node:assert/strict';
import { createOpportunityTechnicalDocumentRepository } from '../../src/repositories/opportunityTechnicalDocumentRepository.mjs';

function equipmentRow(overrides = {}) {
  return {
    id: '12', opportunity_id: '20', item_no: '2', product_category_code: 'mixer',
    equipment_name: 'Reactor Agitator', model: 'SK-MX', quantity: '2',
    technical_parameters: '[{"key":"capacity","value":"10 t/h"}]',
    archived_at: null, archived_by: null, created_by: '3', updated_by: '3',
    created_at: '2026-09-15', updated_at: '2026-09-15', ...overrides
  };
}

test('equipment creation allocates a stable per-opportunity item number and records an event', async () => {
  const calls = [];
  const repository = createOpportunityTechnicalDocumentRepository({
    async query(sql, params) { calls.push({ sql, params }); return { rows: [equipmentRow()] }; }
  });
  const created = await repository.createEquipment({
    opportunityId: 20,
    productCategoryCode: 'mixer',
    equipmentName: 'Reactor Agitator',
    model: 'SK-MX',
    quantity: 2,
    technicalParameters: [{ key: 'capacity', value: '10 t/h' }],
    actorUserId: 3
  });
  assert.equal(created.itemNo, 2);
  assert.equal(created.technicalParameters[0].key, 'capacity');
  assert.match(calls[0].sql, /pg_advisory_xact_lock/);
  assert.match(calls[0].sql, /MAX\(item_no\)/);
  assert.match(calls[0].sql, /opportunity_equipment_item_events/);
});

test('V1 creation stores document, source snapshots, two files, and events in one statement', async () => {
  const calls = [];
  const repository = createOpportunityTechnicalDocumentRepository({
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [{ document_id: '30', version_id: '40', version_no: '1', document_code: 'OPP-20-02-DATASHEET' }] };
    }
  });
  const files = [
    { format: 'docx', originalName: 'a.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', content: Buffer.from('PK-docx'), byteSize: 7, sha256: 'a'.repeat(64) },
    { format: 'pdf', originalName: 'a.pdf', mimeType: 'application/pdf', content: Buffer.from('%PDF-a'), byteSize: 6, sha256: 'b'.repeat(64) }
  ];
  const created = await repository.createDocumentVersionOne({
    opportunityId: 20,
    documentType: 'datasheet',
    primaryEquipmentItemId: 12,
    documentCode: 'OPP-20-02-DATASHEET',
    title: 'Reactor Agitator Datasheet',
    actorUserId: 3,
    changeSummary: 'Initial generated version',
    sourceSnapshot: { opportunityId: 20 },
    versionItems: [{ equipmentItemId: 12 }],
    files
  });
  assert.equal(created.versionLabel, 'OPP-20-02-DATASHEET-V1');
  assert.match(calls[0].sql, /opportunity_technical_document_version_items/);
  assert.match(calls[0].sql, /SELECT \$1, \$2, \$3, \$4, \$5, 1, \$6, \$6/);
  assert.doesNotMatch(calls[0].sql, /SET current_version_no = 1/);
  assert.match(calls[0].sql, /decode\(file\."contentBase64", 'base64'\)/);
  assert.match(calls[0].sql, /\(SELECT count\(\*\) FROM inserted_files\) = 2/);
  assert.equal(JSON.parse(calls[0].params[9]).length, 2);
});

test('uploaded next version copies immutable item snapshots before advancing current version', async () => {
  const calls = [];
  const repository = createOpportunityTechnicalDocumentRepository({
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [{ document_id: '30', version_id: '41', version_no: '2', document_code: 'OPP-20-TECHNICAL-AGREEMENT' }] };
    }
  });
  const files = [
    { format: 'docx', originalName: 'v2.docx', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', content: Buffer.from('PK-v2'), byteSize: 5, sha256: 'c'.repeat(64) },
    { format: 'pdf', originalName: 'v2.pdf', mimeType: 'application/pdf', content: Buffer.from('%PDF-v2'), byteSize: 7, sha256: 'd'.repeat(64) }
  ];
  const created = await repository.addUploadedVersion({
    opportunityId: 20, documentId: 30, actorUserId: 3, expectedCurrentVersionNo: 1,
    changeSummary: 'Customer comments', files
  });
  assert.equal(created.versionNo, 2);
  assert.match(calls[0].sql, /FOR UPDATE OF document/);
  assert.match(calls[0].sql, /document\.current_version_no = \$6/);
  assert.match(calls[0].sql, /JOIN opportunity_technical_document_version_items source_item/);
  assert.match(calls[0].sql, /current_version_no = inserted_version\.version_no/);
});

test('file lookup is scoped through both Opportunity and logical document', async () => {
  const repository = createOpportunityTechnicalDocumentRepository({
    async query(sql, params) {
      assert.match(sql, /document\.opportunity_id = \$1/);
      assert.deepEqual(params, [20, 30, 50]);
      return { rows: [{
        id: '50', version_id: '40', format: 'pdf', original_name: 'v1.pdf',
        mime_type: 'application/pdf', content: Buffer.from('%PDF'), byte_size: '4',
        sha256: 'e'.repeat(64), created_at: '2026-09-15'
      }] };
    }
  });
  const file = await repository.findFile(20, 30, 50);
  assert.equal(file.byteSize, 4);
  assert.equal(file.content.toString(), '%PDF');
});
