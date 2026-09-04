import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { buildBidDocumentSpec, createBidDocumentRenderer } from '../../src/services/bidDocumentRenderer.mjs';

const logoPath = fileURLToPath(new URL('../../src/public/assets/sunkaier-logo.png', import.meta.url));
const fontPath = 'C:\\Windows\\Fonts\\simhei.ttf';

function draft(kind, version) {
  return {
    id: kind === 'technical' ? 41 : 42,
    status: 'approved',
    formalVersionNo: version,
    formalVersionLabel: `${kind === 'technical' ? 'TS' : 'CP'}-V${version}`,
    language: 'bilingual',
    submittedBy: 7,
    submitterDisplayName: 'QE One',
    submittedAt: '2026-08-30T08:00:00.000Z',
    reviewedBy: 9,
    reviewerDisplayName: 'Manager One',
    reviewedAt: '2026-09-01T08:00:00.000Z',
    reviewComment: 'Approved for controlled issue',
    renderedContent: {
      variables: [{ variableKey: 'capacity', labelEn: 'Capacity', labelZh: '产能', value: '2,000 kg/h' }],
      sections: [
        {
          key: `${kind}-scope`, labelEn: `${kind} scope`, labelZh: `${kind === 'technical' ? '技术' : '商务'}范围`,
          included: true,
          bodyEn: 'Frozen approved content. '.repeat(35),
          bodyZh: '这是经过审批并冻结的项目内容。'.repeat(35),
          tableRows: [['Item', 'Value'], ['A', 'B']]
        },
        {
          key: `${kind}-terms`, labelEn: `${kind} terms`, labelZh: `${kind === 'technical' ? '技术' : '商务'}条款`,
          included: true, bodyEn: 'Second controlled section.', bodyZh: '第二个受控章节。'
        }
      ]
    },
    sourceMetadata: {}
  };
}

function input(packageType) {
  const technicalDraft = draft('technical', 2);
  const commercialDraft = draft('commercial', 3);
  return {
    packageType,
    language: 'bilingual',
    opportunity: {
      opportunityNo: '812345', title: 'Anonymous Mixing System Upgrade',
      customerName: 'Example Industrial Co., Ltd.', primaryContactName: 'Project Contact'
    },
    workspace: { language: 'bilingual' },
    technicalDraft,
    commercialDraft,
    packageVersion: {
      status: 'approved', versionNo: 4, reviewedAt: '2026-09-01T08:00:00.000Z',
      commercialLineItems: [{ itemName: 'Mixer', specification: '2,000 L', quantity: 1, unit: 'set', unitPrice: 100000, subtotal: 100000 }],
      currency: 'USD', totalPrice: 100000,
      submittedBy: 7, submitterDisplayName: 'QE One', submittedAt: '2026-08-31T08:00:00.000Z',
      reviewedBy: 8, reviewerDisplayName: 'Sales Manager', reviewComment: 'Approved'
    },
    versionLabel: packageType === 'technical' ? 'TS-V2' : packageType === 'commercial' ? 'CP-V3' : 'QP-V4',
    approvedAt: '2026-09-01T08:00:00.000Z',
    outputProfile: { revisionNo: 1, layoutSettings: { englishFont: 'Arial', cjkFont: 'Microsoft YaHei' } },
    generatedBy: { id: 7, displayName: 'QE One' },
    attachments: []
  };
}

test('bid renderer creates deterministic A4 DOCX and PDF for all three package types', async () => {
  const renderer = createBidDocumentRenderer({ logoPath, fontPath });
  for (const packageType of ['technical', 'commercial', 'complete']) {
    const first = await renderer.generatePackage(input(packageType));
    const second = await renderer.generatePackage(input(packageType));
    assert.equal(first.length, 2);
    assert.deepEqual(first.map((item) => item.sha256), second.map((item) => item.sha256));
    assert.match(first[0].originalName, /_Bilingual_(?:TS|CP|QP)-V\d_20260901\.docx$/);
    assert.match(first[1].originalName, /_Bilingual_(?:TS|CP|QP)-V\d_20260901\.pdf$/);
    assert.equal(first[0].content.subarray(0, 2).toString(), 'PK');
    assert.equal(first[1].content.subarray(0, 5).toString(), '%PDF-');
    const zip = await JSZip.loadAsync(first[0].content);
    const documentXml = await zip.file('word/document.xml').async('string');
    const settingsXml = await zip.file('word/settings.xml').async('string');
    const packageEntries = Object.keys(zip.files);
    assert.match(documentXml, /w:pgSz w:w="11906" w:h="16838"/);
    assert.match(documentXml, /w:pgMar w:top="1020" w:right="1020" w:bottom="1020" w:left="1134"/);
    assert.match(documentXml, /TOC/);
    assert.match(documentXml, /w:pgNumType w:start="1"/);
    assert.match(documentXml, /Prepared by/);
    assert.match(documentXml, /Reviewed by/);
    assert.match(documentXml, /Approval/);
    assert.doesNotMatch(documentXml, /\{\{[^}]+\}\}/);
    assert.match(settingsXml, /w:updateFields/);
    assert.equal(packageEntries.some((name) => /^word\/header\d+\.xml$/.test(name)), true);
    assert.equal(packageEntries.some((name) => /^word\/footer\d+\.xml$/.test(name)), true);
    assert.equal(packageEntries.some((name) => /^word\/media\//.test(name)), true);
  }
});

test('document spec omits absent sections and keeps a generated attachment index', () => {
  const fixture = input('technical');
  fixture.technicalDraft.renderedContent.sections[1].included = false;
  fixture.attachments = [{
    archiveName: 'Technical/1-drawing.png', originalName: 'drawing.png', sourceLabel: 'Technical',
    byteSize: 12, sha256: 'a'.repeat(64), inlineImage: false
  }];
  const spec = buildBidDocumentSpec(fixture);
  assert.equal(spec.sections.some((section) => section.title.includes('terms')), false);
  assert.equal(spec.sections.some((section) => section.title.includes('附件索引')), true);
  assert.match(spec.fileBase, /^812345_Technical-Package_Bilingual_TS-V2_20260901$/);
  assert.match(spec.responsibility.prepared, /QE One/);
  assert.match(spec.responsibility.reviewed, /Manager One/);
  assert.match(spec.responsibility.approved, /APPROVED/);
});
