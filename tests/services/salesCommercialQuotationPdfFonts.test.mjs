import test from 'node:test';
import assert from 'node:assert/strict';
import {
  registerSalesCommercialQuotationPdfFonts,
  resolveSalesCommercialQuotationPdfFonts
} from '../../src/services/salesCommercialQuotationPdfFonts.mjs';

test('Linux Noto TTC collections select concrete SC and KR faces before PDFKit opens them', () => {
  const ttc = '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc';
  const fonts = resolveSalesCommercialQuotationPdfFonts('', (candidate) => candidate === ttc);

  assert.deepEqual(fonts, {
    primary: { path: ttc, postscriptName: 'NotoSansCJKsc-Regular' },
    korean: { path: ttc, postscriptName: 'NotoSansCJKkr-Regular' }
  });

  const registrations = [];
  registerSalesCommercialQuotationPdfFonts({
    registerFont(...args) { registrations.push(args); }
  }, fonts);
  assert.deepEqual(registrations, [
    ['quotation', ttc, 'NotoSansCJKsc-Regular'],
    ['quotation-korean', ttc, 'NotoSansCJKkr-Regular']
  ]);
});

test('standalone explicit and Korean fonts remain registered without a collection face', () => {
  const explicit = '/fonts/quotation.ttf';
  const korean = 'C:\\Windows\\Fonts\\malgun.ttf';
  const fonts = resolveSalesCommercialQuotationPdfFonts(explicit,
    (candidate) => candidate === explicit || candidate === korean);

  assert.deepEqual(fonts, {
    primary: { path: explicit },
    korean: { path: korean }
  });
});
