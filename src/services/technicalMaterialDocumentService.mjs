import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
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
  technicalContentLanguage,
  technicalDocumentTypeLabel,
  technicalDocumentType
} from '../domain/technicalTemplates.mjs';

const NAVY = '244C7C';
const ORANGE = 'F15A24';
const PALE_BLUE = 'EEF4FA';
const VERY_PALE_BLUE = 'F7FAFD';
const LIGHT_GRAY = 'F4F6F8';
const BORDER_GRAY = 'D9E0E8';
const MUTED = '5E6875';
const BODY = '1F2933';
const TABLE_WIDTH = 9360;
const DEFAULT_FONT = 'Arial';
const CJK_FONT = 'Microsoft YaHei';

const defaultPdfFontCandidates = [
  'C:\\Windows\\Fonts\\Deng.ttf',
  'C:\\Windows\\Fonts\\NotoSansSC-VF.ttf',
  'C:\\Windows\\Fonts\\simhei.ttf',
  'C:\\Windows\\Fonts\\simsunb.ttf',
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

export function technicalMaterialDocumentCopy(language) {
  if (technicalContentLanguage(language) === 'zh') {
    return {
      documentNo: '文件编号',
      opportunity: '商机',
      customer: '客户',
      equipmentCount: '设备项数',
      item: '项号',
      category: '产品分类',
      equipment: '设备',
      model: '型号',
      quantity: '数量',
      template: '模板',
      parameter: '参数',
      value: '数值',
      technicalParameters: '技术参数',
      documentInformation: '文件信息',
      equipmentOverview: '设备概览',
      equipmentDetails: '设备技术资料',
      page: '第',
      of: '页，共',
      pages: '页'
    };
  }
  return {
    documentNo: 'Document No.',
    opportunity: 'Opportunity',
    customer: 'Customer',
    equipmentCount: 'Equipment Count',
    item: 'Item',
    category: 'Category',
    equipment: 'Equipment',
    model: 'Model',
    quantity: 'Quantity',
    template: 'Template',
    parameter: 'Parameter',
    value: 'Value',
    technicalParameters: 'Technical Parameters',
    documentInformation: 'Document Information',
    equipmentOverview: 'Equipment Overview',
    equipmentDetails: 'Equipment Technical Data',
    page: 'Page',
    of: 'of',
    pages: ''
  };
}

function documentKind(documentType, language) {
  const label = technicalDocumentTypeLabel(documentType, language) || 'Technical Document';
  return technicalContentLanguage(language) === 'en' ? label.toUpperCase() : label;
}

function run(value, options = {}) {
  return new TextRun({
    text: String(value ?? ''),
    font: { name: DEFAULT_FONT, eastAsia: CJK_FONT },
    size: options.size || 21,
    bold: options.bold,
    color: options.color || BODY
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

function headingParagraph(value, level = HeadingLevel.HEADING_1, options = {}) {
  return new Paragraph({
    text: String(value ?? ''),
    heading: level,
    keepNext: true,
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

function footer(versionLabel, language) {
  const copy = technicalMaterialDocumentCopy(language);
  const pagePrefix = language === 'zh' ? `${copy.page} ` : `${copy.page} `;
  const pageMiddle = language === 'zh' ? ` ${copy.of} ` : ` ${copy.of} `;
  const pageSuffix = language === 'zh' ? ` ${copy.pages}` : '';
  return new Footer({
    children: [new Paragraph({
      border: { top: { style: BorderStyle.SINGLE, size: 4, color: 'D7DBE2' } },
      children: [
        run(`${versionLabel}  |  SUNKAIER  |  `, { size: 16, color: MUTED }),
        new TextRun({
          children: [pagePrefix, PageNumber.CURRENT, pageMiddle, PageNumber.TOTAL_PAGES, pageSuffix],
          font: DEFAULT_FONT,
          size: 16,
          color: MUTED
        })
      ]
    })]
  });
}

function tableBorders() {
  const border = { style: BorderStyle.SINGLE, size: 4, color: BORDER_GRAY };
  return { top: border, bottom: border, left: border, right: border, insideH: border, insideV: border };
}

function tableCell(value, width, options = {}) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    columnSpan: options.columnSpan > 1 ? options.columnSpan : undefined,
    verticalAlign: VerticalAlign.CENTER,
    margins: { top: 90, bottom: 90, left: 110, right: 110 },
    borders: tableBorders(),
    shading: options.fill ? { type: ShadingType.CLEAR, fill: options.fill, color: 'auto' } : undefined,
    children: [new Paragraph({
      alignment: options.alignment || AlignmentType.LEFT,
      spacing: { before: 0, after: 0, line: 230 },
      children: [run(value || '-', {
        bold: options.bold,
        size: options.size || 19,
        color: options.color || BODY
      })]
    })]
  });
}

function alignmentType(value, fallback = AlignmentType.LEFT) {
  if (value === 'center') return AlignmentType.CENTER;
  if (value === 'right') return AlignmentType.RIGHT;
  if (value === 'left') return AlignmentType.LEFT;
  return fallback;
}

function balancedTableWidths(columnCount, { labelColumn = false } = {}) {
  if (labelColumn && columnCount === 2) return [2520, TABLE_WIDTH - 2520];
  if (columnCount === 2) return [3480, TABLE_WIDTH - 3480];
  if (columnCount === 3) return [1660, 4460, TABLE_WIDTH - 6120];
  if (columnCount === 4) return [1100, 3860, 2400, TABLE_WIDTH - 7360];
  const baseWidth = Math.floor(TABLE_WIDTH / columnCount);
  return Array.from({ length: columnCount }, (_, index) => (
    index === columnCount - 1 ? TABLE_WIDTH - baseWidth * (columnCount - 1) : baseWidth
  ));
}

function percentageTableWidths(percentages, columnCount, totalWidth = TABLE_WIDTH) {
  if (!Array.isArray(percentages) || percentages.length !== columnCount) return null;
  const values = percentages.map(Number);
  const total = values.reduce((sum, value) => sum + value, 0);
  if (!total || values.some((value) => !Number.isFinite(value) || value <= 0)) return null;
  const widths = values.map((value) => Math.max(1, Math.round(totalWidth * value / total)));
  widths[widths.length - 1] += totalWidth - widths.reduce((sum, value) => sum + value, 0);
  return widths;
}

function tableMergeMaps(merges, rowCount, columnCount) {
  const starts = new Map();
  const covered = new Set();
  for (const merge of Array.isArray(merges) ? merges : []) {
    const row = Number(merge.row) - 1;
    const column = Number(merge.column) - 1;
    const span = Number(merge.span);
    if (!Number.isInteger(row) || row < 0 || row >= rowCount
        || !Number.isInteger(column) || column < 0 || column >= columnCount
        || !Number.isInteger(span) || span < 2 || column + span > columnCount) continue;
    const cells = Array.from({ length: span }, (_, index) => `${row}:${column + index}`);
    if (cells.some((key) => covered.has(key) || starts.has(key))) continue;
    starts.set(`${row}:${column}`, span);
    for (let index = 1; index < span; index += 1) covered.add(`${row}:${column + index}`);
  }
  return { starts, covered };
}

function fixedTable(rows, {
  headerRow = false,
  labelColumn = false,
  widths: configuredWidths = null,
  widthPercentages = null,
  columnAlignments = [],
  merges = []
} = {}) {
  const columnCount = Math.max(...rows.map((row) => row.length), 1);
  const widths = configuredWidths?.length === columnCount
    ? configuredWidths
    : percentageTableWidths(widthPercentages, columnCount)
      || balancedTableWidths(columnCount, { labelColumn });
  const { starts, covered } = tableMergeMaps(merges, rows.length, columnCount);
  return new Table({
    width: { size: TABLE_WIDTH, type: WidthType.DXA },
    layout: TableLayoutType.FIXED,
    columnWidths: widths,
    rows: rows.map((row, rowIndex) => new TableRow({
      tableHeader: headerRow && rowIndex === 0,
      cantSplit: true,
      children: Array.from({ length: columnCount }, (_, columnIndex) => columnIndex)
        .filter((columnIndex) => !covered.has(`${rowIndex}:${columnIndex}`))
        .map((columnIndex) => {
          const columnSpan = starts.get(`${rowIndex}:${columnIndex}`) || 1;
          const cellWidth = widths.slice(columnIndex, columnIndex + columnSpan).reduce((sum, value) => sum + value, 0);
          return tableCell(
            row[columnIndex],
            cellWidth,
            {
          columnSpan,
          bold: (headerRow && rowIndex === 0) || (labelColumn && columnIndex === 0),
          color: headerRow && rowIndex === 0 ? 'FFFFFF' : BODY,
          fill: headerRow && rowIndex === 0
            ? NAVY
            : labelColumn && columnIndex === 0
              ? PALE_BLUE
              : rowIndex > 0 && rowIndex % 2 === 0
                ? VERY_PALE_BLUE
                : undefined,
          alignment: alignmentType(
            columnAlignments[columnIndex],
            headerRow && rowIndex === 0 ? AlignmentType.CENTER : AlignmentType.LEFT
          )
            }
          );
        })
    }))
  });
}

function sectionImageBuffer(image) {
  if (!image || !['image/png', 'image/jpeg'].includes(image.mimeType) || !text(image.data)) return null;
  try {
    const buffer = Buffer.from(image.data, 'base64');
    return buffer.length ? buffer : null;
  } catch {
    return null;
  }
}

function rasterDimensions(buffer, mimeType) {
  if (mimeType === 'image/png' && buffer.length >= 24) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (mimeType === 'image/jpeg') {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) { offset += 1; continue; }
      const marker = buffer[offset + 1];
      const length = buffer.readUInt16BE(offset + 2);
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5) };
      }
      if (!Number.isInteger(length) || length < 2) break;
      offset += length + 2;
    }
  }
  return { width: 4, height: 3 };
}

function sectionImageDocxElements(section, activeSuffix) {
  const image = section?.layout?.image;
  const buffer = sectionImageBuffer(image);
  if (!buffer) return [];
  const dimensions = rasterDimensions(buffer, image.mimeType);
  const targetWidth = Math.max(120, Math.round(620 * Math.min(100, Math.max(20, Number(image.widthPercent) || 60)) / 100));
  const targetHeight = Math.max(40, Math.min(620, Math.round(targetWidth * dimensions.height / Math.max(1, dimensions.width))));
  const elements = [new Paragraph({
    alignment: alignmentType(image.alignment, AlignmentType.CENTER),
    spacing: { before: 80, after: 70 },
    children: [new ImageRun({
      data: buffer,
      type: image.mimeType === 'image/png' ? 'png' : 'jpg',
      transformation: { width: targetWidth, height: targetHeight }
    })]
  })];
  const caption = text(image[`caption${activeSuffix}`]);
  if (caption) elements.push(paragraph(caption, {
    size: 18,
    color: MUTED,
    alignment: alignmentType(image.alignment, AlignmentType.CENTER),
    after: 120
  }));
  return elements;
}

function itemIdentityRows(item, copy) {
  return [
    [copy.item, String(item.itemNo)],
    [copy.category, item.productCategoryName],
    [copy.equipment, item.equipmentName],
    [copy.model, item.model || '-'],
    [copy.quantity, String(item.quantity)],
    [copy.template, `${item.templateCode} · TPL-R${item.templateRevisionNo}`]
  ];
}

function parameterRows(item, language, copy) {
  const rows = [[copy.parameter, copy.value]];
  const renderedVariables = item.renderedContent?.variables || [];
  const variableKeys = new Set(renderedVariables.map((variable) => variable.variableKey));
  for (const variable of renderedVariables) {
    rows.push([
      text(language === 'zh' ? variable.labelZh : variable.labelEn) || variable.variableKey,
      text(variable.value) || '-'
    ]);
  }
  for (const parameter of item.technicalParameters || []) {
    if (variableKeys.has(parameter.key)) continue;
    rows.push([parameter.label ? `${parameter.label} (${parameter.key})` : parameter.key, text(parameter.value) || '-']);
  }
  return rows;
}

function equipmentOverviewRows(items, copy) {
  return [
    [copy.item, copy.equipment, copy.model, copy.quantity],
    ...items.map((item) => [
      String(item.itemNo),
      text(item.equipmentName) || '-',
      text(item.model) || '-',
      String(item.quantity)
    ])
  ];
}

function metadataRows({ opportunity, versionLabel, items, copy }) {
  return [
    [copy.documentNo, versionLabel],
    [copy.opportunity, `${text(opportunity.opportunityNo)} - ${text(opportunity.title)}`],
    [copy.customer, text(opportunity.customerName) || '-'],
    [copy.equipmentCount, String(items.length)]
  ];
}

function docxDocument({ opportunity, document, versionNo, items, language }) {
  const versionLabel = opportunityTechnicalDocumentVersionLabel(document.documentCode, versionNo);
  const kind = documentKind(document.documentType, language);
  const copy = technicalMaterialDocumentCopy(language);
  const activeSuffix = language === 'zh' ? 'Zh' : 'En';
  const formal = document.documentType !== 'datasheet';
  const children = [];

  if (formal) {
    children.push(paragraph('SUNKAIER', {
      size: 27,
      bold: true,
      color: NAVY,
      alignment: AlignmentType.CENTER,
      before: 1780,
      after: 520
    }));
    children.push(paragraph(document.title, {
      size: 42,
      bold: true,
      color: NAVY,
      alignment: AlignmentType.CENTER,
      after: 140
    }));
    children.push(paragraph(kind, {
      size: 26,
      color: MUTED,
      alignment: AlignmentType.CENTER,
      after: 820
    }));
    children.push(fixedTable(metadataRows({ opportunity, versionLabel, items, copy }), { labelColumn: true }));
    children.push(headingParagraph(copy.equipmentOverview, HeadingLevel.HEADING_1, { pageBreakBefore: true }));
    children.push(fixedTable(equipmentOverviewRows(items, copy), {
      headerRow: true,
      widths: [1050, 4310, 2400, 1600]
    }));
  } else {
    children.push(fixedTable([[document.title]], { headerRow: true, widths: [TABLE_WIDTH] }));
    children.push(paragraph(kind, { size: 23, bold: true, color: NAVY, after: 130 }));
    children.push(fixedTable(metadataRows({ opportunity, versionLabel, items, copy }), { labelColumn: true }));
  }

  for (const [itemIndex, item] of items.entries()) {
    children.push(headingParagraph(
      `${item.itemNo}. ${item.equipmentName}`,
      HeadingLevel.HEADING_1,
      { pageBreakBefore: itemIndex > 0 }
    ));
    children.push(fixedTable(itemIdentityRows(item, copy), { labelColumn: true }));
    children.push(headingParagraph(
      formal ? `${item.itemNo}.1 ${copy.technicalParameters}` : copy.technicalParameters,
      HeadingLevel.HEADING_2
    ));
    children.push(fixedTable(parameterRows(item, language, copy), { headerRow: true }));

    const visibleSections = (item.renderedContent?.sections || []).filter((candidate) => candidate.included !== false);
    for (const [sectionIndex, section] of visibleSections.entries()) {
      const sectionLabel = text(section[`label${activeSuffix}`]) || section.key;
      children.push(headingParagraph(
        formal ? `${item.itemNo}.${sectionIndex + 2} ${sectionLabel}` : sectionLabel,
        HeadingLevel.HEADING_2,
        { pageBreakBefore: Boolean(section.layout?.pageBreakBefore) }
      ));
      const body = section[`body${activeSuffix}`];
      if (text(body)) {
        for (const line of String(body).split(/\r?\n/).filter((value) => text(value))) children.push(paragraph(text(line)));
      }
      children.push(...sectionImageDocxElements(section, activeSuffix));
      const tableRows = section[`tableRows${activeSuffix}`] || [];
      if (Array.isArray(tableRows) && tableRows.length) {
        const tableLayout = section.layout?.table || {};
        children.push(fixedTable(tableRows.map((row) => row.map(text)), {
          headerRow: tableLayout.headerRow ?? tableRows.length > 1,
          widthPercentages: tableLayout.columnWidths,
          columnAlignments: tableLayout.columnAlignments,
          merges: tableLayout.merges
        }));
      }
      for (const clause of (section.clauses || []).filter((candidate) => candidate.language === language)) {
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
        { id: 'Heading1', name: 'Heading 1', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: { name: DEFAULT_FONT, eastAsia: CJK_FONT }, size: 30, bold: true, color: NAVY }, paragraph: { spacing: { before: 300, after: 150 }, keepNext: true, outlineLevel: 0 } },
        { id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { font: { name: DEFAULT_FONT, eastAsia: CJK_FONT }, size: 24, bold: true, color: NAVY }, paragraph: { spacing: { before: 220, after: 110 }, keepNext: true, outlineLevel: 1 } }
      ]
    },
    sections: [{
      properties: {
        titlePage: formal,
        page: {
          size: { width: 12240, height: 15840 },
          margin: { top: 1440, right: 1440, bottom: 1440, left: 1440, header: 708, footer: 708 }
        }
      },
      headers: {
        default: header(kind),
        first: new Header({ children: [new Paragraph('')] })
      },
      footers: {
        default: footer(versionLabel, language),
        first: new Footer({ children: [new Paragraph('')] })
      },
      children
    }]
  });
}

function resolvePdfFont(explicitPath) {
  return [explicitPath, ...defaultPdfFontCandidates].filter(Boolean).find((candidate) => existsSync(candidate)) || null;
}

function pdfBuffer({ opportunity, document, versionNo, items, language }, fontPath) {
  return new Promise((resolve, reject) => {
    const pdfFont = resolvePdfFont(fontPath);
    if (!pdfFont) {
      reject(new Error('A CJK-capable PDF font is required; configure TECHNICAL_DOCUMENT_FONT_PATH'));
      return;
    }
    const chunks = [];
    const versionLabel = opportunityTechnicalDocumentVersionLabel(document.documentCode, versionNo);
    const kind = documentKind(document.documentType, language);
    const copy = technicalMaterialDocumentCopy(language);
    const activeSuffix = language === 'zh' ? 'Zh' : 'En';
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
    const pageBottom = () => pdf.page.height - 92;
    const borderColor = `#${BORDER_GRAY}`;
    const formal = document.documentType !== 'datasheet';

    const drawRunningHeader = () => {
      const y = 30;
      pdf.font('SUNKAIER-CJK').fontSize(10.5).fillColor(`#${NAVY}`)
        .text('S', left, y, { continued: true, lineBreak: false });
      pdf.fillColor(`#${ORANGE}`).text('U', { continued: true, lineBreak: false });
      pdf.fillColor(`#${NAVY}`).text('NKAIER', { lineBreak: false });
      pdf.fontSize(8).fillColor(`#${MUTED}`).text(kind, left + 250, y + 1, {
        width: width - 250,
        align: 'right',
        lineBreak: false
      });
      pdf.moveTo(left, 51).lineTo(left + width, 51).lineWidth(0.7).strokeColor(borderColor).stroke();
      pdf.y = 67;
      pdf.x = left;
    };
    const addContentPage = () => {
      pdf.addPage();
      drawRunningHeader();
    };
    const ensureSpace = (height = 36) => {
      if (pdf.y + height > pageBottom()) addContentPage();
      pdf.x = left;
    };
    const writeHeading = (value, size = 15, options = {}) => {
      const headingText = text(value);
      pdf.font('SUNKAIER-CJK').fontSize(size);
      const headingHeight = pdf.heightOfString(headingText, { width: width - 14, lineGap: 2 }) + 18;
      ensureSpace(headingHeight + (options.keepWithNext || 0));
      const y = pdf.y + 7;
      pdf.rect(left, y + 1, 3.2, Math.max(size + 2, 14)).fill(`#${ORANGE}`);
      pdf.fillColor(`#${NAVY}`).fontSize(size).text(headingText, left + 12, y, { width: width - 12, lineGap: 2 });
      pdf.y += 4;
      pdf.fillColor(`#${BODY}`).fontSize(9.5);
    };
    const writeText = (value, options = {}) => {
      if (!text(value)) return;
      const textWidth = options.width || width;
      pdf.font('SUNKAIER-CJK').fontSize(options.size || 9.5);
      const height = pdf.heightOfString(text(value), { width: textWidth, lineGap: 3 }) + 9;
      ensureSpace(height);
      pdf.fillColor(options.color || `#${BODY}`).text(text(value), left, pdf.y, { width: textWidth, lineGap: 3 });
      pdf.moveDown(0.25);
    };

    const pdfTableWidths = (columnCount, { labelColumn = false } = {}) => {
      if (labelColumn && columnCount === 2) return [136, width - 136];
      if (columnCount === 2) return [190, width - 190];
      if (columnCount === 3) return [88, 238, width - 326];
      if (columnCount === 4) return [54, 232, 126, width - 412];
      if (columnCount === 5) return [46, 148, 126, 94, width - 414];
      const base = width / columnCount;
      return Array.from({ length: columnCount }, (_, index) => (
        index === columnCount - 1 ? width - base * (columnCount - 1) : base
      ));
    };
    const drawTable = (inputRows, options = {}) => {
      if (!Array.isArray(inputRows) || !inputRows.length) return;
      const rows = inputRows.map((row) => (Array.isArray(row) ? row.map((cell) => text(cell) || '-') : [text(row) || '-']));
      const columnCount = Math.max(...rows.map((row) => row.length), 1);
      const widths = options.widths?.length === columnCount
        ? options.widths
        : percentageTableWidths(options.widthPercentages, columnCount, width)
          || pdfTableWidths(columnCount, options);
      const { starts, covered } = tableMergeMaps(options.merges, rows.length, columnCount);
      const paddingX = 6;
      const paddingY = 5;
      const cellsForRow = (row, rowIndex) => Array.from({ length: columnCount }, (_, columnIndex) => columnIndex)
        .filter((columnIndex) => !covered.has(`${rowIndex}:${columnIndex}`))
        .map((columnIndex) => {
          const span = starts.get(`${rowIndex}:${columnIndex}`) || 1;
          return {
            columnIndex,
            span,
            value: row[columnIndex] || '-',
            width: widths.slice(columnIndex, columnIndex + span).reduce((sum, value) => sum + value, 0),
            x: left + widths.slice(0, columnIndex).reduce((sum, value) => sum + value, 0)
          };
        });
      const rowHeight = (row, rowIndex, isHeader) => {
        const fontSize = isHeader ? 8.6 : 8.4;
        pdf.font('SUNKAIER-CJK').fontSize(fontSize);
        return Math.max(24, ...cellsForRow(row, rowIndex).map((cell) => (
          pdf.heightOfString(cell.value, {
            width: cell.width - paddingX * 2,
            lineGap: 1.3
          }) + paddingY * 2
        )));
      };
      const drawRow = (row, rowIndex, isHeader) => {
        const height = rowHeight(row, rowIndex, isHeader);
        const y = pdf.y;
        for (const cell of cellsForRow(row, rowIndex)) {
          const { columnIndex } = cell;
          const fill = isHeader
            ? `#${NAVY}`
            : options.labelColumn && columnIndex === 0
              ? `#${PALE_BLUE}`
              : rowIndex % 2 === 0
                ? `#${VERY_PALE_BLUE}`
                : '#FFFFFF';
          pdf.save().lineWidth(0.55).rect(cell.x, y, cell.width, height).fillAndStroke(fill, borderColor).restore();
          pdf.font('SUNKAIER-CJK').fontSize(isHeader ? 8.6 : 8.4).fillColor(isHeader ? '#FFFFFF' : `#${BODY}`)
            .text(cell.value, cell.x + paddingX, y + paddingY, {
              width: cell.width - paddingX * 2,
              height: height - paddingY * 2,
              lineGap: 1.3,
              align: options.columnAlignments?.[columnIndex] || (isHeader ? 'center' : 'left')
            });
        }
        pdf.y = y + height;
        pdf.x = left;
      };

      const headerHeight = options.headerRow ? rowHeight(rows[0], 0, true) : 0;
      const firstDataIndex = options.headerRow ? 1 : 0;
      const firstDataHeight = rows[firstDataIndex] ? rowHeight(rows[firstDataIndex], firstDataIndex, false) : 0;
      if (pdf.y + headerHeight + firstDataHeight > pageBottom()) addContentPage();
      if (options.headerRow) drawRow(rows[0], 0, true);
      for (let rowIndex = firstDataIndex; rowIndex < rows.length; rowIndex += 1) {
        const height = rowHeight(rows[rowIndex], rowIndex, false);
        if (pdf.y + height > pageBottom()) {
          addContentPage();
          if (options.headerRow) drawRow(rows[0], 0, true);
        }
        drawRow(rows[rowIndex], rowIndex, false);
      }
      pdf.y += 8;
      pdf.x = left;
    };
    const drawSectionImage = (section) => {
      const image = section?.layout?.image;
      const buffer = sectionImageBuffer(image);
      if (!buffer) return;
      const dimensions = rasterDimensions(buffer, image.mimeType);
      let imageWidth = width * Math.min(100, Math.max(20, Number(image.widthPercent) || 60)) / 100;
      let imageHeight = imageWidth * dimensions.height / Math.max(1, dimensions.width);
      const maxHeight = pageBottom() - 72;
      if (imageHeight > maxHeight) {
        const scale = maxHeight / imageHeight;
        imageWidth *= scale;
        imageHeight *= scale;
      }
      const caption = text(image[`caption${activeSuffix}`]);
      ensureSpace(imageHeight + (caption ? 30 : 12));
      const imageX = image.alignment === 'left'
        ? left
        : image.alignment === 'right'
          ? left + width - imageWidth
          : left + (width - imageWidth) / 2;
      pdf.image(buffer, imageX, pdf.y, { width: imageWidth, height: imageHeight });
      pdf.y += imageHeight + 6;
      if (caption) {
        pdf.font('SUNKAIER-CJK').fontSize(8).fillColor(`#${MUTED}`).text(caption, left, pdf.y, {
          width,
          align: image.alignment || 'center',
          lineGap: 2
        });
        pdf.y += 6;
      }
      pdf.x = left;
    };

    drawRunningHeader();
    if (formal) {
      pdf.y = 154;
      pdf.font('SUNKAIER-CJK').fontSize(12).fillColor(`#${MUTED}`).text('SUNKAIER', left, pdf.y, {
        width,
        align: 'center',
        characterSpacing: 2
      });
      pdf.moveDown(1.4);
      pdf.fontSize(25).fillColor(`#${NAVY}`).text(document.title, left, pdf.y, {
        width,
        align: 'center',
        lineGap: 4
      });
      pdf.moveDown(0.65);
      pdf.fontSize(13).fillColor(`#${MUTED}`).text(kind, left, pdf.y, { width, align: 'center' });
      const accentY = pdf.y + 28;
      pdf.moveTo(left + 190, accentY).lineTo(left + 314, accentY).lineWidth(2).strokeColor(`#${ORANGE}`).stroke();
      pdf.y = 362;
      drawTable(metadataRows({ opportunity, versionLabel, items, copy }), { labelColumn: true });
      addContentPage();
      writeHeading(copy.equipmentOverview, 18, { keepWithNext: 90 });
      drawTable(equipmentOverviewRows(items, copy), {
        headerRow: true,
        widths: [54, 232, 126, 92]
      });
    } else {
      const titleText = text(document.title);
      pdf.font('SUNKAIER-CJK').fontSize(20);
      const titleHeight = Math.max(66, pdf.heightOfString(titleText, { width: width - 32, lineGap: 3 }) + 32);
      const titleY = pdf.y + 3;
      pdf.rect(left, titleY, width, titleHeight).fill(`#${NAVY}`);
      pdf.fillColor('#FFFFFF').fontSize(20).text(titleText, left + 16, titleY + 14, {
        width: width - 32,
        lineGap: 3
      });
      pdf.y = titleY + titleHeight + 10;
      pdf.fontSize(10).fillColor(`#${MUTED}`).text(kind, left, pdf.y, { width });
      pdf.y += 20;
      drawTable(metadataRows({ opportunity, versionLabel, items, copy }), { labelColumn: true });
    }

    for (const [itemIndex, item] of items.entries()) {
      if (itemIndex > 0) addContentPage();
      writeHeading(`${item.itemNo}. ${item.equipmentName}`, 18, { keepWithNext: 180 });
      drawTable(itemIdentityRows(item, copy), { labelColumn: true });
      writeHeading(formal ? `${item.itemNo}.1 ${copy.technicalParameters}` : copy.technicalParameters, 13, { keepWithNext: 72 });
      drawTable(parameterRows(item, language, copy), { headerRow: true });
      const visibleSections = (item.renderedContent?.sections || []).filter((candidate) => candidate.included !== false);
      for (const [sectionIndex, section] of visibleSections.entries()) {
        if (section.layout?.pageBreakBefore && pdf.y > 90) addContentPage();
        const sectionLabel = text(section[`label${activeSuffix}`]) || section.key;
        writeHeading(formal ? `${item.itemNo}.${sectionIndex + 2} ${sectionLabel}` : sectionLabel, 13, { keepWithNext: 48 });
        writeText(section[`body${activeSuffix}`]);
        drawSectionImage(section);
        const tableRows = section[`tableRows${activeSuffix}`] || [];
        if (Array.isArray(tableRows) && tableRows.length) {
          const tableLayout = section.layout?.table || {};
          drawTable(tableRows, {
            headerRow: tableLayout.headerRow ?? tableRows.length > 1,
            widthPercentages: tableLayout.columnWidths,
            columnAlignments: tableLayout.columnAlignments,
            merges: tableLayout.merges
          });
        }
        for (const clause of (section.clauses || []).filter((candidate) => candidate.language === language)) {
          writeText(`${clause.revisionLabel} · ${clause.title}`, { color: `#${NAVY}` });
          writeText(clause.content);
        }
      }
    }

    const range = pdf.bufferedPageRange();
    for (let index = range.start; index < range.start + range.count; index += 1) {
      pdf.switchToPage(index);
      pdf.font('SUNKAIER-CJK').fontSize(8).fillColor(`#${MUTED}`);
      const footerY = pdf.page.height - 82;
      pdf.moveTo(left, footerY - 9).lineTo(left + width, footerY - 9).lineWidth(0.55).strokeColor(borderColor).stroke();
      pdf.text(`${versionLabel}  |  SUNKAIER`, left, footerY, { width: 320, lineBreak: false });
      const pageLabel = language === 'zh'
        ? `${copy.page} ${index + 1} ${copy.of} ${range.count} ${copy.pages}`
        : `${copy.page} ${index + 1} ${copy.of} ${range.count}`;
      pdf.text(pageLabel, 374, footerY, { width: 184, align: 'right', lineBreak: false });
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
      if (!['en', 'zh'].includes(input.language)) {
        const error = new Error('Technical document language must match the login language');
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
