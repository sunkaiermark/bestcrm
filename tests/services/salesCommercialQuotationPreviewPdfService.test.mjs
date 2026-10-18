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
  customerContactName: '이승환', customerContactPhone: '+1 555 0101',
  customerContactEmail: 'alice@example.com',
  lineItems: [{ description: 'Mixer', quantity: '2', unit: 'set', unitPrice: '100', includeInTotal: 'included' }],
  termSelections: { payment: { title: 'Payment', body: 'Published payment text' } }
};

test('compact quotation with three rows and all commercial terms stays on one A4 page', async () => {
  const pdf = await renderSalesCommercialQuotationPreviewPdf({
    draft: {
      ...draft,
      taxRate: '9.00',
      lineItems: [
        { description: 'Production Line', quantity: '1', unit: 'set', unitPrice: '650000', includeInTotal: 'included' },
        { description: 'Heating Unit', quantity: '1', unit: 'set', unitPrice: '80000', includeInTotal: 'included' },
        { description: 'Pelletizing Unit', quantity: '1', unit: 'set', unitPrice: '150000', includeInTotal: 'included' }
      ],
      termSelections: {
        price_tax: { body: 'All prices are exclusive of applicable taxes.' },
        payment: { body: '30% advance, 70% before shipment.' },
        delivery: { body: 'FOB Shanghai Port, China, Incoterms® 2020.' },
        delivery_period: { body: 'Delivery shall be made within sixteen (16) weeks after receipt of the advance payment and approval of the technical documents.' },
        packing: { body: 'Shipment by sea in Full Container Load (FCL).' },
        warranty: { body: 'The warranty period shall be twelve (12) months from commissioning or eighteen (18) months from shipment, whichever occurs first.' },
        validity: { body: 'This quotation is valid for thirty (30) days from the quotation date.' },
        scope: { body: 'The contract price is fixed and firm.' }
      }
    },
    opportunity,
    sellerProfile: {
      phone: '+65 6000 0000',
      email: 'sales@sunkaier.com',
      address: '2 Venture Drive, #10-30, Vision Exchange, Singapore 608526',
      website: 'https://www.sunkaier.com'
    }
  });

  assert.equal((pdf.toString('latin1').match(/\/Type \/Page\b/g) || []).length, 1);
});

test('A4 quotation PDF is a visibly internal unsigned preview and paginates many rows', async () => {
  const pdf = await renderSalesCommercialQuotationPreviewPdf({ draft: {
    ...draft,
    lineItems: Array.from({ length: 35 }, (_, index) => ({
      description: `Product ${index + 1}`, quantity: '2', unit: 'set', unitPrice: '100', includeInTotal: 'included'
    }))
  }, opportunity, sellerProfile: {
    phone: '+65 6000 0000', email: 'sales@sunkaier.com',
    address: '2 Venture Drive, Singapore', website: 'https://www.sunkaier.com'
  } });
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
