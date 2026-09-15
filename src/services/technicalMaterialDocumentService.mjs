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
import {
  opportunityTechnicalDocumentVersionLabel,
  technicalDocumentType
} from '../domain/technicalTemplates.mjs';

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

function checksum(content) {
  return createHash('sha256').update(content).digest('hex');
}

function safeFilePart(value) {
  return text(value).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'technical-document';
}

function documentKind(documentType) {
  const labels = {
    datasheet: 'DATASHEET / 技术数据表',
    technical_agreement: 'TECHNICAL AGREEMENT / 技术协议',
    bidding_document: 'BIDDING DOCUMENT / 标书'
  };
  return labels[documentType] || technicalDocumentType(documentType)?.label || 'TECHNICAL DOCUMENT';
}

function run(value, options = {}) {
  return new TextRun({
    text: String(value ?? ''),
    font: { name: DEFAULT_FONT, eastAsia: CJK_FONT },
    size: options.size || 21,
    bold: options.bold,
    color: options.color || '1F2933'
  });
}

function paragraph(value, options = {}) {
  return new Paragraph({
    children: [run(value, options)],
    spacing: { before: options.before ?? 0, after: options.after ?? 100, line: options.line ?? 252 },
    alignment: options.alignment || AlignmentType.LEFT,
    keepNext: options.keepNext,
    pageBreakBefore: options.pageBreakBefore
  });
}

function header(kind) {
  return new Header({
    children: [new Paragraph({
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'D7DBE2' } },
      spacing: { after: 80 },
      children: [
        run('S', { bold: true, color: NAVY }),
        run('U', { bold: true, color: ORANGE }),
        run(`NKAIER  |  ${kind}`, { size: 18, bold: true, color: NAVY })
      ]
    })]
  });
}

function footer(versionLabel) {
  return new Footer({
    children: [new Paragraph({
      border: { top: { style: BorderStyle.SINGLE, size: 4, color: 'D7DBE2' } },
      children: [
        run(`${versionLabel}  |  SUNKAIER  |  `, { size: 16, color: MUTED }),
        new TextRun({
          children: ['Page ', PageNumber.CURRENT, ' of ', PageNumber.TOTAL_PAGES],
          font: DEFAULT_FONT,
          size: 16,
          color: MUTED
        })
      ]
    })]
  });
}

function tableCell(value, width, options = {}) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 90, bottom: 90, left: 110, right: 110 },
    shading: options.fill ? { type: ShadingType.CLEAR, fill: options.fill, color: 'auto' } : undefined,
    children: [paragraph(value || '-', { bold: options.bold, size: 19, after: 0, line: 230 })]
  });
}

function fixedTable(rows, { headerRow = false, labelColumn = false } = {}) {
  const columnCount = Math.max(...rows.map((row) => row.length), 1);
  const baseWidth = Math.floor(TABLE_WIDTH / columnCount);
  const widths = Array.from({ length: columnCount }, (_, index) => (
    index === columnCount - 1 ? TABLE_WIDTH - baseWidth * (columnCount - 1) : baseWidth
  ));
  return new Table({
    width: { size: TABLE_WIDTH, type: WidthType.DXA },
    layout: TableLayoutType.FIXED,
    columnWidths: widths,
    rows: rows.map((row, rowIndex) => new TableRow({
      tableHeader: headerRow && rowIndex === 0,
      cantSplit: true,
      children: Array.from({ length: columnCount }, (_, columnIndex) => tableCell(
        row[columnIndex],
        widths[columnIndex],
        {
          bold: (headerRow && rowIndex === 0) || (labelColumn && columnIndex === 0),
          fill: headerRow && rowIndex === 0 ? PALE_BLUE : labelColumn && columnIndex === 0 ? LIGHT_GRAY : undefined
        }
      ))
    }))
  });
}

function itemIdentityRows(item) {
  return [
    ['Item / 项号', String(item.itemNo)],
    ['Category / 产品分类', item.productCategoryName],
    ['Equipment / 设备', item.equipmentName],
    ['Model / 型号', item.model || '-'],
    ['Quantity / 数量', String(item.quantity)],
    ['Template / 模板', `${item.templateCode} · TPL-R${item.templateRevisionNo}`]
  ];
}

function parameterRows(item) {
  const rows = [['Parameter / 参数', 'Value / 数值']];
  const renderedVariables = item.renderedContent?.variables || [];
  const variableKeys = new Set(renderedVariables.map((variable) => variable.variableKey));
  for (const variable of renderedVariables) {
    rows.push([
      `${variable.labelEn || variable.variableKey}${variable.labelZh ? ` / ${variable.labelZh}` : ''}`,
      text(variable.value) || '-'
    ]);
  }
  for (const parameter of item.technicalParameters || []) {
    if (variableKeys.has(parameter.key)) continue;
    rows.push([parameter.label ? `${parameter.label} (${parameter.key})` : parameter.key, text(parameter.value) || '-']);
  }
  return rows;
}

function docxDocument({ opportunity, document, versionNo, items }) {
  const versionLabel = opportunityTechnicalDocumentVersionLabel(document.documentCode, versionNo);
  const kind = documentKind(document.documentType);
  const children = [
    paragraph('SUNKAIER', { size: 25, bold: true, color: NAVY, after: 60 }),
    paragraph(document.title, { size: 38, bold: true, color: NAVY, after: 70 }),
    paragraph(kind, { size: 25, color: MUTED, after: 250 }),
    fixedTable([
      ['Document No. / 文件编号', versionLabel],
      ['Opportunity / 商机', `${text(opportunity.opportunityNo)} - ${text(opportunity.title)}`],
      ['Customer / 客户', text(opportunity.customerName) || '-'],
      ['Equipment Count / 设备项数', String(items.length)]
    ], { labelColumn: true })
  ];

  for (const [itemIndex, item] of items.entries()) {
    children.push(new Paragraph({
      text: `${item.itemNo}. ${item.equipmentName}`,
      heading: HeadingLevel.HEADING_1,
      keepNext: true,
      pageBreakBefore: itemIndex > 0
    }));
    children.push(fixedTable(itemIdentityRows(item), { labelColumn: true }));
    children.push(new Paragraph({ text: 'Technical Parameters / 技术参数', heading: HeadingLevel.HEADING_2, keepNext: true }));
    children.push(fixedTable(parameterRows(item), { headerRow: true }));

    for (const section of (item.renderedContent?.sections || []).filter((candidate) => candidate.included !== false)) {
      children.push(new Paragraph({
        text: `${section.labelEn || section.key}${section.labelZh ? ` / ${section.labelZh}` : ''}`,
        heading: HeadingLevel.HEADING_2,
        keepNext: true
      }));
      for (const body of [section.bodyEn, section.bodyZh].filter((value) => text(value))) {
        for (const line of String(body).split(/\r?\n/).filter((value) => text(value))) children.push(paragraph(text(line)));
      }
      if (Array.isArray(section.tableRows) && section.tableRows.length) {
        children.push(fixedTable(section.tableRows.map((row) => row.map(text)), { headerRow: section.tableRows.length > 1 }));
      }
      for (const clause of section.clauses || []) {
        children.push(paragraph(`${clause.revisionLabel} · ${clause.title}`, { bold: true, color: NAVY, keepNext: true }));
        children.push(paragraph(clause.content));
      }
    }
  }

  return new Document({
    styles: {
      default: {
        document: {
          run: { font: { name: DEFAULT_FONT, eastAsia: CJK_FONT }, size: 21, color: '1F2933' },
          paragraph: { spacing: { after: 100, line: 252 } }
        }
      },
      paragraphStyles: [
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: { name: DEFAULT_FONT, eastAsia: CJK_FONT }, size: 32, bold: true, color: NAVY }, paragraph: { spacing: { before: 300, after: 150 }, keepNext: true, outlineLevel: 0 } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: { name: DEFAULT_FONT, eastAsia: CJK_FONT }, size: 25, bold: true, color: NAVY }, paragraph: { spacing: { before: 220, after: 110 }, keepNext: true, outlineLevel: 1 } }
      ]
    },
    sections: [{
      properties: {
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440, header: 708, footer: 708 }
        }
      },
      headers: { default: header(kind) },
      footers: { default: footer(versionLabel) },
      children
    }]
  });
}

function resolvePdfFont(explicitPath) {
  return [explicitPath, ...defaultPdfFontCandidates].filter(Boolean).find((candidate) => existsSync(candidate)) || null;
}

function pdfBuffer({ opportunity, document, versionNo, items }, fontPath) {
  return new Promise((resolve, reject) => {
    const pdfFont = resolvePdfFont(fontPath);
    if (!pdfFont) {
      reject(new Error('A CJK-capable PDF font is required; configure TECHNICAL_DOCUMENT_FONT_PATH'));
      return;
    }
    const chunks = [];
    const versionLabel = opportunityTechnicalDocumentVersionLabel(document.documentCode, versionNo);
    const kind = documentKind(document.documentType);
    const pdf = new PDFDocument({
      size: 'LETTER',
      margins: { top: 62, right: 54, bottom: 68, left: 54 },
      bufferPages: true,
      info: { Title: `${versionLabel} ${document.title}`, Author: 'SUNKAIER', Subject: kind }
    });
    pdf.on('data', (chunk) => chunks.push(chunk));
    pdf.on('error', reject);
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.registerFont('SUNKAIER-CJK', pdfFont).font('SUNKAIER-CJK');

    const left = 54;
    const width = 504;
    const pageBottom = () => pdf.page.height - 86;
    const ensureSpace = (height = 36) => {
      if (pdf.y + height > pageBottom()) pdf.addPage();
      pdf.x = left;
    };
    const writeHeading = (value, size = 15) => {
      ensureSpace(42);
      pdf.moveDown(0.55).fillColor(`#${NAVY}`).fontSize(size).text(text(value), left, pdf.y, { width, lineGap: 2 });
      pdf.fillColor('#1F2933').fontSize(10);
    };
    const writeText = (value, options = {}) => {
      if (!text(value)) return;
      const height = pdf.heightOfString(text(value), { width, lineGap: 3 }) + 9;
      ensureSpace(height);
      pdf.fillColor(options.color || '#1F2933').fontSize(options.size || 10).text(text(value), left, pdf.y, { width, lineGap: 3 });
      pdf.moveDown(0.25);
    };
    const writeRows = (rows) => {
      for (const [label, value] of rows) {
        writeText(`${text(label)}: ${text(value) || '-'}`, { size: 9.5 });
      }
      pdf.moveDown(0.35);
    };

    pdf.fillColor(`#${NAVY}`).fontSize(13).text('S', left, pdf.y, { continued: true });
    pdf.fillColor(`#${ORANGE}`).text('U', { continued: true });
    pdf.fillColor(`#${NAVY}`).text('NKAIER');
    pdf.moveTo(left, pdf.y + 4).lineTo(left + width, pdf.y + 4).strokeColor('#D7DBE2').stroke();
    pdf.moveDown(1.6).fontSize(23).fillColor(`#${NAVY}`).text(document.title, left, pdf.y, { width });
    pdf.fontSize(12).fillColor(`#${MUTED}`).text(kind, left, pdf.y, { width });
    pdf.moveDown(1);
    writeRows([
      ['Document No. / 文件编号', versionLabel],
      ['Opportunity / 商机', `${text(opportunity.opportunityNo)} - ${text(opportunity.title)}`],
      ['Customer / 客户', text(opportunity.customerName) || '-'],
      ['Equipment Count / 设备项数', String(items.length)]
    ]);

    for (const [itemIndex, item] of items.entries()) {
      if (itemIndex > 0) pdf.addPage();
      writeHeading(`${item.itemNo}. ${item.equipmentName}`, 18);
      writeRows(itemIdentityRows(item));
      writeHeading('Technical Parameters / 技术参数', 13);
      writeRows(parameterRows(item).slice(1));
      for (const section of (item.renderedContent?.sections || []).filter((candidate) => candidate.included !== false)) {
        writeHeading(`${section.labelEn || section.key}${section.labelZh ? ` / ${section.labelZh}` : ''}`, 13);
        writeText(section.bodyEn);
        writeText(section.bodyZh);
        for (const row of section.tableRows || []) writeText(row.map(text).join(' | '), { size: 9 });
        for (const clause of section.clauses || []) {
          writeText(`${clause.revisionLabel} · ${clause.title}`, { color: `#${NAVY}` });
          writeText(clause.content);
        }
      }
    }

    const range = pdf.bufferedPageRange();
    for (let index = range.start; index < range.start + range.count; index += 1) {
      pdf.switchToPage(index);
      pdf.font('SUNKAIER-CJK').fontSize(8).fillColor(`#${MUTED}`);
      const footerY = pdf.page.height - 72;
      pdf.text(`${versionLabel}  |  SUNKAIER`, left, footerY, { width: 320, lineBreak: false });
      pdf.text(`Page ${index + 1} of ${range.count}`, 374, footerY, { width: 184, align: 'right', lineBreak: false });
    }
    pdf.end();
  });
}

export function createTechnicalMaterialDocumentService(options = {}) {
  const createDocx = options.createDocx || (async (input) => Packer.toBuffer(docxDocument(input)));
  const createPdf = options.createPdf || (async (input) => pdfBuffer(input, options.fontPath));
  return {
    async generateVersionOne(input) {
      if (!input?.document?.documentCode || !technicalDocumentType(input.document.documentType)) {
        const error = new Error('Technical document identity is invalid');
        error.statusCode = 400;
        throw error;
      }
      if (!Array.isArray(input.items) || !input.items.length || Number(input.versionNo) !== 1) {
        const error = new Error('Initial technical document source is invalid');
        error.statusCode = 400;
        throw error;
      }
      const [docxContent, pdfContent] = await Promise.all([createDocx(input), createPdf(input)]);
      const fileBase = safeFilePart(opportunityTechnicalDocumentVersionLabel(input.document.documentCode, 1));
      return [
        {
          format: 'docx',
          originalName: `${fileBase}.docx`,
          mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          content: docxContent,
          byteSize: docxContent.length,
          sha256: checksum(docxContent)
        },
        {
          format: 'pdf',
          originalName: `${fileBase}.pdf`,
          mimeType: 'application/pdf',
          content: pdfContent,
          byteSize: pdfContent.length,
          sha256: checksum(pdfContent)
        }
      ];
    }
  };
}
