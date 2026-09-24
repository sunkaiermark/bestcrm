import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PRODUCT_CATEGORIES,
  confirmedProductCategoriesFromInput,
  normalizeConfirmedProductCategories,
  productCategoryLabel,
  resolveProductCategoryCode,
  suggestProductCategoryCode,
  suggestProductCategoryCodes,
  suggestProductInterest
} from '../../src/domain/productCategories.mjs';

test('CRM taxonomy keeps the website eleven plus Process Line as twelve unique reporting categories', () => {
  assert.equal(PRODUCT_CATEGORIES.length, 12);
  assert.equal(new Set(PRODUCT_CATEGORIES.map(({ code }) => code)).size, 12);
  assert.equal(productCategoryLabel('kneaders'), 'Kneaders');
  assert.equal(productCategoryLabel('process-line'), 'Process Line');
  assert.equal(productCategoryLabel('unknown'), '');
});

test('multiple rule matches stay suggestions until separately confirmed', () => {
  assert.deepEqual(suggestProductCategoryCodes({ subject: 'Kneader, pump and process line RFQ' }),
    ['kneaders', 'process-line', 'pumps']);
  assert.deepEqual(confirmedProductCategoriesFromInput({ subject: 'Kneader RFQ' }), []);
  assert.deepEqual(confirmedProductCategoriesFromInput({
    confirmedProductCategoryCodes: ['pumps', 'kneaders', 'pumps']
  }), ['kneaders', 'pumps']);
  assert.deepEqual(confirmedProductCategoriesFromInput({ productCategoriesSubmitted: '1' }, ['kneaders']), []);
  assert.deepEqual(confirmedProductCategoriesFromInput({}, ['kneaders']), ['kneaders']);
  assert.throws(() => normalizeConfirmedProductCategories(['kneaders', 'unknown']), /Invalid product category/);
});

test('email lead can suggest an exact product and reviewable category', () => {
  const subject = 'Requirement of Plug screw feeder | 24-09-2026';
  assert.equal(suggestProductInterest({ subject }), 'Plug screw feeder');
  assert.equal(suggestProductCategoryCode({ subject }), 'custom-machines');
  assert.equal(suggestProductCategoryCode({ productInterest: 'Twin cone kneader' }), 'kneaders');
  assert.equal(suggestProductCategoryCode({ subject: '客户询价：捏合机' }), 'kneaders');
  assert.equal(suggestProductCategoryCode({ subject: 'RFQ for a polymer process line' }), 'process-line');
  assert.equal(suggestProductCategoryCode({ subject: '新建生产线询价' }), 'process-line');
  assert.equal(suggestProductCategoryCode({ subject: 'Process line and reactor RFQ' }), '');
  assert.equal(suggestProductCategoryCode({ subject: 'Pump and reactor RFQ' }), '');
  assert.equal(suggestProductCategoryCode({ subject: 'Unspecified equipment RFQ' }), '');
});

test('manual category overrides the suggestion and rejects values outside the fixed list', () => {
  assert.equal(resolveProductCategoryCode({ subject: 'Kneader RFQ' }), 'kneaders');
  assert.equal(resolveProductCategoryCode({ subject: 'Kneader RFQ', productCategoryCode: 'mixers' }), 'mixers');
  assert.equal(resolveProductCategoryCode({ productCategoryCode: 'process-line' }), 'process-line');
  assert.equal(resolveProductCategoryCode({ productCategoryCode: '' }, 'pumps'), '');
  assert.throws(() => resolveProductCategoryCode({ productCategoryCode: 'other' }), /Invalid product category/);
});
