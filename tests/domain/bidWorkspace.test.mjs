import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BID_COMMERCIAL_VARIABLE_SOURCE_FIELDS,
  BID_WORKSPACE_LANGUAGES,
  bidOutputProfileRevisionLabel,
  commercialDraftLabel
} from '../../src/domain/bidWorkspace.mjs';

test('bid workspace identities and frozen languages use stable controlled labels', () => {
  assert.deepEqual(BID_WORKSPACE_LANGUAGES, ['en', 'zh', 'bilingual']);
  assert.equal(commercialDraftLabel(3), 'CP-D3');
  assert.equal(bidOutputProfileRevisionLabel('GLOBAL', 2), 'GLOBAL-R2');
  assert.throws(() => commercialDraftLabel(0), RangeError);
});

test('commercial CRM prefill uses an explicit source whitelist', () => {
  assert.ok(BID_COMMERCIAL_VARIABLE_SOURCE_FIELDS.includes('customer_legal_name'));
  assert.ok(BID_COMMERCIAL_VARIABLE_SOURCE_FIELDS.includes('total_price'));
  assert.ok(BID_COMMERCIAL_VARIABLE_SOURCE_FIELDS.includes('manual'));
  assert.equal(BID_COMMERCIAL_VARIABLE_SOURCE_FIELDS.includes('sql_expression'), false);
});
