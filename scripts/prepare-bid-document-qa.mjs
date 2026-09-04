import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBidDocumentRenderer } from '../src/services/bidDocumentRenderer.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outputDir = path.join(root, 'output', 'bid-center-step7', 'artifacts');
const logoPath = path.join(root, 'src', 'public', 'assets', 'sunkaier-logo-login.png');
const diagramPath = path.join(root, 'src', 'public', 'assets', 'sunkaier-logo-login.png');
const diagram = await readFile(diagramPath);

const longEn = 'This controlled project section describes the design basis, operating envelope, interfaces, exclusions, inspection points, and acceptance evidence. The final engineering values remain subject to the approved project data sheet and signed commercial scope. ';
const longZh = '本受控项目章节说明设计依据、操作范围、接口条件、责任边界、检验点和验收证据；最终工程参数以经批准的项目数据表及签署的商务范围为准。';

function packageDraft(kind, version) {
  const prefix = kind === 'technical' ? 'TS' : 'CP';
  const sectionName = kind === 'technical' ? ['Process Design Basis', 'Equipment and Quality Plan'] : ['Price and Delivery', 'Commercial Terms and Exceptions'];
  const sectionNameZh = kind === 'technical' ? ['工艺设计依据', '设备与质量计划'] : ['价格与交付', '商务条款与例外'];
  return {
    id: kind === 'technical' ? 41 : 42,
    status: 'approved', formalVersionNo: version, formalVersionLabel: `${prefix}-V${version}`,
    language: 'bilingual', templateCodeSnapshot: `${prefix}-ANON`, templateNameSnapshot: `Anonymous ${kind} package`,
    templateRevisionNoSnapshot: 3,
    submittedBy: 9, submitterDisplayName: 'Project Lead QE', submittedAt: '2026-08-30T08:00:00.000Z',
    reviewedBy: kind === 'technical' ? 10 : 12,
    reviewerDisplayName: kind === 'technical' ? 'Technical Manager' : 'Commercial Manager',
    reviewedAt: kind === 'technical' ? '2026-08-31T08:00:00.000Z' : '2026-09-01T08:00:00.000Z',
    reviewComment: 'Approved for controlled bid issue.',
    renderedContent: {
      variables: [
        { variableKey: 'capacity', labelEn: 'Design capacity', labelZh: '设计产能', value: '2,000 kg/h' },
        { variableKey: 'material', labelEn: 'Product', labelZh: '物料', value: 'Anonymous specialty material' },
        { variableKey: 'standard', labelEn: 'Design standard', labelZh: '设计标准', value: 'Project specification / 项目规范' },
        { variableKey: 'destination', labelEn: 'Destination', labelZh: '目的地', value: 'Southeast Asia' }
      ],
      sections: sectionName.map((labelEn, index) => ({
        key: `${kind}-${index + 1}`, labelEn, labelZh: sectionNameZh[index], included: true,
        bodyEn: `${longEn.repeat(index + 4)}\n${longEn.repeat(3)}`,
        bodyZh: `${longZh.repeat(index + 6)}\n${longZh.repeat(4)}`,
        tableRows: index === 0
          ? [['No.', 'Requirement', 'Proposed value', 'Unit', 'Compliance'], ['1', 'Capacity', '2,000', 'kg/h', 'Comply'], ['2', 'Installation', 'Indoor', '-', 'Comply'], ['3', 'Utilities', 'By purchaser', '-', 'Clarified']]
          : [['Milestone', 'Responsibility', 'Evidence'], ['Design review', 'Supplier / Buyer', 'Approved drawing'], ['Factory acceptance', 'Supplier', 'Signed FAT record'], ['Shipment release', 'Buyer', 'Release note']],
        clauses: [{ revisionLabel: 'CLAUSE-R2', title: 'Controlled general requirement / 受控通用要求', content: `${longEn.repeat(2)} ${longZh.repeat(2)}` }]
      }))
    },
    sourceMetadata: {}
  };
}

const technicalDraft = packageDraft('technical', 2);
const commercialDraft = packageDraft('commercial', 3);
const packageVersion = {
  id: 60, status: 'approved', versionNo: 4,
  commercialLineItems: [
    { itemName: 'Process mixer package', specification: '2,000 L', quantity: 1, unit: 'set', unitPrice: 125000, subtotal: 125000 },
    { itemName: 'Commissioning service', specification: 'Five working days', quantity: 1, unit: 'lot', unitPrice: 8000, subtotal: 8000 }
  ],
  currency: 'USD', totalPrice: 133000,
  deliveryPeriod: '16 weeks after drawing approval', paymentTerms: '30% / 60% / 10%', validUntil: '2026-12-31',
  submittedBy: 9, submitterDisplayName: 'Project Lead QE', submittedAt: '2026-09-01T07:00:00.000Z',
  reviewedBy: 8, reviewerDisplayName: 'Sales Manager', reviewedAt: '2026-09-01T08:00:00.000Z',
  reviewComment: 'Approved for customer issue.'
};
const opportunity = {
  id: 20, opportunityNo: '812345', title: 'Anonymous Process Mixing System Upgrade',
  customerName: 'Example Industrial Co., Ltd.', primaryContactName: 'Project Contact'
};
const attachment = {
  id: 1, sectionKey: 'technical-1', sourceLabel: 'Technical package / 技术包',
  archiveName: 'Technical/1-process-flow.png', originalName: 'process-flow.png',
  mimeType: 'image/png', content: diagram, byteSize: diagram.length,
  sha256: 'visual-qa-only', inlineImage: true, caption: 'Illustrative process image / 工艺示意图'
};
const renderer = createBidDocumentRenderer({
  logoPath,
  fontPath: process.env.TECHNICAL_DOCUMENT_FONT_PATH || 'C:\\Windows\\Fonts\\simhei.ttf'
});

await mkdir(outputDir, { recursive: true });
const summary = [];
for (const packageType of ['technical', 'commercial', 'complete']) {
  const versionLabel = packageType === 'technical' ? 'TS-V2' : packageType === 'commercial' ? 'CP-V3' : 'QP-V4';
  const documents = await renderer.generatePackage({
    packageType, language: 'bilingual', opportunity, workspace: { language: 'bilingual' },
    technicalDraft, commercialDraft, packageVersion, versionLabel,
    approvedAt: '2026-09-01T08:00:00.000Z', generatedBy: { id: 9, displayName: 'Project Lead QE' },
    outputProfile: { id: 5, revisionNo: 2, layoutSettings: { englishFont: 'Arial', cjkFont: 'Microsoft YaHei' } },
    attachments: packageType === 'commercial' ? [] : [attachment]
  });
  for (const document of documents) {
    const filePath = path.join(outputDir, document.originalName);
    await writeFile(filePath, document.content);
    summary.push({ packageType, format: document.format, filePath, byteSize: document.byteSize, sha256: document.sha256 });
  }
}
await writeFile(path.join(outputDir, 'qa-summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
process.stdout.write(`${JSON.stringify({ outputDir, files: summary }, null, 2)}\n`);
