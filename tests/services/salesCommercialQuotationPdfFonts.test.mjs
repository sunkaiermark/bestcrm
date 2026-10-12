import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import PDFDocument from 'pdfkit';
import {
  BUNDLED_QUOTATION_FONT_PATH,
  registerSalesCommercialQuotationPdfFonts,
  resolveSalesCommercialQuotationPdfFonts
} from '../../src/services/salesCommercialQuotationPdfFonts.mjs';

test('bundled standalone font replaces an explicitly configured TTC collection', () => {
  const ttc = '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc';
  const korean = '/usr/share/fonts/opentype/noto/NotoSansCJKkr-Regular.otf';
  const fonts = resolveSalesCommercialQuotationPdfFonts(ttc,
    (candidate) => [BUNDLED_QUOTATION_FONT_PATH, ttc, korean].includes(candidate));

  assert.deepEqual(fonts, {
    primary: { path: BUNDLED_QUOTATION_FONT_PATH },
    korean: { path: BUNDLED_QUOTATION_FONT_PATH }
  });

  const registrations = [];
  registerSalesCommercialQuotationPdfFonts({
    registerFont(...args) { registrations.push(args); }
  }, fonts);
  assert.deepEqual(registrations, [
    ['quotation', BUNDLED_QUOTATION_FONT_PATH],
    ['quotation-korean', BUNDLED_QUOTATION_FONT_PATH]
  ]);
});

test('bundled font remains authoritative when an external standalone font is configured', () => {
  const explicit = '/fonts/quotation.ttf';
  const korean = 'C:\\Windows\\Fonts\\malgun.ttf';
  const fonts = resolveSalesCommercialQuotationPdfFonts(explicit,
    (candidate) => [BUNDLED_QUOTATION_FONT_PATH, explicit, korean].includes(candidate));

  assert.deepEqual(fonts, {
    primary: { path: BUNDLED_QUOTATION_FONT_PATH },
    korean: { path: BUNDLED_QUOTATION_FONT_PATH }
  });
});

test('bundled quotation font embeds Latin and Simplified Chinese text in a real PDF', async () => {
  const fontBytes = await readFile(BUNDLED_QUOTATION_FONT_PATH);
  assert.ok(fontBytes.length > 1_000_000);
  assert.equal(createHash('sha256').update(fontBytes).digest('hex'),
    '2c76254f6fc379fddfce0a7e84fb5385bb135d3e399294f6eeb6680d0365b74b');

  const document = new PDFDocument();
  document.registerFont('quotation', BUNDLED_QUOTATION_FONT_PATH);
  const chunks = [];
  const completed = new Promise((resolve, reject) => {
    document.on('data', (chunk) => chunks.push(chunk));
    document.on('error', reject);
    document.on('end', () => resolve(Buffer.concat(chunks)));
  });
  document.font('quotation').text('QUOTATION 报价单 이승환');
  document.end();

  const pdf = await completed;
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  const source = pdf.toString('latin1');
  assert.match(source, /\/Subtype \/Type0/);
  assert.match(source, /\/FontFile[23]/);
  assert.ok(pdf.length > 3_000);
});
