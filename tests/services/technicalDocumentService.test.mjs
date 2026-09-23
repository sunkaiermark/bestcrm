import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { createTechnicalDocumentService } from '../../src/services/technicalDocumentService.mjs';

function approvedDraft(overrides = {}) {
  return {
    id: 41,
    status: 'approved',
    formalVersionNo: 1,
    language: 'en',
    templateCodeSnapshot: 'MX-100',
    templateNameSnapshot: 'Mixer Technical Agreement',
    templateRevisionNoSnapshot: 2,
    submittedBy: 3,
    submitterDisplayName: 'Project Lead',
    submittedAt: '2026-09-03T01:00:00.000Z',
    reviewedBy: 6,
    reviewerDisplayName: 'Technical Manager',
    reviewedAt: '2026-09-03T02:00:00.000Z',
    reviewComment: 'Approved for quotation',
    renderedContent: {
      variables: [
        { variableKey: 'customer_name', labelEn: 'Customer', labelZh: '客户', value: 'Acme Process' },
        { variableKey: 'capacity', labelEn: 'Capacity', labelZh: '处理能力', value: '20 t/h' }
      ],
      sections: [{
        key: 'design_parameters',
        labelEn: 'Design Parameters',
        labelZh: '设计参数',
        included: true,
        bodyEn: 'Design capacity is 20 t/h.',
        bodyZh: '设计处理能力为 20 吨/小时。',
        tableRowsEn: [['Parameter', 'Value', 'Unit'], ['Capacity', '20', 't/h']],
        tableRowsZh: [['参数', '数值', '单位'], ['处理能力', '20', 't/h']],
        clauses: [
          { revisionLabel: 'FAT-EN-R1', title: 'Factory Acceptance Test', content: 'FAT before shipment.', language: 'en' },
          { revisionLabel: 'FAT-ZH-R1', title: '工厂验收', content: '发货前完成 FAT。', language: 'zh' }
        ]
      }]
    },
    ...overrides
  };
}

test('approved technical solution generates DOCX and PDF with stable names and SHA-256', async () => {
  const service = createTechnicalDocumentService({ fontPath: 'C:\\Windows\\Fonts\\simhei.ttf' });
  const documents = await service.generateApprovedDocuments({
    draft: approvedDraft(),
    opportunity: { opportunityNo: 'OPP-800020', title: 'Mixer Project' },
    reviewer: { id: 6, displayName: 'Technical Manager' }
  });

  assert.deepEqual(documents.map((item) => item.format), ['docx', 'pdf']);
  assert.equal(documents[0].documentNo, 'TS-V1');
  assert.equal(documents[0].originalName, 'OPP-800020_TS-V1.docx');
  assert.equal(documents[1].originalName, 'OPP-800020_TS-V1.pdf');
  assert.equal(documents[0].content.subarray(0, 2).toString(), 'PK');
  assert.equal(documents[1].content.subarray(0, 4).toString(), '%PDF');
  const documentXml = await (await JSZip.loadAsync(documents[0].content)).file('word/document.xml').async('string');
  assert.match(documentXml, /Technical Solution|Design Parameters|Design capacity is 20 t\/h\.|FAT before shipment\./);
  assert.doesNotMatch(documentXml, /技术方案|设计参数|设计处理能力为|发货前完成/);
  for (const document of documents) {
    assert.ok(document.byteSize > 1000);
    assert.equal(document.byteSize, document.content.length);
    assert.equal(document.sha256, createHash('sha256').update(document.content).digest('hex'));
  }
});

test('approved uploaded technical file is the exact official TS-V content', async () => {
  const uploadDir = await mkdtemp(path.join(tmpdir(), 'bestcrm-technical-version-'));
  try {
    const content = Buffer.from('%PDF-1.4\nApproved datasheet');
    const storedPath = 'datasheet.pdf';
    await writeFile(path.join(uploadDir, storedPath), content);
    const sha256 = createHash('sha256').update(content).digest('hex');
    const sourceAttachment = {
      storedPath, originalName: 'Customer Datasheet.pdf', mimeType: 'application/pdf',
      fileSize: content.length, sha256
    };
    const service = createTechnicalDocumentService({ uploadDir });
    const draft = approvedDraft({ sourceKind: 'uploaded_file', formalVersionNo: 2 });
    const documents = await service.generateApprovedDocuments({ draft, sourceAttachment });
    assert.equal(documents.length, 1);
    assert.equal(documents[0].format, 'uploaded');
    assert.equal(documents[0].documentNo, 'TS-V2');
    assert.equal(documents[0].originalName, 'Customer Datasheet.pdf');
    assert.equal(documents[0].sha256, sha256);
    assert.deepEqual(documents[0].content, content);
    await assert.rejects(
      service.generateApprovedDocuments({ draft, sourceAttachment: { ...sourceAttachment, sha256: '0'.repeat(64) } }),
      /integrity verification/
    );
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
});

test('approved uploaded technical file batch keeps every file in one TS-V', async () => {
  const uploadDir = await mkdtemp(path.join(tmpdir(), 'bestcrm-technical-version-batch-'));
  try {
    const sources = [];
    for (const [storedPath, originalName, contentText] of [
      ['agreement.pdf', 'Agreement.pdf', '%PDF-1.4\nAgreement'],
      ['datasheet.xlsx', 'Datasheet.xlsx', 'PK\u0003\u0004Datasheet']
    ]) {
      const content = Buffer.from(contentText);
      await writeFile(path.join(uploadDir, storedPath), content);
      sources.push({
        storedPath,
        originalName,
        mimeType: 'application/octet-stream',
        fileSize: content.length,
        sha256: createHash('sha256').update(content).digest('hex')
      });
    }
    const service = createTechnicalDocumentService({ uploadDir });
    const draft = approvedDraft({ sourceKind: 'uploaded_file', formalVersionNo: 3 });
    const documents = await service.generateApprovedDocuments({ draft, sourceAttachments: sources });
    assert.equal(documents.length, 2);
    assert.deepEqual(documents.map((document) => document.documentNo), ['TS-V3', 'TS-V3']);
    assert.deepEqual(documents.map((document) => document.originalName), ['Agreement.pdf', 'Datasheet.xlsx']);
    assert.ok(documents.every((document) => document.format === 'uploaded'));
  } finally {
    await rm(uploadDir, { recursive: true, force: true });
  }
});

test('approved technical solution preserves controlled template layout', async () => {
  const draft = approvedDraft();
  draft.renderedContent.sections[0].layout = {
    pageBreakBefore: true,
    table: {
      headerRow: true,
      columnWidths: [30, 45, 25],
      columnAlignments: ['left', 'center', 'right'],
      merges: [{ row: 1, column: 1, span: 3 }]
    },
    image: {
      mimeType: 'image/png',
      originalName: 'arrangement.png',
      data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
      widthPercent: 45,
      alignment: 'right',
      captionEn: 'Arrangement diagram',
      captionZh: '布置示意图'
    }
  };
  const service = createTechnicalDocumentService({ fontPath: 'C:\\Windows\\Fonts\\Deng.ttf' });
  const documents = await service.generateApprovedDocuments({
    draft,
    opportunity: { opportunityNo: 'OPP-800020', title: 'Mixer Project' },
    reviewer: { id: 6, displayName: 'Technical Manager' }
  });
  const zip = await JSZip.loadAsync(documents[0].content);
  const documentXml = await zip.file('word/document.xml').async('string');
  assert.match(documentXml, /w:gridSpan/);
  assert.match(documentXml, /w:pageBreakBefore/);
  assert.match(documentXml, /Arrangement diagram/);
  assert.ok(zip.file(/^word\/media\//).length >= 1);
  assert.equal(documents[1].content.subarray(0, 4).toString(), '%PDF');
});

test('document generation rejects mutable or unnumbered drafts', async () => {
  const service = createTechnicalDocumentService({ fontPath: 'C:\\Windows\\Fonts\\simhei.ttf' });
  await assert.rejects(
    service.generateApprovedDocuments({
      draft: approvedDraft({ status: 'pending', formalVersionNo: null }),
      opportunity: { opportunityNo: 'OPP-20', title: 'Mixer' },
      reviewer: {}
    }),
    (error) => error.statusCode === 409
  );
});
