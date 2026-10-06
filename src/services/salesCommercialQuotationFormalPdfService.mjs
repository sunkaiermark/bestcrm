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

function cents(row) {
  const [qtyWhole, qtyFraction = ''] = String(row.quantity).split('.');
  const [priceWhole, priceFraction = ''] = String(row.unitPrice).split('.');
  const quantity = BigInt(qtyWhole) * 10000n + BigInt((qtyFraction + '0000').slice(0, 4));
  const price = BigInt(priceWhole) * 100n + BigInt((priceFraction + '00').slice(0, 2));
  return (quantity * price + 5000n) / 10000n;
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
    size: 'A4', margins: { top: 105, right: 43, bottom: 62, left: 43 },
    bufferPages: true, autoFirstPage: false,
    info: { Title: `QUOTATION ${version.quotationNo}`, Author: snapshot.seller.legalName }
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
  const bottom = () => document.page.height - 94;
  function page() {
    document.addPage();
    document.fillColor(NAVY).fontSize(20).text('SUNKAIER', x, 34, { width: 280 });
    document.fillColor(TEXT).fontSize(14).text('QUOTATION', x + 315, 36, { width: 194, align: 'right' });
    document.moveTo(x, 67).lineTo(x + width, 67).strokeColor('#0D7A79').lineWidth(1).stroke();
    document.fillColor(MUTED).fontSize(8).text(
      `${version.quotationNo} · Ref. ${snapshot.opportunityNo} · V${version.versionNo}`,
      x, 76, { width, align: 'right' }
    );
    document.font('quotation').fontSize(9).fillColor(TEXT);
    document.x = x;
    document.y = 105;
  }
  function ensure(height) {
    if (document.y + height > bottom()) page();
  }
  function heading(label) {
    ensure(30);
    document.y += 12;
    document.fillColor(NAVY).fontSize(10).text(label, x, document.y, { width });
    document.y += 4;
  }
  function kv(label, value) {
    const leftWidth = 135;
    const normalized = String(value ?? '').trim() || '—';
    document.fontSize(9);
    const height = Math.max(25,
      document.heightOfString(label, { width: leftWidth - 14 }) + 12,
      document.heightOfString(normalized, { width: width - leftWidth - 14 }) + 12);
    if (height > bottom() - 105) throw new Error('Quotation field is too long for one A4 page');
    ensure(height);
    const y = document.y;
    document.rect(x, y, leftWidth, height).fillAndStroke('#EEF3F7', RULE);
    document.rect(x + leftWidth, y, width - leftWidth, height).fillAndStroke('#FFFFFF', RULE);
    document.fillColor(MUTED).text(label, x + 7, y + 6, { width: leftWidth - 14 });
    document.fillColor(TEXT).text(normalized, x + leftWidth + 7, y + 6,
      { width: width - leftWidth - 14 });
    document.x = x;
    document.y = y + height;
  }
  function paragraph(value) {
    document.fontSize(9).fillColor(TEXT);
    for (const block of String(value ?? '').split(/\r?\n/)) {
      if (!block) { ensure(12); document.y += 12; continue; }
      let line = '';
      for (const character of block) {
        if (line && document.widthOfString(line + character) > width - 16) {
          ensure(15);
          const y = document.y;
          document.text(line, x + 7, y, { width: width - 14, lineBreak: false });
          document.y = y + 15;
          line = character;
        } else line += character;
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
  const widths = [28, 196, 45, 44, 66, 75, 55];
  function tableHeader() {
    ensure(24);
    const labels = zh ? ['序号', '产品说明', '数量', '单位', '单价', '金额', '计入']
      : ['No.', 'Description', 'Qty', 'Unit', 'Unit price', 'Amount', 'Total'];
    const y = document.y;
    document.rect(x, y, width, 24).fill('#E9F1F7');
    let cursor = x;
    labels.forEach((label, index) => {
      document.fillColor(NAVY).fontSize(8).text(label, cursor + 3, y + 6, { width: widths[index] - 6 });
      cursor += widths[index];
    });
    document.y = y + 24;
  }
  function lineRow(row, index) {
    const cells = [String(index + 1), row.description, row.quantity, row.unit, row.unitPrice,
      money(cents(row)), row.includeInTotal === 'included' ? (zh ? '是' : 'Yes') : (zh ? '否' : 'No')];
    document.fontSize(8);
    const height = Math.max(28, ...cells.map((cell, column) =>
      document.heightOfString(String(cell), { width: widths[column] - 8 }) + 12));
    if (height > bottom() - 130) throw new Error(`Quotation row ${index + 1} is too long for A4`);
    if (document.y + height > bottom()) { page(); tableHeader(); }
    const y = document.y;
    let cursor = x;
    cells.forEach((cell, column) => {
      document.rect(cursor, y, widths[column], height).strokeColor(RULE).lineWidth(0.5).stroke();
      document.fillColor(TEXT).fontSize(8).text(String(cell), cursor + 4, y + 6,
        { width: widths[column] - 8 });
      cursor += widths[column];
    });
    document.y = y + height;
    document.x = x;
  }
  try {
    page();
    kv(zh ? '报价编号' : 'Quote No.', version.quotationNo);
    kv('Ref.', snapshot.opportunityNo);
    kv(zh ? '报价版本' : 'Quote version', `V${version.versionNo}`);
    kv(zh ? '签发日期' : 'Issue date', issueDate(signedAt));
    heading(zh ? '客户与项目' : 'CUSTOMER AND PROJECT');
    kv(zh ? '客户' : 'Customer', snapshot.customerName);
    kv(zh ? '收件人' : 'Attention', snapshot.attention);
    kv(zh ? '项目' : 'Project', snapshot.project);
    heading(zh ? '供应商' : 'SUPPLIER');
    kv(zh ? '卖方主体' : 'Seller entity', snapshot.seller.legalName);
    kv(zh ? '联系人' : 'Contact', snapshot.sellerContact);
    kv(zh ? '电话' : 'Telephone', snapshot.seller.phone);
    kv(zh ? '邮箱' : 'Email', snapshot.seller.email);
    kv(zh ? '地址' : 'Address', snapshot.seller.address);
    kv(zh ? '网站' : 'Website', snapshot.seller.website);
    heading(zh ? '报价明细' : 'QUOTED ITEMS');
    tableHeader();
    let subtotal = 0n;
    for (const [index, item] of snapshot.lineItems.entries()) {
      lineRow(item, index);
      if (item.includeInTotal === 'included') subtotal += cents(item);
    }
    ensure(34);
    document.y += 8;
    document.fillColor(NAVY).fontSize(10).text(
      `${zh ? '计入项目小计' : 'Included items subtotal'}: ${snapshot.currency} ${money(subtotal)}`,
      x, document.y, { width, align: 'right' }
    );
    heading(zh ? '商务条件' : 'COMMERCIAL TERMS');
    for (const section of QUOTATION_COMMERCIAL_TERM_SECTIONS) {
      ensure(35);
      document.fillColor(NAVY).fontSize(9).text(zh ? section.zh : section.en, x, document.y, { width });
      document.y += 3;
      paragraph(snapshot.termSelections[section.key].body);
    }
    ensure(150);
    heading(zh ? '授权签发' : 'AUTHORIZED ISSUE');
    const signY = document.y;
    document.fillColor(TEXT).fontSize(9).text(zh ? '签发人：Mark Yang' : 'Issued by: Mark Yang', x + 7, signY,
      { width: 230 });
    document.image(signature, x + 8, signY + 18, { fit: [95, 58] });
    if (seal) document.image(seal, x + width - 125, signY, { fit: [105, 105] });
    document.y = signY + 112;
    const range = document.bufferedPageRange();
    for (let index = range.start; index < range.start + range.count; index += 1) {
      document.switchToPage(index);
      const footerY = document.page.height - 77;
      document.moveTo(x, footerY - 10).lineTo(x + width, footerY - 10)
        .strokeColor(RULE).lineWidth(0.5).stroke();
      document.fillColor(MUTED).fontSize(8).text(
        `${version.quotationNo} · ${zh ? '第' : 'Page'} ${index + 1} ${zh ? '页／共' : 'of'} ${range.count} ${zh ? '页' : ''}`,
        x, footerY, { width, align: 'right' }
      );
    }
    document.end();
    return await completed;
  } catch (error) {
    document.destroy();
    throw error;
  }
}
