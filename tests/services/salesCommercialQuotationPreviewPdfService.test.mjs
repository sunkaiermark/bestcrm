import test from 'node:test';
import assert from 'node:assert/strict';
import { renderSalesCommercialQuotationPreviewPdf } from '../../src/services/salesCommercialQuotationPreviewPdfService.mjs';

const opportunity = {
  id: 20, opportunityNo: '800020', title: 'Industrial mixer',
  customerName: 'Example Customer', primaryContactName: 'Alice',
  salespersonDisplayName: 'Sales Owner'
};
const draft = {
  opportunityId: 20, language: 'en', draftRevisionNo: 2, currency: 'USD',
  sellerEntityName: 'SUNKAIER ASIA PACIFIC PTE. LTD.',
  lineItems: [{ description: 'Mixer', quantity: '2', unit: 'set', unitPrice: '100', includeInTotal: 'included' }],
  termSelections: { payment: { title: 'Payment', body: 'Published payment text' } }
};

test('A4 quotation PDF is a visibly internal unsigned preview and paginates many rows', async () => {
  const pdf = await renderSalesCommercialQuotationPreviewPdf({ draft: {
    ...draft,
    lineItems: Array.from({ length: 35 }, (_, index) => ({
      description: `Product ${index + 1}`, quantity: '2', unit: 'set', unitPrice: '100', includeInTotal: 'included'
    }))
  }, opportunity });
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  assert.ok(pdf.length > 3000);
  assert.ok((pdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length >= 2);
});

test('preview rejects a mismatched opportunity and rows too tall for one page', async () => {
  await assert.rejects(() => renderSalesCommercialQuotationPreviewPdf({ draft, opportunity: { ...opportunity, id: 21 } }), (error) => error.statusCode === 404);
  await assert.rejects(() => renderSalesCommercialQuotationPreviewPdf({
    draft: { ...draft, lineItems: [{ ...draft.lineItems[0], description: '宽'.repeat(2000) }] }, opportunity
  }), (error) => error.statusCode === 409);
});
