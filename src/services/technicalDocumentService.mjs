import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import {
  AlignmentType,
  BorderStyle,
  Document,
  Footer,
  Header,
  HeadingLevel,
  PageNumber,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType
} from 'docx';
import PDFDocument from 'pdfkit';
import { createBidDocumentRenderer } from './bidDocumentRenderer.mjs';

const NAVY = '244C7C';
const ORANGE = 'F15A24';
const PALE_BLUE = 'E8EEF5';
const LIGHT_GRAY = 'F2F4F7';
const MUTED = '5E6875';
const TABLE_WIDTH = 9360;
const DEFAULT_FONT = 'Arial';
const CJK_FONT = 'Microsoft YaHei';

const defaultPdfFontCandidates = [
  'C:\\Windows\\Fonts\\NotoSansSC-VF.ttf',
  'C:\\Windows\\Fonts\\simhei.ttf',
  'C:\\Windows\\Fonts\\msyh.ttc',
  '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
  '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc',
  '/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc'
];

function text(value) {
  return String(value ?? '').trim();
}

function dateText(value) {
  if (!value) return '-';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? text(value) : date.toISOString().slice(0, 10);
}

function documentNo(draft) {
  return `TS-V${Number(draft.formalVersionNo)}`;
}

function safeFilePart(value) {
  return text(value).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'technical-solution';
}

function checksum(content) {
  return createHash('sha256').update(content).digest('hex');
}

function ensureApprovedDraft(draft) {
  if (!draft || draft.status !== 'approved' || !Number.isInteger(Number(draft.formalVersionNo))) {
    const error = new Error('Only an approved technical solution version can generate documents');
    error.statusCode = 409;
    throw error;
  }
}

function localizedValues(language, valueEn, valueZh) {
  if (language === 'en') return [text(valueEn)];
  if (language === 'zh') return [text(valueZh)];
  return [text(valueEn), text(valueZh)].filter(Boolean);
}

function bodyRun(value, options = {}) {
  return new TextRun({
    text: String(value ?? ''),
    font: { name: DEFAULT_FONT, eastAsia: CJK_FONT },
    size: options.size || 22,
    bold: options.bold,
    color: options.color || '1F2933'
  });
}

function bodyParagraph(value, options = {}) {
  return new Paragraph({
    children: [bodyRun(value, options)],
    spacing: { before: options.before ?? 0, after: options.after ?? 120, line: options.line ?? 264 },
    alignment: options.alignment || AlignmentType.LEFT,
    keepNext: options.keepNext
  });
}

function brandedHeader() {
  return new Header({
    children: [new Paragraph({
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'D7DBE2' } },
      spacing: { after: 80 },
      children: [
        bodyRun('S', { size: 22, bold: true, color: NAVY }),
        bodyRun('U', { size: 22, bold: true, color: ORANGE }),
        bodyRun('NKAIER', { size: 22, bold: true, color: NAVY }),
        bodyRun('  |  TECHNICAL SOLUTION / 技术方案', { size: 18, color: MUTED })
      ]
    })]
  });
}

function brandedFooter(documentNumber) {
  return new Footer({
    children: [new Paragraph({
      border: { top: { style: BorderStyle.SINGLE, size: 4, color: 'D7DBE2' } },
      spacing: { before: 80 },
      children: [
        bodyRun(`${documentNumber}  |  SUNKAIER  |  `, { size: 17, color: MUTED }),
        new TextRun({ children: ['Page ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES], font: DEFAULT_FONT, size: 17, color: MUTED })
      ]
    })]
  });
}

function cell(value, width, options = {}) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 100, bottom: 100, left: 120, right: 120 },
    shading: options.fill ? { type: ShadingType.CLEAR, fill: options.fill, color: 'auto' } : undefined,
    children: [bodyParagraph(value, {
      size: options.size || 20,
      bold: options.bold,
      color: options.color,
      after: 0,
      line: 240,
      alignment: options.alignment
    })]
  });
}

function fixedTable(rows, widths, options = {}) {
  return new Table({
    width: { size: TABLE_WIDTH, type: WidthType.DXA },
    layout: TableLayoutType.FIXED,
    columnWidths: widths,
    indent: { size: 120, type: WidthType.DXA },
    rows: rows.map((row, rowIndex) => new TableRow({
      tableHeader: Boolean(options.header && rowIndex === 0),
      cantSplit: true,
      children: row.map((value, columnIndex) => cell(value, widths[columnIndex], {
        bold: Boolean(options.header && rowIndex === 0) || (options.labelColumn && columnIndex === 0),
        fill: options.header && rowIndex === 0 ? PALE_BLUE : options.labelColumn && columnIndex === 0 ? LIGHT_GRAY : undefined,
        alignment: options.centerColumns?.includes(columnIndex) ? AlignmentType.CENTER : AlignmentType.LEFT
      }))
    }))
  });
}

function metadataRows(draft, opportunity, reviewer) {
  return [
    ['Document No. / 文档编号', documentNo(draft)],
    ['Opportunity / 商机', `${text(opportunity.opportunityNo)} - ${text(opportunity.title)}`],
    ['Template / 模板', `${text(draft.templateCodeSnapshot)} - ${text(draft.templateNameSnapshot)} - TPL-R${draft.templateRevisionNoSnapshot}`],
    ['Language / 语言', draft.language === 'en' ? 'English' : draft.language === 'zh' ? '中文' : 'English / 中文'],
    ['Approved by / 批准人', text(reviewer?.displayName || draft.reviewerDisplayName || reviewer?.username) || '-'],
    ['Approved on / 批准日期', dateText(draft.reviewedAt)]
  ];
}

function sectionParagraphs(section, language) {
  const paragraphs = [];
  const bodies = localizedValues(language, section.bodyEn, section.bodyZh);
  for (const [index, value] of bodies.entries()) {
    if (!value) continue;
    if (language === 'bilingual') {
      paragraphs.push(bodyParagraph(index === 0 ? 'EN' : '中文', { bold: true, color: NAVY, after: 40, keepNext: true }));
    }
    for (const line of value.split(/\r?\n/)) {
      if (line.trim()) paragraphs.push(bodyParagraph(line.trim()));
    }
  }
  return paragraphs;
}

function buildDocx(draft, opportunity, reviewer) {
  const number = documentNo(draft);
  const children = [
    bodyParagraph('SUNKAIER', { size: 24, bold: true, color: NAVY, after: 60 }),
    bodyParagraph(draft.templateNameSnapshot, { size: 38, bold: true, color: NAVY, after: 80 }),
    bodyParagraph('Technical Solution / 技术方案', { size: 26, color: MUTED, after: 280 }),
    fixedTable(metadataRows(draft, opportunity, reviewer), [2700, 6660], { labelColumn: true }),
    bodyParagraph('', { after: 80 }),
    new Paragraph({ text: 'Project Variables / 项目参数', heading: HeadingLevel.HEADING_1, keepNext: true })
  ];

  const variableRows = [['Parameter / 参数', 'Value / 数值']];
  for (const variable of draft.renderedContent?.variables || []) {
    const label = draft.language === 'en'
      ? variable.labelEn
      : draft.language === 'zh'
        ? variable.labelZh
        : `${variable.labelEn} / ${variable.labelZh}`;
    variableRows.push([label || variable.variableKey, variable.value === true ? 'Yes / 是' : variable.value === false ? 'No / 否' : text(variable.value) || '-']);
  }
  children.push(fixedTable(variableRows, [3600, 5760], { header: true }));

  for (const section of (draft.renderedContent?.sections || []).filter((item) => item.included !== false)) {
    const heading = draft.language === 'en'
      ? section.labelEn
      : draft.language === 'zh'
        ? section.labelZh
        : `${section.labelEn} / ${section.labelZh}`;
    children.push(new Paragraph({ text: heading || section.key, heading: HeadingLevel.HEADING_1, keepNext: true }));
    children.push(...sectionParagraphs(section, draft.language));
    if (Array.isArray(section.tableRows) && section.tableRows.length) {
      const columnCount = Math.max(...section.tableRows.map((row) => row.length), 1);
      const baseWidth = Math.floor(TABLE_WIDTH / columnCount);
      const widths = Array.from({ length: columnCount }, (_, index) => index === columnCount - 1 ? TABLE_WIDTH - baseWidth * (columnCount - 1) : baseWidth);
      const rows = section.tableRows.map((row) => Array.from({ length: columnCount }, (_, index) => text(row[index])));
      children.push(fixedTable(rows, widths, { header: rows.length > 1 }));
    }
    if (Array.isArray(section.clauses) && section.clauses.length) {
      children.push(new Paragraph({ text: 'Standard Clauses / 标准条款', heading: HeadingLevel.HEADING_2, keepNext: true }));
      for (const clause of section.clauses) {
        children.push(bodyParagraph(`${clause.revisionLabel} - ${clause.title}`, { bold: true, color: NAVY, after: 40, keepNext: true }));
        children.push(bodyParagraph(clause.content));
      }
    }
  }

  children.push(new Paragraph({
    text: 'Approval Record / 审批记录',
    heading: HeadingLevel.HEADING_1,
    keepNext: true,
    pageBreakBefore: true
  }));
  children.push(fixedTable([
    ['Status / 状态', 'APPROVED / 已批准'],
    ['Submitted by / 提交人', text(draft.submitterDisplayName) || String(draft.submittedBy || '-')],
    ['Submitted on / 提交日期', dateText(draft.submittedAt)],
    ['Approved by / 批准人', text(reviewer?.displayName || draft.reviewerDisplayName) || String(draft.reviewedBy || '-')],
    ['Approved on / 批准日期', dateText(draft.reviewedAt)],
    ['Review comment / 审批意见', text(draft.reviewComment) || '-']
  ], [2700, 6660], { labelColumn: true }));

  return new Document({
    styles: {
      default: {
        document: { run: { font: { name: DEFAULT_FONT, eastAsia: CJK_FONT }, size: 22, color: '1F2933' }, paragraph: { spacing: { after: 120, line: 264 } } }
      },
      paragraphStyles: [
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: { name: DEFAULT_FONT, eastAsia: CJK_FONT }, size: 32, bold: true, color: NAVY }, paragraph: { spacing: { before: 320, after: 160 }, keepNext: true, outlineLevel: 0 } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: { name: DEFAULT_FONT, eastAsia: CJK_FONT }, size: 26, bold: true, color: NAVY }, paragraph: { spacing: { before: 240, after: 120 }, keepNext: true, outlineLevel: 1 } }
      ]
    },
    sections: [{
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440, header: 708, footer: 708 }
        }
      },
      headers: { default: brandedHeader() },
      footers: { default: brandedFooter(number) },
      children
    }]
  });
}

function resolvePdfFont(explicitPath) {
  const candidates = [explicitPath, ...defaultPdfFontCandidates].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate)) || null;
}

function generatePdfBuffer(draft, opportunity, reviewer, fontPath) {
  return new Promise((resolve, reject) => {
    const pdfFont = resolvePdfFont(fontPath);
    if (!pdfFont) {
      reject(new Error('A CJK-capable PDF font is required; configure TECHNICAL_DOCUMENT_FONT_PATH'));
      return;
    }
    const chunks = [];
    const doc = new PDFDocument({ size: 'LETTER', margins: { top: 62, right: 54, bottom: 62, left: 54 }, bufferPages: true, info: { Title: `${documentNo(draft)} ${draft.templateNameSnapshot}`, Author: 'SUNKAIER', Subject: 'Approved Technical Solution' } });
    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.registerFont('SUNKAIER-CJK', pdfFont);
    doc.font('SUNKAIER-CJK');

    const left = 54;
    const contentWidth = 504;
    const pageBottom = () => doc.page.height - 78;
    const ensureSpace = (height = 40) => {
      if (doc.y + height > pageBottom()) doc.addPage();
      doc.x = left;
    };
    const heading = (value, size = 16) => {
      ensureSpace(40);
      doc.moveDown(0.5).fillColor(`#${NAVY}`).fontSize(size).text(value, left, doc.y, { width: contentWidth, lineGap: 2 });
      doc.fillColor('#1F2933').fontSize(10.5);
      doc.x = left;
    };
    const paragraph = (value, options = {}) => {
      if (!text(value)) return;
      ensureSpace(doc.heightOfString(text(value), { width: contentWidth, lineGap: 3 }) + 12);
      doc.fillColor(options.color || '#1F2933').fontSize(options.size || 10.5).text(text(value), left, doc.y, { width: contentWidth, lineGap: 3 });
      doc.moveDown(options.gap ?? 0.35);
      doc.x = left;
    };
    const keyValueRows = (rows) => {
      const x = left;
      const labelWidth = 145;
      const valueWidth = contentWidth - labelWidth;
      for (const [label, value] of rows) {
        const height = Math.max(doc.heightOfString(label, { width: labelWidth - 16 }), doc.heightOfString(String(value), { width: valueWidth - 16 })) + 14;
        ensureSpace(height);
        doc.rect(x, doc.y, labelWidth, height).fill('#F2F4F7').stroke('#D7DBE2');
        doc.rect(x + labelWidth, doc.y, valueWidth, height).fill('#FFFFFF').stroke('#D7DBE2');
        const rowY = doc.y;
        doc.fillColor(`#${NAVY}`).fontSize(9.5).text(label, x + 8, rowY + 7, { width: labelWidth - 16 });
        doc.fillColor('#1F2933').text(String(value), x + labelWidth + 8, rowY + 7, { width: valueWidth - 16 });
        doc.y = rowY + height;
        doc.x = left;
      }
      doc.moveDown(0.6);
      doc.x = left;
    };
    const gridRows = (rows) => {
      if (!rows.length) return;
      const x = left;
      const cols = Math.max(...rows.map((row) => row.length), 1);
      const width = contentWidth / cols;
      for (const [rowIndex, row] of rows.entries()) {
        const values = Array.from({ length: cols }, (_, index) => text(row[index]));
        const height = Math.max(...values.map((value) => doc.heightOfString(value || ' ', { width: width - 12, lineGap: 2 }))) + 12;
        ensureSpace(height);
        const rowY = doc.y;
        for (const [columnIndex, value] of values.entries()) {
          doc.rect(x + columnIndex * width, rowY, width, height).fill(rowIndex === 0 ? '#E8EEF5' : '#FFFFFF').stroke('#CBD3DC');
          doc.fillColor(rowIndex === 0 ? `#${NAVY}` : '#1F2933').fontSize(9).text(value || ' ', x + columnIndex * width + 6, rowY + 6, { width: width - 12, lineGap: 2 });
        }
        doc.y = rowY + height;
        doc.x = left;
      }
      doc.moveDown(0.6);
      doc.x = left;
    };

    doc.fillColor(`#${NAVY}`).fontSize(13).text('S', left, doc.y, { continued: true });
    doc.fillColor(`#${ORANGE}`).text('U', { continued: true });
    doc.fillColor(`#${NAVY}`).text('NKAIER');
    doc.moveTo(54, doc.y + 4).lineTo(558, doc.y + 4).strokeColor('#D7DBE2').stroke();
    doc.moveDown(1.7).fillColor(`#${NAVY}`).fontSize(24).text(draft.templateNameSnapshot, left, doc.y, { width: contentWidth, lineGap: 3 });
    doc.fillColor(`#${MUTED}`).fontSize(14).text('Technical Solution / 技术方案', left, doc.y, { width: contentWidth });
    doc.moveDown(1.2);
    keyValueRows(metadataRows(draft, opportunity, reviewer));

    heading('Project Variables / 项目参数');
    gridRows([['Parameter / 参数', 'Value / 数值'], ...(draft.renderedContent?.variables || []).map((variable) => {
      const label = draft.language === 'en' ? variable.labelEn : draft.language === 'zh' ? variable.labelZh : `${variable.labelEn} / ${variable.labelZh}`;
      const value = variable.value === true ? 'Yes / 是' : variable.value === false ? 'No / 否' : text(variable.value) || '-';
      return [label || variable.variableKey, value];
    })]);

    for (const section of (draft.renderedContent?.sections || []).filter((item) => item.included !== false)) {
      const title = draft.language === 'en' ? section.labelEn : draft.language === 'zh' ? section.labelZh : `${section.labelEn} / ${section.labelZh}`;
      heading(title || section.key);
      const bodies = localizedValues(draft.language, section.bodyEn, section.bodyZh);
      for (const [index, value] of bodies.entries()) {
        if (draft.language === 'bilingual' && value) paragraph(index === 0 ? 'EN' : '中文', { color: `#${NAVY}`, size: 10 });
        paragraph(value);
      }
      gridRows(section.tableRows || []);
      if (section.clauses?.length) {
        paragraph('Standard Clauses / 标准条款', { color: `#${NAVY}`, size: 11 });
        for (const clause of section.clauses) {
          paragraph(`${clause.revisionLabel} - ${clause.title}`, { color: `#${NAVY}` });
          paragraph(clause.content);
        }
      }
    }

    heading('Approval Record / 审批记录');
    keyValueRows([
      ['Status / 状态', 'APPROVED / 已批准'],
      ['Submitted by / 提交人', text(draft.submitterDisplayName) || String(draft.submittedBy || '-')],
      ['Submitted on / 提交日期', dateText(draft.submittedAt)],
      ['Approved by / 批准人', text(reviewer?.displayName || draft.reviewerDisplayName) || String(draft.reviewedBy || '-')],
      ['Approved on / 批准日期', dateText(draft.reviewedAt)],
      ['Review comment / 审批意见', text(draft.reviewComment) || '-']
    ]);

    const range = doc.bufferedPageRange();
    for (let index = range.start; index < range.start + range.count; index += 1) {
      doc.switchToPage(index);
      doc.font('SUNKAIER-CJK').fontSize(8).fillColor(`#${MUTED}`);
      const footerY = doc.page.height - 74;
      doc.text(`${documentNo(draft)}  |  SUNKAIER`, left, footerY, { width: 300, lineBreak: false });
      doc.text(`Page ${index + 1} of ${range.count}`, 358, footerY, { width: 200, align: 'right', lineBreak: false });
    }
    doc.end();
  });
}

export function createTechnicalDocumentService(options = {}) {
  const bidRenderer = options.bidDocumentRenderer || createBidDocumentRenderer(options);
  return {
    async generateApprovedDocuments({ draft, opportunity, reviewer }) {
      ensureApprovedDraft(draft);
      const number = documentNo(draft);
      const fileBase = `${safeFilePart(opportunity.opportunityNo)}_${number}`;
      const [docxContent, pdfContent] = await Promise.all([
        Packer.toBuffer(buildDocx(draft, opportunity, reviewer)),
        generatePdfBuffer(draft, opportunity, reviewer, options.fontPath)
      ]);
      return [
        {
          documentNo: number,
          format: 'docx',
          originalName: `${fileBase}.docx`,
          mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          content: docxContent,
          byteSize: docxContent.length,
          sha256: checksum(docxContent)
        },
        {
          documentNo: number,
          format: 'pdf',
          originalName: `${fileBase}.pdf`,
          mimeType: 'application/pdf',
          content: pdfContent,
          byteSize: pdfContent.length,
          sha256: checksum(pdfContent)
        }
      ];
    },

    async generateControlledBidDocuments(input) {
      ensureApprovedDraft(input.draft);
      return bidRenderer.generatePackage({
        ...input,
        packageType: 'technical',
        technicalDraft: input.draft,
        versionLabel: input.versionLabel || input.draft.formalVersionLabel || documentNo(input.draft),
        approvedAt: input.approvedAt || input.draft.reviewedAt
      });
    }
  };
}
