import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import PDFDocument from 'pdfkit';
import { QUOTATION_COMMERCIAL_TERM_SECTIONS } from '../domain/quotationCommercialTermSections.mjs';
import { calculateQuotationTotals } from '../domain/quotationMoney.mjs';

const FONT_CANDIDATES = [
  'C:\\Windows\\Fonts\\NotoSansSC-VF.ttf',
  'C:\\Windows\\Fonts\\Deng.ttf',
  '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
  '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc'
];
const KOREAN_FONT_CANDIDATES = [
  'C:\\Windows\\Fonts\\malgun.ttf',
  '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
  '/usr/share/fonts/opentype/noto/NotoSansCJKkr-Regular.otf',
  '/usr/share/fonts/truetype/noto/NotoSansKR-Regular.ttf'
];
const NAVY = '#244C7C';
const TEXT = '#23313F';
const MUTED = '#627486';
const RULE = '#D7E1E9';
const SOFT = '#F7F9FB';
const LOGO_PATH = fileURLToPath(new URL('../public/assets/sunkaier-logo-login.png', import.meta.url));
const HANGUL = /[\u1100-\u11ff\u3130-\u318f\uac00-\ud7af]/;

function cents(row) {
  const [qtyWhole, qtyFraction = ''] = String(row.quantity).split('.');
  const quantity = BigInt(qtyWhole) * 10000n + BigInt((qtyFraction + '0000').slice(0, 4));
  const price = unitPriceCents(row);
  return (quantity * price + 5000n) / 10000n;
}

function unitPriceCents(row) {
  const [priceWhole, priceFraction = ''] = String(row.unitPrice).split('.');
  const price = BigInt(priceWhole) * 100n + BigInt((priceFraction + '00').slice(0, 2));
  return price;
}

function money(value) {
  return `${(value / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${(value % 100n).toString().padStart(2, '0')}`;
}

function issueDate(signedAt) {
  const fields = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date(signedAt)).map((part) => [part.type, part.value]));
  return `${fields.year}-${fields.month}-${fields.day}`;
}

export async function renderSalesCommercialQuotationFormalPdf({ version, signedAt, signature, seal, fontPath = '' }) {
  if (!version?.snapshot || version.status !== 'approved' || !Buffer.isBuffer(signature)) {
    throw new Error('An approved frozen quotation and personal signature image are required');
  }
  const snapshot = version.snapshot;
  if (snapshot.seller?.code === 'sunkaier_apac' && !Buffer.isBuffer(seal)) {
    throw new Error('Singapore seller requires its company seal');
  }
  if (snapshot.seller?.code === 'sunkaier_china' && seal) {
    throw new Error('A Singapore seal cannot be applied to a China quotation');
  }
  const font = [fontPath, ...FONT_CANDIDATES].filter(Boolean).find(existsSync);
  if (!font) throw new Error('A CJK-capable quotation PDF font is required');
  const zh = snapshot.language === 'zh';
  const document = new PDFDocument({
    size: 'A4', margins: { top: 84, right: 43, bottom: 30, left: 43 },
    bufferPages: true, autoFirstPage: false,
    info: { Title: `QUOTATION ${version.quotationNo}`, Author: snapshot.seller.legalName }
  });
  document.registerFont('quotation', font);
  document.registerFont('quotation-korean', KOREAN_FONT_CANDIDATES.find(existsSync) || font);
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
    document.image(LOGO_PATH, x, 27, { fit: [152, 34] });
    document.fillColor(TEXT).fontSize(14).text('QUOTATION', x + 315, 36, { width: 194, align: 'right' });
    document.moveTo(x, 68).lineTo(x + width, 68).strokeColor('#0D7A79').lineWidth(1).stroke();
    document.font('quotation').fontSize(9).fillColor(TEXT);
    document.x = x;
    document.y = 84;
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

  function normalized(value) {
    return String(value ?? '').trim() || '—';
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
      textFont(item.value).fillColor(TEXT).fontSize(8).text(normalized(item.value), cellX + 6 + labelWidth, y + 7,
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
    const valueHeight = document.heightOfString(normalized(row.value), { width: cardWidth - labelWidth - 10 });
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
        textFont(row.value).fillColor(TEXT).fontSize(8).text(normalized(row.value), cardX + metrics.labelWidth + 5, rowY + 5,
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

  const widths = [36, 223, 50, 52, 74, 74];
  const alignments = ['center', 'left', 'center', 'center', 'right', 'right'];
  function tableHeader() {
    ensure(23);
    const labels = zh ? ['序号', '产品说明', '数量', '单位', '单价', '金额']
      : ['No.', 'Description', 'Qty', 'Unit', 'Unit price', 'Amount'];
    const y = document.y;
    document.rect(x, y, width, 22).fill('#E9F1F7');
    let cursor = x;
    labels.forEach((label, index) => {
      textFont(label).fillColor(NAVY).fontSize(8).text(label, cursor + 4, y + 5,
        { width: widths[index] - 8, align: alignments[index] });
      cursor += widths[index];
    });
    document.y = y + 22;
  }
  function lineRow(row, index, reserveAfter = 0) {
    const cells = [String(index + 1), row.description, row.quantity, row.unit,
      money(unitPriceCents(row)), money(cents(row))];
    const height = Math.max(26, ...cells.map((cell, column) => {
      textFont(cell).fontSize(8);
      return document.heightOfString(String(cell), { width: widths[column] - 8 }) + 10;
    }));
    if (height > bottom() - 130) throw new Error(`Quotation row ${index + 1} is too long for A4`);
    if (document.y + height + reserveAfter > bottom()) { page(); tableHeader(); }
    const y = document.y;
    let cursor = x;
    cells.forEach((cell, column) => {
      document.rect(cursor, y, widths[column], height).strokeColor(RULE).lineWidth(0.5).stroke();
      textFont(cell).fillColor(TEXT).fontSize(8).text(String(cell), cursor + 4, y + 5,
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
        .text(`${monetary ? `${snapshot.currency} ` : ''}${value}`, boxX + 102, rowY + 3.5,
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

  function termGrid(items, title, reserveAfter = 0) {
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
      const isLastRow = index + 2 >= items.length;
      if (document.y + rowHeight + (isLastRow ? reserveAfter : 0) > bottom()) {
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
      { label: zh ? '报价编号' : 'QUOTE NO.', value: version.quotationNo },
      { label: 'REF.', value: snapshot.opportunityNo },
      { label: zh ? '报价版本' : 'VERSION', value: `V${version.versionNo}` },
      { label: zh ? '报价日期' : 'QUOTE DATE', value: issueDate(signedAt) }
    ]);
    document.y += 4;
    const customerRows = [
      { label: zh ? '公司' : 'Company', value: snapshot.customerName },
      { label: zh ? '收件人' : 'Attention', value: snapshot.attention },
      { label: zh ? '电话' : 'Telephone', value: snapshot.customerContactPhone },
      { label: zh ? '邮箱' : 'Email', value: snapshot.customerContactEmail },
      { label: zh ? '项目' : 'Project', value: snapshot.project },
      { label: zh ? '币种' : 'Currency', value: snapshot.currency }
    ].filter((row) => String(row.value ?? '').trim());
    const supplierRows = [
      { label: zh ? '公司' : 'Company', value: snapshot.seller.legalName },
      { label: zh ? '联系人' : 'Contact', value: snapshot.sellerContact },
      { label: zh ? '电话' : 'Telephone', value: snapshot.seller.phone },
      { label: zh ? '邮箱' : 'Email', value: snapshot.seller.email },
      { label: zh ? '地址' : 'Address', value: snapshot.seller.address },
      { label: zh ? '网站' : 'Website', value: snapshot.seller.website }
    ].filter((row) => String(row.value ?? '').trim());
    partyColumns(
      { title: zh ? '客户与项目' : 'CUSTOMER & PROJECT', rows: customerRows },
      { title: zh ? '供应商' : 'SUPPLIER', rows: supplierRows }
    );
    heading(zh ? '报价明细' : 'QUOTED ITEMS');
    tableHeader();
    for (const [index, item] of snapshot.lineItems.entries()) {
      lineRow(item, index, index === snapshot.lineItems.length - 1 ? 72 : 0);
    }
    const totals = calculateQuotationTotals(snapshot.lineItems, snapshot.taxRate || '0');
    const summary = [
      [zh ? '小计' : 'Subtotal', totals ? money(totals.subtotalCents) : '—', true],
      [zh ? '税率' : 'Tax rate', `${snapshot.taxRate || '0'}%`, false],
      [zh ? '税额' : 'Tax amount', totals ? money(totals.taxCents) : '—', true],
      [zh ? '报价总额' : 'Quotation total', totals ? money(totals.totalCents) : '—', true]
    ];
    totalsBox(summary);
    const selectedSections = QUOTATION_COMMERCIAL_TERM_SECTIONS
      .filter((section) => snapshot.termSelections?.[section.key]);
    termGrid(selectedSections.map((section) => ({
      label: zh ? section.zh : section.en,
      body: normalized(snapshot.termSelections[section.key].body)
    })), zh ? '商务条件' : 'COMMERCIAL TERMS');
    anchorNearFooter(103);
    ensure(105);
    heading(zh ? '授权签发' : 'AUTHORIZED ISSUE');
    const signY = document.y;
    document.fillColor(TEXT).fontSize(9).text(zh ? '签发人：Mark Yang' : 'Issued by: Mark Yang', x + 7, signY,
      { width: 230 });
    document.image(signature, x + 8, signY + 17, { fit: [78, 44] });
    if (seal) document.image(seal, x + width - 92, signY, { fit: [74, 74] });
    document.y = signY + 82;
    const range = document.bufferedPageRange();
    for (let index = range.start; index < range.start + range.count; index += 1) {
      document.switchToPage(index);
      const footerY = document.page.height - 52;
      document.moveTo(x, footerY - 8).lineTo(x + width, footerY - 8)
        .strokeColor(RULE).lineWidth(0.5).stroke();
      document.fillColor(MUTED).fontSize(8).text(
        `${version.quotationNo} · ${zh ? '第' : 'Page'} ${index + 1} ${zh ? '页／共' : 'of'} ${range.count} ${zh ? '页' : ''}`,
        x, footerY, { width, align: 'right', lineBreak: false }
      );
    }
    document.end();
    return await completed;
  } catch (error) {
    document.destroy();
    throw error;
  }
}
