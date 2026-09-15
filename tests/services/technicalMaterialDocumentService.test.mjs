import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createTechnicalMaterialDocumentService } from '../../src/services/technicalMaterialDocumentService.mjs';

test('technical material renderer returns editable DOCX and matching PDF identities with hashes', async () => {
  const docx = Buffer.from('PK generated docx');
  const pdf = Buffer.from('%PDF- generated pdf');
  const service = createTechnicalMaterialDocumentService({
    async createDocx(input) {
      assert.equal(input.items[0].equipmentName, 'Main Mixer');
      return docx;
    },
    async createPdf(input) {
      assert.equal(input.document.documentType, 'datasheet');
      return pdf;
    }
  });
  const files = await service.generateVersionOne({
    opportunity: { opportunityNo: 'OPP-20', title: 'Mixer', customerName: 'Acme' },
    document: { documentType: 'datasheet', documentCode: 'OPP-20-01-DATASHEET', title: 'Main Mixer - Datasheet' },
    versionNo: 1,
    items: [{ equipmentName: 'Main Mixer' }]
  });
  assert.deepEqual(files.map((file) => file.format), ['docx', 'pdf']);
  assert.equal(files[0].originalName, 'OPP-20-01-DATASHEET-V1.docx');
  assert.equal(files[1].originalName, 'OPP-20-01-DATASHEET-V1.pdf');
  assert.equal(files[0].sha256, createHash('sha256').update(docx).digest('hex'));
  assert.equal(files[1].byteSize, pdf.length);
});

test('technical material renderer rejects a missing controlled identity or empty equipment set', async () => {
  const service = createTechnicalMaterialDocumentService({
    async createDocx() { return Buffer.from('docx'); },
    async createPdf() { return Buffer.from('pdf'); }
  });
  await assert.rejects(
    service.generateVersionOne({ document: { documentType: 'unknown', documentCode: 'X' }, versionNo: 1, items: [{}] }),
    (error) => error.statusCode === 400
  );
  await assert.rejects(
    service.generateVersionOne({ document: { documentType: 'datasheet', documentCode: 'X' }, versionNo: 1, items: [] }),
    (error) => error.statusCode === 400
  );
});

test('real bilingual renderer produces valid DOCX and PDF byte streams', async () => {
  const service = createTechnicalMaterialDocumentService({ fontPath: 'C:\\Windows\\Fonts\\simhei.ttf' });
  const files = await service.generateVersionOne({
    opportunity: { opportunityNo: 'OPP-800001', title: '多设备项目', customerName: '示例客户' },
    document: {
      documentType: 'technical_agreement',
      documentCode: 'OPP-800001-TECHNICAL-AGREEMENT',
      title: '多设备项目 - Technical Agreement'
    },
    versionNo: 1,
    items: [{
      itemNo: 1,
      productCategoryName: '搅拌机',
      equipmentName: '主搅拌机',
      model: 'MX-10',
      quantity: 2,
      templateCode: 'MIX-TA',
      templateRevisionNo: 1,
      technicalParameters: [{ key: 'capacity', label: '处理能力', value: '10 t/h' }],
      renderedContent: {
        variables: [{ variableKey: 'capacity', labelEn: 'Capacity', labelZh: '处理能力', value: '10 t/h' }],
        sections: [{
          key: 'project_basis', labelEn: 'Project Basis', labelZh: '项目依据', included: true,
          bodyEn: 'Customer requirement.', bodyZh: '客户需求。', tableRows: [], clauses: []
        }]
      }
    }]
  });
  assert.equal(files[0].content.subarray(0, 2).toString(), 'PK');
  assert.equal(files[1].content.subarray(0, 4).toString(), '%PDF');
  assert.ok(files.every((file) => file.byteSize > 1000));
});
