import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BUILT_IN_QUOTATION_TYPICAL_TERMS,
  QUOTATION_CURRENCY_OPTIONS,
  QUOTATION_TYPICAL_TERM_TEMPLATE_GROUPS,
  findQuotationTypicalTermTemplate,
  withBuiltInQuotationTypicalTerms
} from '../../src/domain/quotationTypicalTermTemplates.mjs';

test('approved screenshot catalogs have stable collision-free built-in identities', () => {
  const items = QUOTATION_TYPICAL_TERM_TEMPLATE_GROUPS.flatMap((group) => group.items);
  assert.equal(items.length, 121);
  assert.equal(BUILT_IN_QUOTATION_TYPICAL_TERMS.length, 111);
  assert.equal(new Set(BUILT_IN_QUOTATION_TYPICAL_TERMS.map((term) => term.id)).size, 111);
  assert.deepEqual(QUOTATION_CURRENCY_OPTIONS, ['USD', 'EUR', 'CNY', 'SGD', 'GBP', 'AUD']);
  assert.equal(findQuotationTypicalTermTemplate('builtin:payment:telegraphic_transfer:5').type, '30/70');
  assert.equal(findQuotationTypicalTermTemplate('builtin:delivery:standard_delivery_methods:1').type, 'Sea Freight – FCL');
  assert.equal(
    findQuotationTypicalTermTemplate('builtin:delivery:delivery_period_start:1').standardWording,
    'Delivery shall be made within [Delivery Period] after receipt of the advance payment and approval of the technical documents.'
  );
  assert.equal(
    findQuotationTypicalTermTemplate('builtin:warranty:warranty_period:1').standardWording,
    'The warranty period shall be twelve (12) months from the date of commissioning or eighteen (18) months from the date of shipment, whichever occurs first.'
  );
});

test('built-in English wording supplements but never replaces controlled custom wording', () => {
  const custom = [{ id: 91, key: 'payment', language: 'en', title: 'Custom', body: 'Approved' }];
  const english = withBuiltInQuotationTypicalTerms(custom, 'en');
  assert.equal(english.at(-1), custom[0]);
  assert.ok(english.some((term) => term.id === 'builtin:price:price_basis_incoterms_2020:11'));
  assert.deepEqual(withBuiltInQuotationTypicalTerms(custom, 'zh'), custom);
});
