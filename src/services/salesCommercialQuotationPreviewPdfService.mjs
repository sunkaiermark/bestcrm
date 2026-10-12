import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';
import { QUOTATION_COMMERCIAL_TERM_SECTIONS } from '../domain/quotationCommercialTermSections.mjs';
import { calculateQuotationTotals } from '../domain/quotationMoney.mjs';
import {
  registerSalesCommercialQuotationPdfFonts,
  resolveSalesCommercialQuotationPdfFonts
} from './salesCommercialQuotationPdfFonts.mjs';
const NAVY = '#244C7C';
const TEXT = '#23313F';
const MUTED = '#627486';
const RULE = '#D7E1E9';
const SOFT = '#F7F9FB';
const LOGO_PATH = fileURLToPath(new URL('../public/assets/sunkaier-logo-login.png', import.meta.url));
const HANGUL = /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/;

function printable(value) { return String(value ?? '').trim() || '—'; }

function scaledDecimal(value, decimalPlaces) {
  const raw = String(value ?? '').trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(raw)) return null;
  const [whole, fraction = ''] = raw.split('.');
  if (fraction.length > decimalPlaces) return null;
  return BigInt(whole) * 10n ** BigInt(decimalPlaces)
    + BigInt((fraction + '0'.repeat(decimalPlaces)).slice(0, decimalPlaces) || '0');
}

function amountCents(row) {
  const quantity = scaledDecimal(row.quantity, 4);
  const unitPrice = scaledDecimal(row.unitPrice, 2);
  if (quantity === null || unitPrice === null) return null;
  return (quantity * unitPrice + 5000n) / 10000n;
}

function money(value) {
  if (value === null) return '—';
  const digits = (value / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${digits}.${(value % 100n).toString().padStart(2, '0')}`;
}

export async function renderSalesCommercialQuotationPreviewPdf({
  draft, opportunity, sellerProfile = null, fontPath = ''
}) {
  if (!draft || !opportunity || Number(draft.opportunityId) !== Number(opportunity.id)) {
    const error = new Error('An existing quotation draft for this opportunity is required');
    error.statusCode = 404;
    throw error;
  }
  const fonts = resolveSalesCommercialQuotationPdfFonts(fontPath);
  if (!fonts) {
    const error = new Error('A CJK-capable PDF font is required for quotation preview');
    error.statusCode = 503;
    throw error;
  }
  const zh = draft.language === 'zh';
  const document = new PDFDocument({
    size: 'A4', margins: { top: 94, right: 43, bottom: 30, left: 43 },
    bufferPages: true, autoFirstPage: false,
    info: { Title: `INTERNAL DRAFT QUOTATION ${printable(opportunity.opportunityNo)}`, Author: 'SUNKAIER' }
  });
  registerSalesCommercialQuotationPdfFonts(document, fonts);
  document.font('quotation');
  const chunks = [];
  const completed = new Promise((resolve, reject) => {
    document.on('data', (chunk) => chunks.push(chunk));
    document.on('error', reject);
    document.on('end', () => resolve(Buffer.concat(chunks)));
  });
  const x = 43;
  const width = 509;
  const bottom = () => document.page.height - 67;

  function textFont(value) {
    document.font(HANGUL.test(String(value ?? '')) ? 'quotation-korean' : 'quotation');
    return document;
  }

  function page() {
    document.addPage();
    document.save();
    document.image(LOGO_PATH, x, 27, { fit: [152, 34] });
    document.fillColor(TEXT).fontSize(14).text('QUOTATION', x + 315, 36, { width: 194, align: 'right' });
    document.moveTo(x, 68).lineTo(x + width, 68).strokeColor('#0D7A79').lineWidth(1).stroke();
    document.fillColor('#AD3434').fontSize(9).text(
      zh ? '内部草稿 · 未批准 · 未签署 · 不得对客发送' : 'INTERNAL DRAFT · NOT APPROVED · NOT SIGNED · DO NOT SEND',
      x, 77, { width, align: 'center' }
    );
    document.restore();
    document.font('quotation').fontSize(9).fillColor(TEXT);
    document.x = x;
    document.y = 94;
  }

  function ensure(height) {
    if (document.y + height > bottom()) page();
  }

  function anchorNearFooter(height, gap = 7) {
    const targetY = bottom() - gap - height;
    if (document.y < targetY) {
      document.y = targetY;
      document.x = x;
    }
  }

  function heading(label) {
    ensure(23);
    const y = document.y + 6;
    document.fillColor(NAVY).fontSize(10).text(label, x, y, { width });
    document.y = y + 15;
    document.x = x;
  }

  function infoGrid(items, { gap = 0, minHeight = 24 } = {}) {
    const cellWidth = (width - gap * (items.length - 1)) / items.length;
    const height = minHeight;
    ensure(height);
    const y = document.y;
    items.forEach((item, index) => {
      const cellX = x + index * (cellWidth + gap);
      document.rect(cellX, y, cellWidth, height).fillAndStroke(SOFT, RULE);
      textFont(item.label).fontSize(6.5);
      const labelWidth = Math.min(cellWidth * 0.53, document.widthOfString(item.label) + 5);
      document.fillColor(MUTED).text(item.label, cellX + 6, y + 8, { width: labelWidth - 2, lineBreak: false });
      textFont(item.value).fillColor(TEXT).fontSize(8).text(printable(item.value), cellX + 6 + labelWidth, y + 7,
        { width: cellWidth - labelWidth - 12, lineBreak: false });
    });
    document.y = y + height;
    document.x = x;
  }

  function partyRowHeight(row, cardWidth, labelWidth) {
    if (!row) return 21;
    textFont(row.label).fontSize(8);
    const labelHeight = document.heightOfString(row.label, { width: labelWidth - 10 });
    textFont(row.value).fontSize(8);
    const valueHeight = document.heightOfString(printable(row.value), { width: cardWidth - labelWidth - 10 });
    return Math.max(21, labelHeight + 8, valueHeight + 8);
  }

  function partyMetrics(leftRows, rightRows, cardWidth) {
    const labelWidth = 62;
    const rowCount = Math.max(leftRows.length, rightRows.length);
    const rowHeights = Array.from({ length: rowCount }, (_, index) => Math.max(
      partyRowHeight(leftRows[index], cardWidth, labelWidth),
      partyRowHeight(rightRows[index], cardWidth, labelWidth)
    ));
    return { labelWidth, rowHeights, height: 21 + rowHeights.reduce((sum, value) => sum + value, 0) };
  }

  function drawPartyCard({ title, rows, cardX, cardWidth, y, metrics }) {
    document.rect(cardX, y, cardWidth, 21).fillAndStroke('#E9F1F7', RULE);
    textFont(title).fillColor(NAVY).fontSize(8.5).text(title, cardX + 7, y + 6, { width: cardWidth - 14 });
    let rowY = y + 21;
    metrics.rowHeights.forEach((rowHeight, index) => {
      const row = rows[index];
      document.rect(cardX, rowY, metrics.labelWidth, rowHeight).fillAndStroke('#EEF3F7', RULE);
      document.rect(cardX + metrics.labelWidth, rowY, cardWidth - metrics.labelWidth, rowHeight)
        .fillAndStroke('#FFFFFF', RULE);
      if (row) {
        textFont(row.label).fillColor(MUTED).fontSize(7.5).text(row.label, cardX + 5, rowY + 5,
          { width: metrics.labelWidth - 10 });
        textFont(row.value).fillColor(TEXT).fontSize(8).text(printable(row.value), cardX + metrics.labelWidth + 5, rowY + 5,
          { width: cardWidth - metrics.labelWidth - 10 });
      }
      rowY += rowHeight;
    });
  }

  function partyColumns(left, right) {
    const gap = 10;
    const cardWidth = (width - gap) / 2;
    const metrics = partyMetrics(left.rows, right.rows, cardWidth);
    ensure(metrics.height);
    const y = document.y;
    drawPartyCard({ ...left, cardX: x, cardWidth, y, metrics });
    drawPartyCard({ ...right, cardX: x + cardWidth + gap, cardWidth, y, metrics });
    document.y = y + metrics.height;
    document.x = x;
  }

  function compactRow(label, value) {
    const labelWidth = 62;
    textFont(label).fontSize(8);
    const labelHeight = document.heightOfString(label, { width: labelWidth - 10 });
    textFont(value).fontSize(8);
    const height = Math.max(22,
      labelHeight + 10,
      document.heightOfString(printable(value), { width: width - labelWidth - 10 }) + 10);
    ensure(height);
    const y = document.y;
    document.rect(x, y, labelWidth, height).fillAndStroke('#EEF3F7', RULE);
    document.rect(x + labelWidth, y, width - labelWidth, height).fillAndStroke('#FFFFFF', RULE);
    textFont(label).fillColor(MUTED).fontSize(7.5).text(label, x + 5, y + 6, { width: labelWidth - 10 });
    textFont(value).fillColor(TEXT).fontSize(8).text(printable(value), x + labelWidth + 5, y + 6,
      { width: width - labelWidth - 10 });
    document.y = y + height;
    document.x = x;
  }

  function lineTableHeader() {
    ensure(23);
    const labels = zh
      ? ['序号', '产品说明', '数量', '单位', '单价', '金额']
      : ['No.', 'Description', 'Qty', 'Unit', 'Unit price', 'Amount'];
    const widths = [36, 223, 50, 52, 74, 74];
    const alignments = ['center', 'left', 'center', 'center', 'right', 'right'];
    const y = document.y;
    document.rect(x, y, width, 22).fill('#E9F1F7');
    let cursor = x;
    labels.forEach((label, index) => {
      textFont(label).fillColor(NAVY).fontSize(8).text(label, cursor + 4, y + 5,
        { width: widths[index] - 8, align: alignments[index] });
      cursor += widths[index];
    });
    document.y = y + 22;
    document.x = x;
    return widths;
  }

  function lineRow(row, index, widths, reserveAfter = 0) {
    const alignments = ['center', 'left', 'center', 'center', 'right', 'right'];
    const cells = [String(index + 1), printable(row.description), printable(row.quantity),
      printable(row.unit), money(scaledDecimal(row.unitPrice, 2)), money(amountCents(row))];
    const height = Math.max(26, ...cells.map((cell, column) => {
      textFont(cell).fontSize(8);
      return document.heightOfString(cell, { width: widths[column] - 8 }) + 10;
    }));
    if (height > bottom() - 114 - 25) {
      const error = new Error(`Quotation row ${index + 1} is too long to fit on one A4 page`);
      error.statusCode = 409;
      throw error;
    }
    if (document.y + height + reserveAfter > bottom()) {
      page();
      lineTableHeader();
    }
    const y = document.y;
    let cursor = x;
    cells.forEach((cell, column) => {
      document.rect(cursor, y, widths[column], height).strokeColor(RULE).lineWidth(0.5).stroke();
      textFont(cell).fillColor(TEXT).fontSize(8).text(cell, cursor + 4, y + 5,
        { width: widths[column] - 8, align: alignments[column] });
      cursor += widths[column];
    });
    document.y = y + height;
    document.x = x;
  }

  function totalsBox(summary) {
    const boxWidth = 245;
    const boxX = x + width - boxWidth;
    const rowHeight = 16;
    const height = rowHeight * summary.length;
    ensure(height + 6);
    const y = document.y + 5;
    summary.forEach(([label, value, monetary], index) => {
      const rowY = y + rowHeight * index;
      document.rect(boxX, rowY, boxWidth, rowHeight)
        .fillAndStroke(index === summary.length - 1 ? '#E9F1F7' : SOFT, RULE);
      document.fillColor(index === summary.length - 1 ? NAVY : MUTED).fontSize(index === summary.length - 1 ? 9 : 8)
        .text(label, boxX + 7, rowY + 3.5, { width: 95 });
      document.fillColor(index === summary.length - 1 ? NAVY : TEXT).fontSize(index === summary.length - 1 ? 9 : 8)
        .text(`${monetary ? `${printable(draft.currency)} ` : ''}${value}`, boxX + 102, rowY + 3.5,
          { width: boxWidth - 109, align: 'right' });
    });
    document.y = y + height;
    document.x = x;
  }

  function termCardHeight(item, cardWidth) {
    const innerWidth = cardWidth - 12;
    const labelWidth = cardWidth - 28;
    textFont(item.label).fontSize(6.6);
    const labelHeight = Math.max(10, document.heightOfString(item.label, { width: labelWidth }));
    textFont(item.body).fontSize(7.5);
    const bodyHeight = document.heightOfString(item.body, { width: innerWidth, lineGap: 0.5 });
    return Math.max(28, labelHeight + bodyHeight + 7);
  }

  function drawTermMarker(iconX, iconY) {
    const centerX = iconX + 4.5;
    const centerY = iconY + 4.5;
    document.save();
    document.circle(centerX, centerY, 4.5).fill('#E7EFF6');
    document.circle(centerX, centerY, 1.35).fill(NAVY);
    document.restore();
  }

  function drawTermCard(item, cardX, cardWidth, y, height) {
    const innerWidth = cardWidth - 12;
    const labelWidth = cardWidth - 28;
    document.rect(cardX, y, cardWidth, height).fillAndStroke('#FBFCFD', RULE);
    drawTermMarker(cardX + 6.5, y + 3.5);
    textFont(item.label).fillColor(NAVY).fontSize(6.6).text(item.label, cardX + 20, y + 4,
      { width: labelWidth });
    const labelHeight = Math.max(10, document.heightOfString(item.label, { width: labelWidth }));
    textFont(item.body).fillColor(TEXT).fontSize(7.5).text(item.body, cardX + 6, y + 4 + labelHeight,
      { width: innerWidth, lineGap: 0.5 });
  }

  function termGrid(items, title) {
    if (!items.length) return;
    const termHeading = (label) => {
      ensure(18);
      const y = document.y + 3;
      document.fillColor(NAVY).fontSize(8.5).text(label, x, y, { width });
      document.y = y + 12;
      document.x = x;
    };
    termHeading(title);
    const gap = 6;
    const cardWidth = (width - gap) / 2;
    for (let index = 0; index < items.length; index += 2) {
      const pair = items.slice(index, index + 2);
      const heights = pair.map((item) => termCardHeight(item, cardWidth));
      const rowHeight = Math.max(...heights);
      if (document.y + rowHeight > bottom()) {
        page();
        termHeading(`${title}${zh ? '（续）' : ' (CONTINUED)'}`);
      }
      const y = document.y;
      pair.forEach((item, pairIndex) => {
        drawTermCard(item, x + pairIndex * (cardWidth + gap), cardWidth, y, rowHeight);
      });
      document.y = y + rowHeight + 2;
      document.x = x;
    }
  }

  try {
    page();
    infoGrid([
      { label: zh ? '报价编号' : 'QUOTE NO.', value: zh ? '未签发' : 'Not issued' },
      { label: 'REF.', value: opportunity.opportunityNo },
      { label: zh ? '报价版本' : 'VERSION', value: zh ? '未签发' : 'Not issued' },
      { label: zh ? '草稿修订' : 'DRAFT REV.', value: `D${draft.draftRevisionNo}` },
      { label: zh ? '报价日期' : 'QUOTE DATE', value: zh ? '未签发' : 'Not issued' }
    ]);
    document.y += 4;
    partyColumns({
      title: zh ? '客户与项目' : 'CUSTOMER & PROJECT',
      rows: [
        { label: zh ? '公司' : 'Company', value: opportunity.customerName },
        { label: zh ? '收件人' : 'Attention', value: draft.customerContactName || opportunity.primaryContactName },
        { label: zh ? '电话' : 'Telephone', value: draft.customerContactPhone },
        { label: zh ? '邮箱' : 'Email', value: draft.customerContactEmail },
        { label: zh ? '项目' : 'Project', value: opportunity.title },
        { label: zh ? '币种' : 'Currency', value: draft.currency }
      ]
    }, {
      title: zh ? '供应商' : 'SUPPLIER',
      rows: [
        { label: zh ? '公司' : 'Company', value: draft.sellerEntityName },
        { label: zh ? '联系人' : 'Contact', value: opportunity.salespersonQuotationContactName || opportunity.salespersonDisplayName },
        { label: zh ? '电话' : 'Telephone', value: sellerProfile?.phone },
        { label: zh ? '邮箱' : 'Email', value: sellerProfile?.email || 'sales@sunkaier.com' },
        { label: zh ? '地址' : 'Address', value: sellerProfile?.address },
        { label: zh ? '网站' : 'Website', value: sellerProfile?.website }
      ]
    });
    heading(zh ? '报价明细' : 'QUOTED ITEMS');
    const widths = lineTableHeader();
    const lineItems = draft.lineItems || [];
    for (const [index, row] of lineItems.entries()) {
      lineRow(row, index, widths, index === lineItems.length - 1 ? 72 : 0);
    }
    if (!lineItems.length) compactRow(zh ? '明细' : 'Items', zh ? '尚未填写' : 'Not entered');
    const totals = calculateQuotationTotals(lineItems, draft.taxRate || '0');
    const summary = [
      [zh ? '小计' : 'Subtotal', totals ? money(totals.subtotalCents) : '—', true],
      [zh ? '税率' : 'Tax rate', `${String(draft.taxRate || '0')}%`, false],
      [zh ? '税额' : 'Tax amount', totals ? money(totals.taxCents) : '—', true],
      [zh ? '报价总额' : 'Quotation total', totals ? money(totals.totalCents) : '—', true]
    ];
    totalsBox(summary);
    termGrid(QUOTATION_COMMERCIAL_TERM_SECTIONS.map((section) => ({
      label: zh ? section.zh : section.en,
      body: printable(draft.termSelections?.[section.key]?.body
        || (zh ? '未选择已发布文案' : 'No published wording selected'))
    })), zh ? '商务条件' : 'COMMERCIAL TERMS');
    anchorNearFooter(59);
    ensure(62);
    heading(zh ? '签名与公司章' : 'SIGNATURE AND COMPANY STAMP');
    infoGrid([
      { label: zh ? '状态' : 'STATUS', value: zh ? '未提交审批／未签署' : 'Not submitted / not signed' },
      { label: zh ? '签署人' : 'SIGNATORY', value: 'Mark Yang' },
      { label: zh ? '公司章' : 'COMPANY STAMP', value: draft.sellerEntityCode === 'sunkaier_apac'
        ? (zh ? '正式签发时加盖' : 'Applied on formal issue')
        : (zh ? '按卖方主体签章政策处理' : 'According to seller entity policy') }
    ], { gap: 8, minHeight: 38 });
    const range = document.bufferedPageRange();
    for (let index = range.start; index < range.start + range.count; index += 1) {
      document.switchToPage(index);
      const footerY = document.page.height - 52;
      document.moveTo(x, footerY - 8).lineTo(x + width, footerY - 8).strokeColor(RULE).lineWidth(0.5).stroke();
      document.fillColor(MUTED).fontSize(8).text(
        zh ? `内部草稿 · 第 ${index + 1} 页／共 ${range.count} 页` : `Internal draft · Page ${index + 1} of ${range.count}`,
        x, footerY, { width, align: 'right', lineBreak: false }
      );
    }
    document.end();
    const result = await completed;
    return result;
  } catch (error) {
    document.destroy();
    throw error;
  }
}
