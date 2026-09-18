import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import { createTechnicalMaterialDocumentService } from '../../src/services/technicalMaterialDocumentService.mjs';

function countPdfPages(content) {
  return (content.toString('latin1').match(/\/Type\s*\/Page\b/g) || []).length;
}

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
    language: 'en',
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

test('real Chinese-only renderer produces valid DOCX and PDF byte streams', async () => {
  const service = createTechnicalMaterialDocumentService({ fontPath: 'C:\\Windows\\Fonts\\simhei.ttf' });
  const files = await service.generateVersionOne({
    opportunity: { opportunityNo: 'OPP-800001', title: '多设备项目', customerName: '示例客户' },
    document: {
      documentType: 'technical_agreement',
      documentCode: 'OPP-800001-TECHNICAL-AGREEMENT',
      title: '多设备项目 - 技术协议'
    },
    versionNo: 1,
    language: 'zh',
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
          bodyEn: 'Customer requirement.', bodyZh: '客户需求。',
          tableRowsEn: [['Item', 'Value']], tableRowsZh: [['项目', '数值']], clauses: []
        }]
      }
    }]
  });
  assert.equal(files[0].content.subarray(0, 2).toString(), 'PK');
  assert.equal(files[1].content.subarray(0, 4).toString(), '%PDF');
  assert.ok(files.every((file) => file.byteSize > 1000));
  assert.equal(countPdfPages(files[1].content), 2, 'formal document uses one cover page and one content page without phantom footer pages');
});

test('controlled section layout reaches DOCX and PDF output', async () => {
  const input = localizedDocumentInput('zh');
  input.items[0].renderedContent.sections[0].layout = {
    pageBreakBefore: true,
    table: {
      headerRow: true,
      columnWidths: [35, 65],
      columnAlignments: ['left', 'center'],
      merges: [{ row: 1, column: 1, span: 2 }]
    },
    image: {
      mimeType: 'image/png',
      originalName: 'process.png',
      data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      widthPercent: 50,
      alignment: 'center',
      captionEn: 'Process arrangement',
      captionZh: '工艺布置示意图'
    }
  };
  const service = createTechnicalMaterialDocumentService({ fontPath: 'C:\\Windows\\Fonts\\Deng.ttf' });
  const files = await service.generateVersionOne(input);
  const zip = await JSZip.loadAsync(files[0].content);
  const documentXml = await zip.file('word/document.xml').async('string');
  assert.match(documentXml, /w:gridSpan/);
  assert.match(documentXml, /w:pageBreakBefore/);
  assert.match(documentXml, /工艺布置示意图/);
  assert.ok(zip.file(/^word\/media\//).length >= 1);
  assert.equal(files[1].content.subarray(0, 4).toString(), '%PDF');
  assert.ok(countPdfPages(files[1].content) >= 3);
});

function localizedDocumentInput(language) {
  const chinese = language === 'zh';
  return {
    opportunity: {
      opportunityNo: 'OPP-800002',
      title: chinese ? '聚合项目' : 'Polymer Project',
      customerName: chinese ? '示例客户' : 'Example Customer'
    },
    document: {
      documentType: 'technical_agreement',
      documentCode: 'OPP-800002-TECHNICAL-AGREEMENT',
      title: chinese ? '聚合项目 - 技术协议' : 'Polymer Project - Technical Agreement'
    },
    versionNo: 1,
    language,
    items: [{
      itemNo: 1,
      productCategoryName: chinese ? '搅拌机' : 'Mixer',
      equipmentName: chinese ? '主搅拌机' : 'Main Mixer',
      model: 'MX-10',
      quantity: 1,
      templateCode: 'MIX-TA',
      templateRevisionNo: 1,
      technicalParameters: [],
      renderedContent: {
        variables: [{ variableKey: 'capacity', labelEn: 'Capacity', labelZh: '处理能力', value: '10 t/h' }],
        sections: [{
          key: 'project_basis', labelEn: 'Project Basis', labelZh: '项目依据', included: true,
          bodyEn: 'English section body only.', bodyZh: '仅中文章节内容。',
          tableRowsEn: [['English item', 'English value']],
          tableRowsZh: [['中文项目', '中文数值']],
          clauses: [
            { revisionLabel: 'EN-R1', title: 'English clause', content: 'English clause body.', language: 'en' },
            { revisionLabel: 'ZH-R1', title: '中文条款', content: '中文条款内容。', language: 'zh' }
          ]
        }]
      }
    }]
  };
}

test('DOCX rendering selects exactly one frozen language', async () => {
  const service = createTechnicalMaterialDocumentService({
    async createPdf() { return Buffer.from('%PDF-language-test'); }
  });

  const englishFiles = await service.generateVersionOne(localizedDocumentInput('en'));
  const englishXml = await (await JSZip.loadAsync(englishFiles[0].content)).file('word/document.xml').async('string');
  assert.match(englishXml, /Technical Agreement|Project Basis|English section body only\.|English clause body\./i);
  assert.doesNotMatch(englishXml, /技术协议|项目依据|仅中文章节内容|中文条款内容/);

  const chineseFiles = await service.generateVersionOne(localizedDocumentInput('zh'));
  const chineseXml = await (await JSZip.loadAsync(chineseFiles[0].content)).file('word/document.xml').async('string');
  assert.match(chineseXml, /技术协议|项目依据|仅中文章节内容|中文条款内容/);
  assert.doesNotMatch(chineseXml, /Technical Agreement|Project Basis|English section body only\.|English clause body\./i);
});
