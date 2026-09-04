import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  PageNumber,
  Packer,
  Paragraph,
  SectionType,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableOfContents,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType
} from 'docx';
import JSZip from 'jszip';
import PDFDocument from 'pdfkit';

export const BID_DOCUMENT_GENERATOR_VERSION = 'bestcrm-bid-documents-v1.0.1';

const COLORS = Object.freeze({
  navy: '0B1F3A', blue: '1E5AA8', orange: 'F05A24', text: '1F2933',
  muted: '5E6875', paleBlue: 'EAF2FB', paleGray: 'F5F7F9', border: 'D9D9D9', white: 'FFFFFF'
});
const A4 = Object.freeze({ width: 11906, height: 16838 });
const MARGINS = Object.freeze({ top: 1020, right: 1020, bottom: 1020, left: 1134, header: 500, footer: 500 });
const TABLE_WIDTH = A4.width - MARGINS.left - MARGINS.right;
const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const CANONICAL_ZIP_DATE = new Date('2000-01-01T00:00:00.000Z');
const defaultPdfFontCandidates = [
  'C:\\Windows\\Fonts\\simhei.ttf',
  'C:\\Windows\\Fonts\\msyh.ttc',
  '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
  '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
  '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc'
];

function text(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value).trim();
}

function normalizedDate(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : new Date('2000-01-01T00:00:00.000Z');
}

function dateText(value) {
  return normalizedDate(value).toISOString().slice(0, 10);
}

function compactDate(value) {
  return dateText(value).replaceAll('-', '');
}

function checksum(content) {
  return createHash('sha256').update(content).digest('hex');
}

function safeFilePart(value, fallback = 'document') {
  return text(value).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || fallback;
}

function languageName(language) {
  if (language === 'zh') return 'Chinese';
  if (language === 'en') return 'English';
  return 'Bilingual';
}

function localized(language, valueEn, valueZh, separator = ' / ') {
  if (language === 'en') return text(valueEn || valueZh);
  if (language === 'zh') return text(valueZh || valueEn);
  return [text(valueZh), text(valueEn)].filter(Boolean).join(separator);
}

function packageIdentity(packageType, language) {
  const labels = {
    technical: ['Technical Package', '技术包', 'Technical-Package'],
    commercial: ['Commercial Package', '商务包', 'Commercial-Package'],
    complete: ['Complete Bid', '完整标书', 'Complete-Bid']
  };
  const [en, zh, filePart] = labels[packageType] || labels.complete;
  return { title: localized(language, en, zh), en, zh, filePart };
}

function displayValue(value) {
  if (value === true) return 'Yes / 是';
  if (value === false) return 'No / 否';
  return text(value) || '-';
}

function normalizeRows(rows) {
  const normalized = (Array.isArray(rows) ? rows : []).map((row) => (
    Array.isArray(row) ? row.map(displayValue) : Object.values(row || {}).map(displayValue)
  )).filter((row) => row.length);
  if (!normalized.length) return [];
  const columnCount = Math.max(...normalized.map((row) => row.length));
  const rectangular = normalized.map((row) => Array.from(
    { length: columnCount }, (_, index) => displayValue(row[index])
  ));
  if (columnCount <= 6) return rectangular;
  const headers = rectangular[0];
  return [
    ['Field / 字段', 'Value / 内容'],
    ...rectangular.slice(1).flatMap((row, rowIndex) => headers.map((header, index) => [
      `${rowIndex + 1}.${index + 1} ${header || `Column ${index + 1}`}`,
      row[index]
    ]))
  ];
}

function variableRows(draft, language) {
  const variables = draft?.renderedContent?.variables || (draft?.variableSchemaSnapshot || []).map((item) => ({
    ...item, value: draft?.variableValues?.[item.variableKey]
  }));
  return [
    ['Parameter / 参数', 'Value / 数值'],
    ...variables.map((variable) => [
      localized(language, variable.labelEn || variable.variableKey, variable.labelZh || variable.variableKey),
      displayValue(variable.value)
    ])
  ];
}

function opportunityRows(context) {
  const { opportunity = {} } = context;
  return [
    ['Customer / 客户', text(opportunity.customerName) || '-'],
    ['Project / 项目', text(opportunity.title) || '-'],
    ['Opportunity / 商机编号', text(opportunity.opportunityNo) || '-'],
    ['Primary contact / 联系人', text(opportunity.primaryContactName) || '-']
  ];
}

function quoteRows(packageVersion) {
  const rows = [['Item / 项目', 'Specification / 规格', 'Qty / 数量', 'Unit / 单位', 'Unit price / 单价', 'Subtotal / 小计']];
  for (const item of packageVersion?.commercialLineItems || []) {
    rows.push([
      item.itemName || item.description || item.code,
      item.specification,
      item.quantity,
      item.unit,
      item.unitPrice,
      item.subtotal
    ].map(displayValue));
  }
  rows.push(['Total / 合计', '', '', '', packageVersion?.currency || '', displayValue(packageVersion?.totalPrice)]);
  return rows;
}

function approvalRows(source, kind) {
  return [
    ['Package / 文件', kind],
    ['Status / 状态', 'APPROVED / 已批准'],
    ['Submitted by / 提交人', text(source?.submitterDisplayName) || String(source?.submittedBy || '-')],
    ['Submitted on / 提交日期', source?.submittedAt ? dateText(source.submittedAt) : '-'],
    ['Approved by / 批准人', text(source?.reviewerDisplayName) || String(source?.reviewedBy || '-')],
    ['Approved on / 批准日期', source?.reviewedAt ? dateText(source.reviewedAt) : '-'],
    ['Review comment / 审批意见', text(source?.reviewComment) || '-']
  ];
}

function contentBlockParagraphs(block, language) {
  const schema = block?.contentSchema || {};
  const result = [];
  const title = localized(language, block?.titleEn || block?.nameEn, block?.titleZh || block?.nameZh);
  if (title) result.push({ type: 'subheading', text: `${text(block?.revisionLabel)} ${title}`.trim() });
  const bodies = language === 'bilingual'
    ? [['中文', schema.bodyZh], ['EN', schema.bodyEn]]
    : [[language === 'zh' ? '中文' : 'EN', language === 'zh' ? schema.bodyZh || schema.bodyEn : schema.bodyEn || schema.bodyZh]];
  for (const [label, value] of bodies) {
    if (!text(value)) continue;
    if (language === 'bilingual') result.push({ type: 'label', text: label });
    result.push({ type: 'paragraph', text: text(value) });
  }
  const rows = normalizeRows(schema.tableRows || []);
  if (rows.length) result.push({ type: 'table', rows });
  return result;
}

function renderedSectionBlocks(section, language) {
  const blocks = [];
  const bodies = language === 'bilingual'
    ? [['中文', section.bodyZh], ['EN', section.bodyEn]]
    : [[language === 'zh' ? '中文' : 'EN', language === 'zh' ? section.bodyZh || section.bodyEn : section.bodyEn || section.bodyZh]];
  for (const [label, value] of bodies) {
    if (!text(value)) continue;
    if (language === 'bilingual') blocks.push({ type: 'label', text: label });
    for (const paragraph of text(value).split(/\r?\n/).map((item) => item.trim()).filter(Boolean)) {
      blocks.push({ type: 'paragraph', text: paragraph });
    }
  }
  const rows = normalizeRows(section.tableRows || []);
  if (rows.length) blocks.push({ type: 'table', rows });
  for (const clause of section.clauses || []) {
    blocks.push({ type: 'subheading', text: `${text(clause.revisionLabel)} ${text(clause.title)}`.trim() });
    if (text(clause.content)) blocks.push({ type: 'paragraph', text: text(clause.content) });
  }
  for (const block of section.contentBlocks || []) blocks.push(...contentBlockParagraphs(block, language));
  return blocks;
}

function attachmentRows(attachments) {
  return [
    ['No.', 'Source / 来源', 'File / 文件', 'Size / 大小', 'SHA-256'],
    ...attachments.map((attachment, index) => [
      String(index + 1), attachment.sourceLabel, attachment.originalName,
      `${attachment.byteSize} B`, attachment.sha256.slice(0, 16)
    ])
  ];
}

function buildPartSections(draft, language, prefix, headingLevel, images) {
  const sections = [];
  for (const [index, section] of (draft?.renderedContent?.sections || [])
    .filter((item) => item.included !== false)
    .entries()) {
    const number = `${prefix}${index + 1}`;
    const title = localized(language, section.labelEn || section.key, section.labelZh || section.key);
    const blocks = renderedSectionBlocks(section, language);
    for (const image of images.filter((item) => item.sectionKey === section.key)) {
      blocks.push({ type: 'image', image });
    }
    sections.push({ number, title, level: headingLevel, blocks });
  }
  return sections;
}

export function buildBidDocumentSpec(input) {
  const packageType = input.packageType;
  const language = input.language || input.workspace?.language || 'bilingual';
  const identity = packageIdentity(packageType, language);
  const versionLabel = text(input.versionLabel);
  const approvedAt = input.approvedAt || input.packageVersion?.reviewedAt
    || input.technicalDraft?.reviewedAt || input.commercialDraft?.reviewedAt;
  const opportunity = input.opportunity || input.workspace?.opportunity || {};
  const attachments = [...(input.attachments || [])].sort((left, right) => (
    left.archiveName.localeCompare(right.archiveName, 'en')
  ));
  const images = attachments.filter((item) => item.inlineImage === true && Buffer.isBuffer(item.content));
  const approvalSource = packageType === 'technical'
    ? input.technicalDraft
    : packageType === 'commercial' ? input.commercialDraft : input.packageVersion;
  const preparedBy = text(approvalSource?.submitterDisplayName) || String(approvalSource?.submittedBy || '-');
  const reviewedBy = text(approvalSource?.reviewerDisplayName) || String(approvalSource?.reviewedBy || '-');
  const sections = [];
  let top = 1;
  const addTop = (title, blocks) => sections.push({ number: String(top++), title, level: 1, blocks });

  addTop(localized(language, 'Project Information', '项目信息'), [{ type: 'table', rows: opportunityRows({ opportunity }) }]);

  if (packageType === 'technical') {
    addTop(localized(language, 'Project Parameters', '项目参数'), [{ type: 'table', rows: variableRows(input.technicalDraft, language) }]);
    for (const section of buildPartSections(input.technicalDraft, language, '', 1, images)) {
      sections.push({ ...section, number: String(top++) });
    }
    if (attachments.length) addTop(localized(language, 'Attachment Index', '附件索引'), [{ type: 'table', rows: attachmentRows(attachments) }]);
    addTop(localized(language, 'Approval Record', '审批记录'), [{ type: 'table', rows: approvalRows(input.technicalDraft, versionLabel) }]);
  } else if (packageType === 'commercial') {
    addTop(localized(language, 'Commercial Variables', '商务参数'), [{ type: 'table', rows: variableRows(input.commercialDraft, language) }]);
    addTop(localized(language, 'Quotation Summary', '报价汇总'), [{ type: 'table', rows: quoteRows(input.packageVersion) }]);
    for (const section of buildPartSections(input.commercialDraft, language, '', 1, images)) {
      sections.push({ ...section, number: String(top++) });
    }
    if (attachments.length) addTop(localized(language, 'Attachment Index', '附件索引'), [{ type: 'table', rows: attachmentRows(attachments) }]);
    addTop(localized(language, 'Approval Record', '审批记录'), [{ type: 'table', rows: approvalRows(input.commercialDraft, versionLabel) }]);
  } else {
    const technicalTop = String(top++);
    sections.push({
      number: technicalTop,
      title: localized(language, 'Technical Package', '技术包'),
      level: 1,
      blocks: [{ type: 'table', rows: variableRows(input.technicalDraft, language) }]
    });
    sections.push(...buildPartSections(input.technicalDraft, language, `${technicalTop}.`, 2, images));
    const commercialTop = String(top++);
    sections.push({
      number: commercialTop,
      title: localized(language, 'Commercial Package', '商务包'),
      level: 1,
      blocks: [
        { type: 'table', rows: variableRows(input.commercialDraft, language) },
        { type: 'subheading', text: localized(language, 'Quotation Summary', '报价汇总') },
        { type: 'table', rows: quoteRows(input.packageVersion) }
      ]
    });
    sections.push(...buildPartSections(input.commercialDraft, language, `${commercialTop}.`, 2, images));
    if (attachments.length) addTop(localized(language, 'Attachment Index', '附件索引'), [{ type: 'table', rows: attachmentRows(attachments) }]);
    addTop(localized(language, 'Approval Record', '审批记录'), [
      { type: 'subheading', text: 'TS' },
      { type: 'table', rows: approvalRows(input.technicalDraft, input.technicalDraft?.formalVersionLabel) },
      { type: 'subheading', text: 'CP' },
      { type: 'table', rows: approvalRows(input.commercialDraft, input.commercialDraft?.formalVersionLabel) },
      { type: 'subheading', text: 'QP' },
      { type: 'table', rows: approvalRows(input.packageVersion, versionLabel) }
    ]);
  }

  return {
    packageType,
    language,
    identity,
    versionLabel,
    approvedAt: normalizedDate(approvedAt),
    opportunity,
    outputProfile: input.outputProfile || {},
    generatedBy: input.generatedBy || {},
    responsibility: {
      prepared: `${preparedBy} · ${approvalSource?.submittedAt ? dateText(approvalSource.submittedAt) : '-'}`,
      reviewed: `${reviewedBy} · ${approvalSource?.reviewedAt ? dateText(approvalSource.reviewedAt) : dateText(approvedAt)}`,
      approved: `APPROVED / 已批准 · ${dateText(approvalSource?.reviewedAt || approvedAt)}`
    },
    attachments,
    sections,
    fileBase: `${safeFilePart(opportunity.opportunityNo, 'OPP')}_${identity.filePart}_${languageName(language)}_${safeFilePart(versionLabel, 'V1')}_${compactDate(approvedAt)}`,
    confidentiality: localized(language, 'Confidential', '保密')
  };
}

function docxRun(value, options = {}) {
  return new TextRun({
    text: text(value),
    font: { name: options.font || 'Arial', eastAsia: options.cjkFont || 'Microsoft YaHei' },
    size: options.size || 21,
    bold: options.bold,
    color: options.color || COLORS.text
  });
}

function docxParagraph(value, options = {}) {
  return new Paragraph({
    children: Array.isArray(value) ? value : [docxRun(value, options)],
    alignment: options.alignment || AlignmentType.LEFT,
    spacing: { before: options.before ?? 0, after: options.after ?? 120, line: options.line ?? 284 },
    keepNext: options.keepNext
  });
}

const tableBorders = Object.freeze({
  top: { style: BorderStyle.SINGLE, size: 4, color: COLORS.border },
  bottom: { style: BorderStyle.SINGLE, size: 4, color: COLORS.border },
  left: { style: BorderStyle.SINGLE, size: 4, color: COLORS.border },
  right: { style: BorderStyle.SINGLE, size: 4, color: COLORS.border },
  insideHorizontal: { style: BorderStyle.SINGLE, size: 4, color: COLORS.border },
  insideVertical: { style: BorderStyle.SINGLE, size: 4, color: COLORS.border }
});

function columnWidths(rows) {
  const count = Math.max(...rows.map((row) => row.length), 1);
  if (count === 2) return [Math.round(TABLE_WIDTH * 0.32), Math.round(TABLE_WIDTH * 0.68)];
  if (count === 5) return [650, 1800, 2900, 1400, TABLE_WIDTH - 6750];
  if (count === 6) return [1900, 1800, 850, 850, 2000, TABLE_WIDTH - 7400];
  const base = Math.floor(TABLE_WIDTH / count);
  return Array.from({ length: count }, (_, index) => index === count - 1 ? TABLE_WIDTH - base * (count - 1) : base);
}

function docxTable(inputRows, options = {}) {
  const rows = normalizeRows(inputRows);
  if (!rows.length) return null;
  const widths = columnWidths(rows);
  return new Table({
    width: { size: TABLE_WIDTH, type: WidthType.DXA },
    layout: TableLayoutType.FIXED,
    columnWidths: widths,
    borders: tableBorders,
    rows: rows.map((row, rowIndex) => new TableRow({
      tableHeader: rowIndex === 0,
      cantSplit: rowIndex === 0,
      children: Array.from({ length: widths.length }, (_, columnIndex) => new TableCell({
        width: { size: widths[columnIndex], type: WidthType.DXA },
        verticalAlign: VerticalAlign.CENTER,
        margins: { top: 100, right: 120, bottom: 100, left: 120 },
        borders: tableBorders,
        shading: rowIndex === 0
          ? { type: ShadingType.CLEAR, fill: COLORS.blue, color: 'auto' }
          : rowIndex % 2 === 0 ? { type: ShadingType.CLEAR, fill: COLORS.paleBlue, color: 'auto' } : undefined,
        children: [docxParagraph(row[columnIndex] || '', {
          size: options.compact ? 17 : 18,
          bold: rowIndex === 0,
          color: rowIndex === 0 ? COLORS.white : COLORS.text,
          after: 0,
          line: 230,
          alignment: columnIndex === 0 && widths.length > 2 ? AlignmentType.CENTER : AlignmentType.LEFT
        })]
      }))
    }))
  });
}

function imageDimensions(content) {
  if (!Buffer.isBuffer(content) || content.length < 24) return { width: 800, height: 450, type: 'png' };
  if (content.subarray(1, 4).toString() === 'PNG') {
    return { width: content.readUInt32BE(16), height: content.readUInt32BE(20), type: 'png' };
  }
  if (content[0] === 0xff && content[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < content.length) {
      if (content[offset] !== 0xff) { offset += 1; continue; }
      const marker = content[offset + 1];
      const length = content.readUInt16BE(offset + 2);
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return { width: content.readUInt16BE(offset + 7), height: content.readUInt16BE(offset + 5), type: 'jpg' };
      }
      offset += Math.max(length + 2, 2);
    }
  }
  return { width: 800, height: 450, type: 'png' };
}

function docxImage(image) {
  const dimensions = imageDimensions(image.content);
  const scale = Math.min(520 / dimensions.width, 360 / dimensions.height, 1);
  const width = Math.max(80, Math.round(dimensions.width * scale));
  const height = Math.max(45, Math.round(dimensions.height * scale));
  return [
    new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 120, after: 80 },
      children: [new ImageRun({ data: image.content, type: dimensions.type, transformation: { width, height } })]
    }),
    docxParagraph(image.caption || image.originalName, { size: 18, color: COLORS.muted, alignment: AlignmentType.CENTER })
  ];
}

function documentHeader(spec, fonts) {
  return new Header({ children: [new Table({
    width: { size: TABLE_WIDTH, type: WidthType.DXA },
    layout: TableLayoutType.FIXED,
    columnWidths: [2200, TABLE_WIDTH - 4700, 2500],
    borders: { ...tableBorders, insideHorizontal: { style: BorderStyle.NONE }, insideVertical: { style: BorderStyle.NONE } },
    rows: [new TableRow({ children: [
      new TableCell({ borders: tableBorders, children: [docxParagraph('SUNKAIER', { ...fonts, bold: true, color: COLORS.navy, after: 0, size: 18 })] }),
      new TableCell({ borders: tableBorders, children: [docxParagraph(spec.opportunity.title, { ...fonts, color: COLORS.muted, after: 0, size: 17, alignment: AlignmentType.CENTER })] }),
      new TableCell({ borders: tableBorders, children: [docxParagraph(spec.versionLabel, { ...fonts, bold: true, color: COLORS.navy, after: 0, size: 18, alignment: AlignmentType.RIGHT })] })
    ] })]
  })] });
}

function documentFooter(spec, fonts) {
  return new Footer({ children: [new Table({
    width: { size: TABLE_WIDTH, type: WidthType.DXA },
    layout: TableLayoutType.FIXED,
    columnWidths: [2400, TABLE_WIDTH - 4800, 2400],
    borders: { ...tableBorders, insideHorizontal: { style: BorderStyle.NONE }, insideVertical: { style: BorderStyle.NONE } },
    rows: [new TableRow({ children: [
      new TableCell({ borders: tableBorders, children: [docxParagraph(spec.confidentiality, { ...fonts, color: COLORS.muted, after: 0, size: 16 })] }),
      new TableCell({ borders: tableBorders, children: [docxParagraph('SUNKAIER', { ...fonts, color: COLORS.muted, after: 0, size: 16, alignment: AlignmentType.CENTER })] }),
      new TableCell({ borders: tableBorders, children: [new Paragraph({
        alignment: AlignmentType.RIGHT,
        spacing: { after: 0 },
        children: [
          docxRun(spec.language === 'zh' ? '第 ' : 'Page ', { ...fonts, size: 16, color: COLORS.muted }),
          new TextRun({ children: [PageNumber.CURRENT], font: fonts.font, size: 16, color: COLORS.muted }),
          docxRun(spec.language === 'zh' ? ' 页 / 共 ' : ' of ', { ...fonts, size: 16, color: COLORS.muted }),
          new TextRun({ children: [PageNumber.TOTAL_PAGES_IN_SECTION], font: fonts.font, size: 16, color: COLORS.muted }),
          ...(spec.language === 'zh' ? [docxRun(' 页', { ...fonts, size: 16, color: COLORS.muted })] : [])
        ]
      })] })
    ] })]
  })] });
}

function coverChildren(spec, fonts, logoBuffer) {
  const items = [];
  if (logoBuffer) {
    const dimensions = imageDimensions(logoBuffer);
    const width = 250;
    const height = Math.max(40, Math.round(width * dimensions.height / dimensions.width));
    items.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { before: 1400, after: 900 },
      children: [new ImageRun({ data: logoBuffer, type: dimensions.type, transformation: { width, height } })]
    }));
  } else {
    items.push(docxParagraph('SUNKAIER', { ...fonts, size: 38, bold: true, color: COLORS.navy, alignment: AlignmentType.CENTER, before: 1500, after: 900 }));
  }
  items.push(new Paragraph({ text: spec.identity.title, style: 'Title', alignment: AlignmentType.CENTER }));
  items.push(docxParagraph(spec.opportunity.title, { ...fonts, size: 28, bold: true, color: COLORS.navy, alignment: AlignmentType.CENTER, before: 220, after: 160 }));
  items.push(docxParagraph(spec.opportunity.customerName, { ...fonts, size: 22, color: COLORS.muted, alignment: AlignmentType.CENTER, after: 700 }));
  items.push(docxTable([
    ['Document No. / 文件编号', spec.versionLabel],
    ['Opportunity / 商机编号', spec.opportunity.opportunityNo],
    ['Language / 输出语言', languageName(spec.language)],
    ['Release date / 发布日期', dateText(spec.approvedAt)],
    ['Classification / 保密级别', spec.confidentiality],
    ['Prepared by / 编制', spec.responsibility.prepared],
    ['Reviewed by / 审核', spec.responsibility.reviewed],
    ['Approval / 批准', spec.responsibility.approved],
    ['Generated by / 生成人', text(spec.generatedBy.displayName || spec.generatedBy.username) || '-']
  ]));
  return items.filter(Boolean);
}

function bodyChildren(spec, fonts) {
  const children = [
    new Paragraph({ text: localized(spec.language, 'Contents', '目录'), heading: HeadingLevel.HEADING_1, keepNext: true }),
    new TableOfContents('', { hyperlink: true, headingStyleRange: '1-2' })
  ];
  for (const section of spec.sections) {
    children.push(new Paragraph({
      text: `${section.number} ${section.title}`,
      heading: section.level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_1,
      keepNext: true,
      pageBreakBefore: section.level === 1 && section.number !== '1'
    }));
    for (const block of section.blocks) {
      if (block.type === 'paragraph') children.push(docxParagraph(block.text, fonts));
      else if (block.type === 'label') children.push(docxParagraph(block.text, { ...fonts, bold: true, color: COLORS.blue, after: 50, keepNext: true }));
      else if (block.type === 'subheading') children.push(new Paragraph({ text: block.text, heading: HeadingLevel.HEADING_3, keepNext: true }));
      else if (block.type === 'table') {
        const table = docxTable(block.rows, { compact: block.rows?.[0]?.length > 4 });
        if (table) children.push(table, docxParagraph('', { ...fonts, after: 80 }));
      } else if (block.type === 'image') children.push(...docxImage(block.image));
    }
  }
  return children;
}

async function deterministicDocx(document, timestamp = CANONICAL_ZIP_DATE) {
  const packed = await Packer.toBuffer(document);
  const source = await JSZip.loadAsync(packed);
  const output = new JSZip();
  const names = Object.keys(source.files).filter((name) => !source.files[name].dir).sort();
  for (const name of names) {
    let content = await source.files[name].async('nodebuffer');
    if (name === 'docProps/core.xml') {
      const iso = normalizedDate(timestamp).toISOString();
      content = Buffer.from(content.toString('utf8').replace(
        /(<dcterms:(?:created|modified)[^>]*>)[^<]*(<\/dcterms:(?:created|modified)>)/g,
        `$1${iso}$2`
      ), 'utf8');
    }
    output.file(name, content, {
      date: CANONICAL_ZIP_DATE,
      createFolders: false,
      compression: 'DEFLATE'
    });
  }
  return output.generateAsync({
    type: 'nodebuffer', platform: 'DOS', compression: 'DEFLATE',
    compressionOptions: { level: 9 }, streamFiles: false
  });
}

async function generateDocx(spec, logoBuffer) {
  const layout = spec.outputProfile?.layoutSettings || {};
  const fonts = {
    font: text(layout.englishFont) || 'Arial',
    cjkFont: text(layout.cjkFont) || 'Microsoft YaHei'
  };
  const document = new Document({
    creator: 'SUNKAIER',
    lastModifiedBy: 'BESTCRM',
    title: `${spec.opportunity.opportunityNo} ${spec.identity.title} ${spec.versionLabel}`,
    subject: 'Approved customer bid package',
    description: 'Generated from frozen BESTCRM bid package versions',
    created: spec.approvedAt,
    modified: spec.approvedAt,
    revision: 1,
    features: { updateFields: true },
    styles: {
      default: {
        document: {
          run: { font: { name: fonts.font, eastAsia: fonts.cjkFont }, size: 21, color: COLORS.text },
          paragraph: { spacing: { after: 120, line: 284 } }
        }
      },
      paragraphStyles: [
        { id: 'Title', name: 'Title', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: { name: fonts.font, eastAsia: fonts.cjkFont }, size: 48, bold: true, color: COLORS.navy }, paragraph: { spacing: { before: 0, after: 180 }, keepNext: true } },
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: { name: fonts.font, eastAsia: fonts.cjkFont }, size: 32, bold: true, color: COLORS.navy }, paragraph: { spacing: { before: 260, after: 140 }, keepNext: true, outlineLevel: 0 } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: { name: fonts.font, eastAsia: fonts.cjkFont }, size: 26, bold: true, color: COLORS.navy }, paragraph: { spacing: { before: 220, after: 120 }, keepNext: true, outlineLevel: 1 } },
        { id: 'Heading3', name: 'Heading 3', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: { name: fonts.font, eastAsia: fonts.cjkFont }, size: 22, bold: true, color: COLORS.blue }, paragraph: { spacing: { before: 180, after: 90 }, keepNext: true, outlineLevel: 2 } }
      ]
    },
    sections: [
      {
        properties: { page: { size: A4, margin: MARGINS } },
        children: coverChildren(spec, fonts, logoBuffer)
      },
      {
        properties: {
          type: SectionType.NEXT_PAGE,
          page: { size: A4, margin: MARGINS, pageNumbers: { start: 1 } }
        },
        headers: { default: documentHeader(spec, fonts) },
        footers: { default: documentFooter(spec, fonts) },
        children: bodyChildren(spec, fonts)
      }
    ]
  });
  return deterministicDocx(document, spec.approvedAt);
}

function resolvePdfFont(explicitPath) {
  return [explicitPath, ...defaultPdfFontCandidates].filter(Boolean).find((candidate) => existsSync(candidate)) || null;
}

function pdfPageMetrics(doc) {
  return { left: 57, right: doc.page.width - 51, top: 62, bottom: doc.page.height - 60 };
}

function generatePdf(spec, options, logoBuffer) {
  return new Promise((resolve, reject) => {
    const fontPath = resolvePdfFont(options.fontPath);
    if (!fontPath) {
      reject(new Error('A CJK-capable PDF font is required; configure TECHNICAL_DOCUMENT_FONT_PATH'));
      return;
    }
    const chunks = [];
    const doc = new PDFDocument({
      size: 'A4', margins: { top: 62, right: 51, bottom: 60, left: 57 }, bufferPages: true,
      info: {
        Title: `${spec.opportunity.opportunityNo} ${spec.identity.title} ${spec.versionLabel}`,
        Author: 'SUNKAIER', Subject: 'Approved customer bid package',
        Creator: BID_DOCUMENT_GENERATOR_VERSION, Producer: BID_DOCUMENT_GENERATOR_VERSION,
        CreationDate: spec.approvedAt, ModDate: spec.approvedAt
      }
    });
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.registerFont('SUNKAIER-CJK', fontPath).font('SUNKAIER-CJK');

    const sectionPages = [];
    const tocPageCount = Math.max(1, Math.ceil(spec.sections.length / 28));
    const metrics = () => pdfPageMetrics(doc);
    const pageCount = () => doc.bufferedPageRange().count;
    const addBodyPage = () => { doc.addPage({ size: 'A4', margins: { top: 62, right: 51, bottom: 60, left: 57 } }); doc.font('SUNKAIER-CJK'); };
    const ensureSpace = (height) => {
      if (doc.y + height > metrics().bottom - 30) { addBodyPage(); return true; }
      return false;
    };
    const paragraph = (value, style = {}) => {
      const content = text(value);
      if (!content) return;
      doc.font('SUNKAIER-CJK').fontSize(style.size || 10.5);
      const height = doc.heightOfString(content, { width: metrics().right - metrics().left, lineGap: 3 });
      ensureSpace(height + 12);
      doc.fillColor(style.color || `#${COLORS.text}`).text(content, metrics().left, doc.y, {
        width: metrics().right - metrics().left, lineGap: 3, align: style.align || 'left'
      });
      doc.moveDown(style.gap ?? 0.35);
    };
    const heading = (value, level = 1) => {
      ensureSpace(level === 1 ? 48 : 38);
      doc.font('SUNKAIER-CJK').fillColor(`#${COLORS.navy}`).fontSize(level === 1 ? 16 : level === 2 ? 13 : 11.5)
        .text(value, metrics().left, doc.y, { width: metrics().right - metrics().left, lineGap: 2 });
      doc.moveDown(0.45).fillColor(`#${COLORS.text}`).fontSize(10.5);
    };
    const rowHeight = (values, widths, size) => Math.max(...values.map((value, index) => (
      doc.fontSize(size).heightOfString(value || ' ', { width: widths[index] - 12, lineGap: 2 })
    ))) + 14;
    const drawTableRow = (values, widths, isHeader, rowIndex) => {
      const size = widths.length > 4 ? 8 : 9;
      const height = rowHeight(values, widths, size);
      const y = doc.y;
      let x = metrics().left;
      for (const [index, value] of values.entries()) {
        const fill = isHeader ? `#${COLORS.blue}` : rowIndex % 2 === 0 ? `#${COLORS.paleBlue}` : '#FFFFFF';
        doc.rect(x, y, widths[index], height).fill(fill).stroke(`#${COLORS.border}`);
        doc.fillColor(isHeader ? '#FFFFFF' : `#${COLORS.text}`).fontSize(size)
          .text(value || ' ', x + 6, y + 7, { width: widths[index] - 12, lineGap: 2, align: index === 0 && widths.length > 2 ? 'center' : 'left' });
        x += widths[index];
      }
      doc.y = y + height;
      doc.x = metrics().left;
    };
    const table = (inputRows) => {
      const rows = normalizeRows(inputRows);
      if (!rows.length) return;
      const totalWidth = metrics().right - metrics().left;
      const ratios = columnWidths(rows).map((width) => width / TABLE_WIDTH);
      const widths = ratios.map((ratio, index) => index === ratios.length - 1
        ? totalWidth - ratios.slice(0, -1).reduce((sum, item) => sum + Math.round(item * totalWidth), 0)
        : Math.round(ratio * totalWidth));
      const header = rows[0];
      for (const [index, row] of rows.entries()) {
        const height = rowHeight(row, widths, widths.length > 4 ? 8 : 9);
        const added = ensureSpace(height + 4);
        if (added && index > 0) drawTableRow(header, widths, true, 0);
        drawTableRow(row, widths, index === 0, index);
      }
      doc.moveDown(0.65);
    };
    const image = (item) => {
      const dims = imageDimensions(item.content);
      const maxWidth = metrics().right - metrics().left - 40;
      const maxHeight = 330;
      const scale = Math.min(maxWidth / dims.width, maxHeight / dims.height, 1);
      const width = Math.max(80, dims.width * scale);
      const height = Math.max(45, dims.height * scale);
      ensureSpace(height + 45);
      const x = metrics().left + (metrics().right - metrics().left - width) / 2;
      doc.image(item.content, x, doc.y, { width, height });
      doc.y += height + 8;
      paragraph(item.caption || item.originalName, { size: 8.5, color: `#${COLORS.muted}`, align: 'center', gap: 0.5 });
    };

    // Cover page.
    doc.rect(0, 0, doc.page.width, 118).fill(`#${COLORS.navy}`);
    if (logoBuffer) doc.image(logoBuffer, 57, 38, { fit: [220, 55] });
    else doc.fillColor('#FFFFFF').fontSize(24).text('SUNKAIER', 57, 50);
    doc.y = 205;
    doc.fillColor(`#${COLORS.navy}`).fontSize(26).text(spec.identity.title, 57, doc.y, { width: doc.page.width - 108, align: 'center' });
    doc.moveDown(0.6).fontSize(17).text(spec.opportunity.title, 57, doc.y, { width: doc.page.width - 108, align: 'center' });
    doc.moveDown(0.45).fillColor(`#${COLORS.muted}`).fontSize(12).text(spec.opportunity.customerName, 57, doc.y, { width: doc.page.width - 108, align: 'center' });
    doc.moveDown(2.1);
    table([
      ['Document No. / 文件编号', spec.versionLabel],
      ['Opportunity / 商机编号', spec.opportunity.opportunityNo],
      ['Language / 输出语言', languageName(spec.language)],
      ['Release date / 发布日期', dateText(spec.approvedAt)],
      ['Classification / 保密级别', spec.confidentiality],
      ['Prepared by / 编制', spec.responsibility.prepared],
      ['Reviewed by / 审核', spec.responsibility.reviewed],
      ['Approval / 批准', spec.responsibility.approved],
      ['Generated by / 生成人', text(spec.generatedBy.displayName || spec.generatedBy.username) || '-']
    ]);

    // Reserve deterministic TOC pages before rendering content.
    for (let index = 0; index < tocPageCount; index += 1) addBodyPage();
    addBodyPage();

    for (const section of spec.sections) {
      if (section.level === 1 && doc.y > metrics().top + 8) addBodyPage();
      // Keep second-level section headings with a meaningful amount of their
      // first content block. Without this guard a long paragraph can move to
      // the next page and leave only the heading (and language label) behind.
      if (section.level === 2) ensureSpace(260);
      sectionPages.push({ ...section, page: pageCount() - 1 });
      heading(`${section.number} ${section.title}`, section.level);
      for (const block of section.blocks) {
        if (block.type === 'paragraph') paragraph(block.text);
        else if (block.type === 'label') paragraph(block.text, { size: 10, color: `#${COLORS.blue}`, gap: 0.2 });
        else if (block.type === 'subheading') { ensureSpace(150); heading(block.text, 3); }
        else if (block.type === 'table') table(block.rows);
        else if (block.type === 'image') image(block.image);
      }
    }

    // Populate reserved TOC pages with actual page numbers.
    for (let tocIndex = 0; tocIndex < tocPageCount; tocIndex += 1) {
      doc.switchToPage(1 + tocIndex);
      doc.font('SUNKAIER-CJK');
      doc.y = 72;
      doc.fillColor(`#${COLORS.navy}`).fontSize(18).text(localized(spec.language, 'Contents', '目录'), 57, doc.y, { width: doc.page.width - 108 });
      doc.moveDown(1);
      const entries = sectionPages.slice(tocIndex * 28, (tocIndex + 1) * 28);
      for (const entry of entries) {
        const indent = entry.level === 2 ? 18 : 0;
        const y = doc.y;
        doc.fillColor(`#${COLORS.text}`).fontSize(entry.level === 2 ? 9.5 : 10.5)
          .text(`${entry.number} ${entry.title}`, 57 + indent, y, { width: doc.page.width - 170 - indent, lineBreak: false });
        doc.text(String(entry.page), doc.page.width - 92, y, { width: 35, align: 'right', lineBreak: false });
        doc.y = y + 22;
      }
    }

    // Add consistent headers and section-relative page numbers to every non-cover page.
    const range = doc.bufferedPageRange();
    for (let pageIndex = 1; pageIndex < range.count; pageIndex += 1) {
      doc.switchToPage(pageIndex);
      doc.font('SUNKAIER-CJK');
      const page = doc.page;
      doc.fillColor(`#${COLORS.navy}`).fontSize(8.5).text('SUNKAIER', 57, 28, { width: 110, lineBreak: false });
      doc.fillColor(`#${COLORS.muted}`).fontSize(8).text(spec.opportunity.title, 170, 28, { width: page.width - 340, align: 'center', lineBreak: false });
      doc.fillColor(`#${COLORS.navy}`).fontSize(8.5).text(spec.versionLabel, page.width - 160, 28, { width: 103, align: 'right', lineBreak: false });
      const footerY = page.height - 38;
      const originalBottomMargin = page.margins.bottom;
      // PDFKit auto-paginates text below the body margin. Footers intentionally
      // live inside the physical bottom margin, so temporarily disable that
      // pagination boundary while drawing the three fixed footer fields.
      page.margins.bottom = 0;
      doc.fillColor(`#${COLORS.muted}`).fontSize(8).text(spec.confidentiality, 57, footerY, { width: 130, lineBreak: false });
      doc.text('SUNKAIER', 200, footerY, { width: page.width - 400, align: 'center', lineBreak: false });
      const number = pageIndex;
      const total = range.count - 1;
      const pageLabel = spec.language === 'zh' ? `第 ${number} 页 / 共 ${total} 页` : `Page ${number} of ${total}`;
      doc.text(pageLabel, page.width - 210, footerY, { width: 153, align: 'right', lineBreak: false });
      page.margins.bottom = originalBottomMargin;
    }
    doc.end();
  });
}

async function loadLogo(options) {
  if (Buffer.isBuffer(options.logoBuffer)) return options.logoBuffer;
  if (!options.logoPath || !existsSync(options.logoPath)) return null;
  return readFile(options.logoPath);
}

export function createBidDocumentRenderer(options = {}) {
  return Object.freeze({
    async generatePackage(input) {
      const spec = buildBidDocumentSpec(input);
      const logoBuffer = await loadLogo(options);
      const [docxContent, pdfContent] = await Promise.all([
        generateDocx(spec, logoBuffer),
        generatePdf(spec, options, logoBuffer)
      ]);
      return [
        {
          documentNo: spec.versionLabel,
          format: 'docx',
          originalName: `${spec.fileBase}.docx`,
          mimeType: DOCX_MIME,
          content: docxContent,
          byteSize: docxContent.length,
          sha256: checksum(docxContent)
        },
        {
          documentNo: spec.versionLabel,
          format: 'pdf',
          originalName: `${spec.fileBase}.pdf`,
          mimeType: 'application/pdf',
          content: pdfContent,
          byteSize: pdfContent.length,
          sha256: checksum(pdfContent)
        }
      ];
    }
  });
}

export const bidDocumentRendererInternals = Object.freeze({
  checksum,
  safeFilePart,
  languageName,
  normalizeRows,
  imageDimensions,
  deterministicDocx
});
