import { existsSync } from 'node:fs';
import PDFDocument from 'pdfkit';
import { QUOTATION_COMMERCIAL_TERM_SECTIONS } from '../domain/quotationCommercialTermSections.mjs';

const FONT_CANDIDATES = [
  'C:\\Windows\\Fonts\\Deng.ttf',
  'C:\\Windows\\Fonts\\NotoSansSC-VF.ttf',
  '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
  '/usr/share/fonts/truetype/noto/NotoSansCJK-Regular.ttc'
];
const NAVY = '#244C7C';
const TEXT = '#23313F';
const MUTED = '#627486';
const RULE = '#D7E1E9';

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

function pdfFont(explicitPath) {
  return [explicitPath, ...FONT_CANDIDATES].filter(Boolean).find(existsSync) || null;
}

export async function renderSalesCommercialQuotationPreviewPdf({ draft, opportunity, fontPath = '' }) {
  if (!draft || !opportunity || Number(draft.opportunityId) !== Number(opportunity.id)) {
    const error = new Error('An existing quotation draft for this opportunity is required');
    error.statusCode = 404;
    throw error;
  }
  const font = pdfFont(fontPath);
  if (!font) {
    const error = new Error('A CJK-capable PDF font is required for quotation preview');
    error.statusCode = 503;
    throw error;
  }
  const zh = draft.language === 'zh';
  const document = new PDFDocument({
    size: 'A4', margins: { top: 114, right: 43, bottom: 63, left: 43 },
    bufferPages: true, autoFirstPage: false,
    info: { Title: `INTERNAL DRAFT QUOTATION ${printable(opportunity.opportunityNo)}`, Author: 'SUNKAIER' }
  });
  document.registerFont('quotation', font);
  document.font('quotation');
  const chunks = [];
  const completed = new Promise((resolve, reject) => {
    document.on('data', (chunk) => chunks.push(chunk));
    document.on('error', reject);
    document.on('end', () => resolve(Buffer.concat(chunks)));
  });
  const x = 43;
  const width = 509;
  const bottom = () => document.page.height - 100;

  function page() {
    document.addPage();
    document.save();
    document.fillColor(NAVY).fontSize(20).text('SUNKAIER', x, 34, { width: 280 });
    document.fillColor(TEXT).fontSize(14).text('QUOTATION', x + 315, 36, { width: 194, align: 'right' });
    document.moveTo(x, 65).lineTo(x + width, 65).strokeColor('#0D7A79').lineWidth(1).stroke();
    document.fillColor('#AD3434').fontSize(9).text(
      zh ? '内部草稿 · 未批准 · 未签署 · 不得对客发送' : 'INTERNAL DRAFT · NOT APPROVED · NOT SIGNED · DO NOT SEND',
      x, 74, { width, align: 'center' }
    );
    document.restore();
    document.font('quotation').fontSize(9).fillColor(TEXT);
    document.x = x;
    document.y = 114;
  }

  function ensure(height) {
    if (document.y + height > bottom()) page();
  }

  function heading(label) {
    ensure(34);
    document.moveDown(0.6);
    document.fillColor(NAVY).fontSize(11).text(label, x, document.y, { width });
    document.moveDown(0.25).fillColor(TEXT).fontSize(9);
  }

  function kv(label, value) {
    const leftWidth = 129;
    document.fontSize(9);
    const height = Math.max(
      document.heightOfString(label, { width: leftWidth - 14 }),
      document.heightOfString(printable(value), { width: width - leftWidth - 14 })
    ) + 12;
    ensure(height);
    const y = document.y;
    document.rect(x, y, leftWidth, height).fillAndStroke('#EEF3F7', RULE);
    document.rect(x + leftWidth, y, width - leftWidth, height).fillAndStroke('#FFFFFF', RULE);
    document.fillColor(MUTED).text(label, x + 7, y + 6, { width: leftWidth - 14 });
    document.fillColor(TEXT).text(printable(value), x + leftWidth + 7, y + 6, { width: width - leftWidth - 14 });
    document.y = y + height;
    document.x = x;
  }

  function wrappedParagraph(value) {
    document.fontSize(9).fillColor(TEXT);
    const text = printable(value);
    for (const paragraph of text.split(/\r?\n/)) {
      if (!paragraph) {
        ensure(14);
        document.y += 14;
        continue;
      }
      let line = '';
      for (const character of paragraph) {
        const candidate = `${line}${character}`;
        if (line && document.widthOfString(candidate) > width - 14) {
          ensure(15);
          const y = document.y;
          document.text(line, x + 7, y, { width: width - 14, lineBreak: false });
          document.y = y + 15;
          line = character;
        } else {
          line = candidate;
        }
      }
      if (line) {
        ensure(15);
        const y = document.y;
        document.text(line, x + 7, y, { width: width - 14, lineBreak: false });
        document.y = y + 15;
      }
    }
    document.y += 5;
    document.x = x;
  }

  function lineTableHeader() {
    ensure(25);
    const labels = zh
      ? ['序号', '产品说明', '数量', '单位', '单价', '金额', '计入']
      : ['No.', 'Description', 'Qty', 'Unit', 'Unit price', 'Amount', 'Total'];
    const widths = [28, 196, 45, 44, 66, 75, 55];
    const y = document.y;
    document.rect(x, y, width, 24).fill('#E9F1F7');
    let cursor = x;
    labels.forEach((label, index) => {
      document.fillColor(NAVY).fontSize(8).text(label, cursor + 3, y + 6, { width: widths[index] - 6 });
      cursor += widths[index];
    });
    document.y = y + 24;
    document.x = x;
    return widths;
  }

  function lineRow(row, index, widths) {
    const cells = [String(index + 1), printable(row.description), printable(row.quantity),
      printable(row.unit), printable(row.unitPrice), money(amountCents(row)),
      row.includeInTotal === 'included' ? (zh ? '是' : 'Yes') : row.includeInTotal === 'excluded' ? (zh ? '否' : 'No') : '—'];
    document.fontSize(8);
    const height = Math.max(28, ...cells.map((cell, column) =>
      document.heightOfString(cell, { width: widths[column] - 8 }) + 12));
    if (height > bottom() - 114 - 25) {
      const error = new Error(`Quotation row ${index + 1} is too long to fit on one A4 page`);
      error.statusCode = 409;
      throw error;
    }
    if (document.y + height > bottom()) {
      page();
      lineTableHeader();
    }
    const y = document.y;
    let cursor = x;
    cells.forEach((cell, column) => {
      document.rect(cursor, y, widths[column], height).strokeColor(RULE).lineWidth(0.5).stroke();
      document.fillColor(TEXT).fontSize(8).text(cell, cursor + 4, y + 6, { width: widths[column] - 8 });
      cursor += widths[column];
    });
    document.y = y + height;
    document.x = x;
  }

  try {
    page();
    kv(zh ? '报价编号' : 'Quote No.', zh ? '未签发' : 'Not issued');
    kv('Ref.', opportunity.opportunityNo);
    kv(zh ? '报价版本' : 'Quote version', zh ? '未签发' : 'Not issued');
    kv(zh ? '草稿修订' : 'Draft revision', `D${draft.draftRevisionNo}`);
    heading(zh ? '客户与项目' : 'CUSTOMER AND PROJECT');
    kv(zh ? '客户' : 'Customer', opportunity.customerName);
    kv(zh ? '收件人' : 'Attention', opportunity.primaryContactName);
    kv(zh ? '项目' : 'Project', opportunity.title);
    heading(zh ? '供应商' : 'SUPPLIER');
    kv(zh ? '卖方主体' : 'Seller entity', draft.sellerEntityName);
    kv(zh ? '联系人' : 'Contact', opportunity.salespersonDisplayName);
    kv(zh ? '邮箱' : 'Email', 'sales@sunkaier.com');
    heading(zh ? '报价明细' : 'QUOTED ITEMS');
    const widths = lineTableHeader();
    let subtotal = 0n;
    for (const [index, row] of (draft.lineItems || []).entries()) {
      lineRow(row, index, widths);
      if (row.includeInTotal === 'included') subtotal += amountCents(row) || 0n;
    }
    if (!(draft.lineItems || []).length) kv(zh ? '明细' : 'Items', zh ? '尚未填写' : 'Not entered');
    // Keep the draft total, short terms and unsigned-status block together when they fit.
    ensure(365);
    ensure(28);
    document.moveDown(0.35).fillColor(NAVY).fontSize(10).text(
      `${zh ? '计入项目小计（草稿测算）' : 'Included items subtotal (draft calculation)'}: ${printable(draft.currency)} ${money(subtotal)}`,
      x, document.y, { width, align: 'right' }
    );
    heading(zh ? '商务条件' : 'COMMERCIAL TERMS');
    for (const section of QUOTATION_COMMERCIAL_TERM_SECTIONS) {
      const selected = draft.termSelections?.[section.key];
      ensure(35);
      document.fillColor(NAVY).fontSize(9).text(zh ? section.zh : section.en, x, document.y, { width });
      document.y += 3;
      wrappedParagraph(selected?.body || (zh ? '未选择已发布文案' : 'No published wording selected'));
    }
    heading(zh ? '签署状态' : 'SIGNATURE STATUS');
    kv(zh ? '状态' : 'Status', zh ? '未提交审批／未签署' : 'Not submitted for approval / not signed');
    const range = document.bufferedPageRange();
    for (let index = range.start; index < range.start + range.count; index += 1) {
      document.switchToPage(index);
      const footerY = document.page.height - 77;
      document.moveTo(x, footerY - 10).lineTo(x + width, footerY - 10).strokeColor(RULE).lineWidth(0.5).stroke();
      document.fillColor(MUTED).fontSize(8).text(
        zh ? `内部草稿 · 第 ${index + 1} 页／共 ${range.count} 页` : `Internal draft · Page ${index + 1} of ${range.count}`,
        x, footerY, { width, align: 'right' }
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
