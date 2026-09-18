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

const NAVY = '244C7C';
const ORANGE = 'F15A24';
const PALE_BLUE = 'E8EEF5';
const LIGHT_GRAY = 'F2F4F7';
const MUTED = '5E6875';
const TABLE_WIDTH = 9360;
const DEFAULT_FONT = 'Arial';
const CJK_FONT = 'Microsoft YaHei';

const defaultPdfFontCandidates = [
  'C:\\Windows\\Fonts\\Deng.ttf',
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
  if (!['en', 'zh'].includes(draft.language)) {
    const error = new Error('Approved technical solution language must be English or Chinese');
    error.statusCode = 409;
    throw error;
  }
}

function localizedValues(language, valueEn, valueZh) {
  if (language === 'en') return [text(valueEn)];
  return [text(valueZh)];
}

function documentCopy(language) {
  if (language === 'zh') {
    return {
      technicalSolution: '技术方案',
      documentNo: '文档编号', opportunity: '商机', template: '模板',
      approvedBy: '批准人', approvedOn: '批准日期',
      projectVariables: '项目参数', parameter: '参数', value: '数值',
      yes: '是', no: '否', standardClauses: '标准条款',
      approvalRecord: '审批记录', status: '状态', approved: '已批准',
      submittedBy: '提交人', submittedOn: '提交日期', reviewComment: '审批意见',
      page: '第', of: '页，共', pages: '页',
      subject: '已批准技术方案'
    };
  }
  return {
    technicalSolution: 'Technical Solution',
    documentNo: 'Document No.', opportunity: 'Opportunity', template: 'Template',
    approvedBy: 'Approved by', approvedOn: 'Approved on',
    projectVariables: 'Project Variables', parameter: 'Parameter', value: 'Value',
    yes: 'Yes', no: 'No', standardClauses: 'Standard Clauses',
    approvalRecord: 'Approval Record', status: 'Status', approved: 'APPROVED',
    submittedBy: 'Submitted by', submittedOn: 'Submitted on', reviewComment: 'Review comment',
    page: 'Page', of: 'of', pages: '',
    subject: 'Approved Technical Solution'
  };
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
    keepNext: options.keepNext,
    pageBreakBefore: options.pageBreakBefore
  });
}

function alignmentType(value, fallback = AlignmentType.LEFT) {
  if (value === 'center') return AlignmentType.CENTER;
  if (value === 'right') return AlignmentType.RIGHT;
  if (value === 'left') return AlignmentType.LEFT;
  return fallback;
}

function brandedHeader(language) {
  const copy = documentCopy(language);
  return new Header({
    children: [new Paragraph({
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: 'D7DBE2' } },
      spacing: { after: 80 },
      children: [
        bodyRun('S', { size: 22, bold: true, color: NAVY }),
        bodyRun('U', { size: 22, bold: true, color: ORANGE }),
        bodyRun('NKAIER', { size: 22, bold: true, color: NAVY }),
        bodyRun(`  |  ${language === 'en' ? copy.technicalSolution.toUpperCase() : copy.technicalSolution}`, { size: 18, color: MUTED })
      ]
    })]
  });
}

function brandedFooter(documentNumber, language) {
  const copy = documentCopy(language);
  return new Footer({
    children: [new Paragraph({
      border: { top: { style: BorderStyle.SINGLE, size: 4, color: 'D7DBE2' } },
      spacing: { before: 80 },
      children: [
        bodyRun(`${documentNumber}  |  SUNKAIER  |  `, { size: 17, color: MUTED }),
        new TextRun({
          children: [`${copy.page} `, PageNumber.CURRENT, ` ${copy.of} `, PageNumber.TOTAL_PAGES, language === 'zh' ? ` ${copy.pages}` : ''],
          font: DEFAULT_FONT,
          size: 17,
          color: MUTED
        })
      ]
    })]
  });
}

function cell(value, width, options = {}) {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    columnSpan: options.columnSpan > 1 ? options.columnSpan : undefined,
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

function fixedTable(rows, widths, options = {}) {
  const columnCount = widths.length;
  const { starts, covered } = tableMergeMaps(options.merges, rows.length, columnCount);
  return new Table({
    width: { size: TABLE_WIDTH, type: WidthType.DXA },
    layout: TableLayoutType.FIXED,
    columnWidths: widths,
    indent: { size: 120, type: WidthType.DXA },
    rows: rows.map((row, rowIndex) => new TableRow({
      tableHeader: Boolean(options.header && rowIndex === 0),
      cantSplit: true,
      children: Array.from({ length: columnCount }, (_, columnIndex) => columnIndex)
        .filter((columnIndex) => !covered.has(`${rowIndex}:${columnIndex}`))
        .map((columnIndex) => {
          const columnSpan = starts.get(`${rowIndex}:${columnIndex}`) || 1;
          return cell(
            row[columnIndex],
            widths.slice(columnIndex, columnIndex + columnSpan).reduce((sum, value) => sum + value, 0),
            {
              columnSpan,
              bold: Boolean(options.header && rowIndex === 0) || (options.labelColumn && columnIndex === 0),
              fill: options.header && rowIndex === 0 ? PALE_BLUE : options.labelColumn && columnIndex === 0 ? LIGHT_GRAY : undefined,
              alignment: alignmentType(
                options.columnAlignments?.[columnIndex],
                options.centerColumns?.includes(columnIndex) ? AlignmentType.CENTER : AlignmentType.LEFT
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
  if (caption) elements.push(bodyParagraph(caption, {
    size: 18,
    color: MUTED,
    alignment: alignmentType(image.alignment, AlignmentType.CENTER)
  }));
  return elements;
}

function metadataRows(draft, opportunity, reviewer) {
  const copy = documentCopy(draft.language);
  return [
    [copy.documentNo, documentNo(draft)],
    [copy.opportunity, `${text(opportunity.opportunityNo)} - ${text(opportunity.title)}`],
    [copy.template, `${text(draft.templateCodeSnapshot)} - ${text(draft.templateNameSnapshot)} - TPL-R${draft.templateRevisionNoSnapshot}`],
    [copy.approvedBy, text(reviewer?.displayName || draft.reviewerDisplayName || reviewer?.username) || '-'],
    [copy.approvedOn, dateText(draft.reviewedAt)]
  ];
}

function sectionParagraphs(section, language) {
  const paragraphs = [];
  const bodies = localizedValues(language, section.bodyEn, section.bodyZh);
  for (const [index, value] of bodies.entries()) {
    if (!value) continue;
    for (const line of value.split(/\r?\n/)) {
      if (line.trim()) paragraphs.push(bodyParagraph(line.trim()));
    }
  }
  return paragraphs;
}

function buildDocx(draft, opportunity, reviewer) {
  const number = documentNo(draft);
  const copy = documentCopy(draft.language);
  const activeSuffix = draft.language === 'zh' ? 'Zh' : 'En';
  const children = [
    bodyParagraph('SUNKAIER', { size: 24, bold: true, color: NAVY, after: 60 }),
    bodyParagraph(draft.templateNameSnapshot, { size: 38, bold: true, color: NAVY, after: 80 }),
    bodyParagraph(copy.technicalSolution, { size: 26, color: MUTED, after: 280 }),
    fixedTable(metadataRows(draft, opportunity, reviewer), [2700, 6660], { labelColumn: true }),
    bodyParagraph('', { after: 80 }),
    new Paragraph({ text: copy.projectVariables, heading: HeadingLevel.HEADING_1, keepNext: true })
  ];

  const variableRows = [[copy.parameter, copy.value]];
  for (const variable of draft.renderedContent?.variables || []) {
    const label = draft.language === 'en'
      ? variable.labelEn
      : draft.language === 'zh'
        ? variable.labelZh
        : variable.labelZh;
    variableRows.push([label || variable.variableKey, variable.value === true ? copy.yes : variable.value === false ? copy.no : text(variable.value) || '-']);
  }
  children.push(fixedTable(variableRows, [3600, 5760], { header: true }));

  for (const section of (draft.renderedContent?.sections || []).filter((item) => item.included !== false)) {
    const heading = draft.language === 'en'
      ? section.labelEn
      : draft.language === 'zh'
        ? section.labelZh
        : section.labelZh;
    children.push(new Paragraph({
      text: heading || section.key,
      heading: HeadingLevel.HEADING_1,
      keepNext: true,
      pageBreakBefore: Boolean(section.layout?.pageBreakBefore)
    }));
    children.push(...sectionParagraphs(section, draft.language));
    children.push(...sectionImageDocxElements(section, activeSuffix));
    const tableRows = section[`tableRows${activeSuffix}`] || [];
    if (Array.isArray(tableRows) && tableRows.length) {
      const columnCount = Math.max(...tableRows.map((row) => row.length), 1);
      const baseWidth = Math.floor(TABLE_WIDTH / columnCount);
      const tableLayout = section.layout?.table || {};
      const widths = percentageTableWidths(tableLayout.columnWidths, columnCount)
        || Array.from({ length: columnCount }, (_, index) => index === columnCount - 1 ? TABLE_WIDTH - baseWidth * (columnCount - 1) : baseWidth);
      const rows = tableRows.map((row) => Array.from({ length: columnCount }, (_, index) => text(row[index])));
      children.push(fixedTable(rows, widths, {
        header: tableLayout.headerRow ?? rows.length > 1,
        columnAlignments: tableLayout.columnAlignments,
        merges: tableLayout.merges
      }));
    }
    const clauses = (section.clauses || []).filter((clause) => clause.language === draft.language);
    if (clauses.length) {
      children.push(new Paragraph({ text: copy.standardClauses, heading: HeadingLevel.HEADING_2, keepNext: true }));
      for (const clause of clauses) {
        children.push(bodyParagraph(`${clause.revisionLabel} - ${clause.title}`, { bold: true, color: NAVY, after: 40, keepNext: true }));
        children.push(bodyParagraph(clause.content));
      }
    }
  }

  children.push(new Paragraph({
    text: copy.approvalRecord,
    heading: HeadingLevel.HEADING_1,
    keepNext: true,
    pageBreakBefore: true
  }));
  children.push(fixedTable([
    [copy.status, copy.approved],
    [copy.submittedBy, text(draft.submitterDisplayName) || String(draft.submittedBy || '-')],
    [copy.submittedOn, dateText(draft.submittedAt)],
    [copy.approvedBy, text(reviewer?.displayName || draft.reviewerDisplayName) || String(draft.reviewedBy || '-')],
    [copy.approvedOn, dateText(draft.reviewedAt)],
    [copy.reviewComment, text(draft.reviewComment) || '-']
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
      headers: { default: brandedHeader(draft.language) },
      footers: { default: brandedFooter(number, draft.language) },
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
    const copy = documentCopy(draft.language);
    const activeSuffix = draft.language === 'zh' ? 'Zh' : 'En';
    const doc = new PDFDocument({ size: 'LETTER', margins: { top: 62, right: 54, bottom: 62, left: 54 }, bufferPages: true, info: { Title: `${documentNo(draft)} ${draft.templateNameSnapshot}`, Author: 'SUNKAIER', Subject: copy.subject } });
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
    const gridRows = (rows, options = {}) => {
      if (!rows.length) return;
      const x = left;
      const cols = Math.max(...rows.map((row) => row.length), 1);
      const widths = percentageTableWidths(options.widthPercentages, cols, contentWidth)
        || Array.from({ length: cols }, () => contentWidth / cols);
      widths[widths.length - 1] += contentWidth - widths.reduce((sum, value) => sum + value, 0);
      const { starts, covered } = tableMergeMaps(options.merges, rows.length, cols);
      const cellsForRow = (row, rowIndex) => Array.from({ length: cols }, (_, columnIndex) => columnIndex)
        .filter((columnIndex) => !covered.has(`${rowIndex}:${columnIndex}`))
        .map((columnIndex) => {
          const span = starts.get(`${rowIndex}:${columnIndex}`) || 1;
          return {
            columnIndex,
            value: text(row[columnIndex]) || ' ',
            width: widths.slice(columnIndex, columnIndex + span).reduce((sum, value) => sum + value, 0),
            x: x + widths.slice(0, columnIndex).reduce((sum, value) => sum + value, 0)
          };
        });
      const rowHeight = (row, rowIndex) => Math.max(...cellsForRow(row, rowIndex)
        .map((cell) => doc.heightOfString(cell.value, { width: cell.width - 12, lineGap: 2 }))) + 12;
      const drawRow = (row, rowIndex, isHeader) => {
        const height = rowHeight(row, rowIndex);
        const rowY = doc.y;
        for (const cell of cellsForRow(row, rowIndex)) {
          doc.rect(cell.x, rowY, cell.width, height).fill(isHeader ? '#E8EEF5' : '#FFFFFF').stroke('#CBD3DC');
          doc.fillColor(isHeader ? `#${NAVY}` : '#1F2933').fontSize(9).text(cell.value, cell.x + 6, rowY + 6, {
            width: cell.width - 12,
            lineGap: 2,
            align: options.columnAlignments?.[cell.columnIndex] || 'left'
          });
        }
        doc.y = rowY + height;
        doc.x = left;
      };
      const headerRow = Boolean(options.headerRow);
      const firstDataIndex = headerRow ? 1 : 0;
      const initialHeight = (headerRow ? rowHeight(rows[0], 0) : 0)
        + (rows[firstDataIndex] ? rowHeight(rows[firstDataIndex], firstDataIndex) : 0);
      ensureSpace(initialHeight);
      if (headerRow) drawRow(rows[0], 0, true);
      for (let rowIndex = firstDataIndex; rowIndex < rows.length; rowIndex += 1) {
        const height = rowHeight(rows[rowIndex], rowIndex);
        if (doc.y + height > pageBottom()) {
          doc.addPage();
          if (headerRow) drawRow(rows[0], 0, true);
        }
        drawRow(rows[rowIndex], rowIndex, false);
      }
      doc.moveDown(0.6);
      doc.x = left;
    };
    const drawSectionImage = (section) => {
      const image = section?.layout?.image;
      const buffer = sectionImageBuffer(image);
      if (!buffer) return;
      const dimensions = rasterDimensions(buffer, image.mimeType);
      let imageWidth = contentWidth * Math.min(100, Math.max(20, Number(image.widthPercent) || 60)) / 100;
      let imageHeight = imageWidth * dimensions.height / Math.max(1, dimensions.width);
      const maxHeight = pageBottom() - 72;
      if (imageHeight > maxHeight) {
        const scale = maxHeight / imageHeight;
        imageWidth *= scale;
        imageHeight *= scale;
      }
      const caption = text(image[`caption${activeSuffix}`]);
      ensureSpace(imageHeight + (caption ? 32 : 12));
      const imageX = image.alignment === 'left'
        ? left
        : image.alignment === 'right'
          ? left + contentWidth - imageWidth
          : left + (contentWidth - imageWidth) / 2;
      doc.image(buffer, imageX, doc.y, { width: imageWidth, height: imageHeight });
      doc.y += imageHeight + 6;
      if (caption) {
        doc.font('SUNKAIER-CJK').fillColor(`#${MUTED}`).fontSize(8).text(caption, left, doc.y, {
          width: contentWidth,
          align: image.alignment || 'center',
          lineGap: 2
        });
        doc.y += 6;
      }
      doc.x = left;
    };

    doc.fillColor(`#${NAVY}`).fontSize(13).text('S', left, doc.y, { continued: true });
    doc.fillColor(`#${ORANGE}`).text('U', { continued: true });
    doc.fillColor(`#${NAVY}`).text('NKAIER');
    doc.moveTo(54, doc.y + 4).lineTo(558, doc.y + 4).strokeColor('#D7DBE2').stroke();
    doc.moveDown(1.7).fillColor(`#${NAVY}`).fontSize(24).text(draft.templateNameSnapshot, left, doc.y, { width: contentWidth, lineGap: 3 });
    doc.fillColor(`#${MUTED}`).fontSize(14).text(copy.technicalSolution, left, doc.y, { width: contentWidth });
    doc.moveDown(1.2);
    keyValueRows(metadataRows(draft, opportunity, reviewer));

    heading(copy.projectVariables);
    gridRows([[copy.parameter, copy.value], ...(draft.renderedContent?.variables || []).map((variable) => {
      const label = draft.language === 'en' ? variable.labelEn : variable.labelZh;
      const value = variable.value === true ? copy.yes : variable.value === false ? copy.no : text(variable.value) || '-';
      return [label || variable.variableKey, value];
    })], { headerRow: true });

    for (const section of (draft.renderedContent?.sections || []).filter((item) => item.included !== false)) {
      if (section.layout?.pageBreakBefore && doc.y > 80) doc.addPage();
      const title = draft.language === 'en' ? section.labelEn : section.labelZh;
      heading(title || section.key);
      const bodies = localizedValues(draft.language, section.bodyEn, section.bodyZh);
      for (const value of bodies) {
        paragraph(value);
      }
      drawSectionImage(section);
      const tableRows = section[`tableRows${activeSuffix}`] || [];
      const tableLayout = section.layout?.table || {};
      gridRows(tableRows, {
        headerRow: tableLayout.headerRow ?? tableRows.length > 1,
        widthPercentages: tableLayout.columnWidths,
        columnAlignments: tableLayout.columnAlignments,
        merges: tableLayout.merges
      });
      const clauses = (section.clauses || []).filter((clause) => clause.language === draft.language);
      if (clauses.length) {
        paragraph(copy.standardClauses, { color: `#${NAVY}`, size: 11 });
        for (const clause of clauses) {
          paragraph(`${clause.revisionLabel} - ${clause.title}`, { color: `#${NAVY}` });
          paragraph(clause.content);
        }
      }
    }

    heading(copy.approvalRecord);
    keyValueRows([
      [copy.status, copy.approved],
      [copy.submittedBy, text(draft.submitterDisplayName) || String(draft.submittedBy || '-')],
      [copy.submittedOn, dateText(draft.submittedAt)],
      [copy.approvedBy, text(reviewer?.displayName || draft.reviewerDisplayName) || String(draft.reviewedBy || '-')],
      [copy.approvedOn, dateText(draft.reviewedAt)],
      [copy.reviewComment, text(draft.reviewComment) || '-']
    ]);

    const range = doc.bufferedPageRange();
    for (let index = range.start; index < range.start + range.count; index += 1) {
      doc.switchToPage(index);
      doc.font('SUNKAIER-CJK').fontSize(8).fillColor(`#${MUTED}`);
      const footerY = doc.page.height - 74;
      doc.text(`${documentNo(draft)}  |  SUNKAIER`, left, footerY, { width: 300, lineBreak: false });
      const pageLabel = draft.language === 'zh'
        ? `${copy.page} ${index + 1} ${copy.of} ${range.count} ${copy.pages}`
        : `${copy.page} ${index + 1} ${copy.of} ${range.count}`;
      doc.text(pageLabel, 358, footerY, { width: 200, align: 'right', lineBreak: false });
    }
    doc.end();
  });
}

export function createTechnicalDocumentService(options = {}) {
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
    }
  };
}
