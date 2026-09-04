import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BID_CONTENT_CATEGORY_VALUES,
  BID_IMMUTABLE_PROJECT_STATUSES,
  BID_PACKAGE_TYPE_VALUES,
  BID_PROJECT_STATUS_VALUES,
  BID_SECTION_MODIFICATION_STATUS_VALUES,
  BID_SECTION_SOURCE_VALUES,
  BID_TEMPLATE_STATUS_VALUES,
  commercialPackageDraftLabel,
  commercialPackageVersionLabel,
  commercialTemplateRevisionLabel,
  completeBidDraftLabel,
  completeBidVersionLabel,
  isImmutableBidProjectStatus
} from '../../src/domain/bidCenter.mjs';

test('bid center domain values match the frozen V1 vocabulary', () => {
  assert.deepEqual(BID_PACKAGE_TYPE_VALUES, ['technical', 'commercial', 'complete']);
  assert.deepEqual(BID_TEMPLATE_STATUS_VALUES, ['draft', 'review_pending', 'published', 'retired']);
  assert.deepEqual(BID_PROJECT_STATUS_VALUES, [
    'draft', 'in_progress', 'review_pending', 'rejected', 'approved', 'sent', 'superseded', 'accepted'
  ]);
  assert.deepEqual(BID_SECTION_SOURCE_VALUES, ['template', 'clause', 'content_block', 'project']);
  assert.deepEqual(BID_SECTION_MODIFICATION_STATUS_VALUES, [
    'standard', 'customized', 'project_added', 'omitted', 'needs_review'
  ]);
  assert.deepEqual(BID_CONTENT_CATEGORY_VALUES, ['technical', 'commercial', 'common']);
});

test('bid center domain collections are immutable', () => {
  assert.equal(Object.isFrozen(BID_PACKAGE_TYPE_VALUES), true);
  assert.equal(Object.isFrozen(BID_TEMPLATE_STATUS_VALUES), true);
  assert.equal(Object.isFrozen(BID_PROJECT_STATUS_VALUES), true);
  assert.equal(Object.isFrozen(BID_SECTION_SOURCE_VALUES), true);
  assert.equal(Object.isFrozen(BID_SECTION_MODIFICATION_STATUS_VALUES), true);
  assert.equal(Object.isFrozen(BID_CONTENT_CATEGORY_VALUES), true);
  assert.throws(() => BID_PACKAGE_TYPE_VALUES.push('other'), TypeError);
});

test('bid center numbering covers commercial templates, commercial packages and complete bids', () => {
  assert.equal(commercialTemplateRevisionLabel(3), 'CTPL-R3');
  assert.equal(commercialPackageDraftLabel('2'), 'CP-D2');
  assert.equal(commercialPackageVersionLabel(4), 'CP-V4');
  assert.equal(completeBidDraftLabel(5), 'QP-D5');
  assert.equal(completeBidVersionLabel(6), 'QP-V6');
});

test('bid center numbering rejects zero, negative, decimal and non-numeric sequences', () => {
  for (const invalidValue of [0, -1, 1.5, 'invalid', '', null]) {
    assert.throws(() => commercialTemplateRevisionLabel(invalidValue), /positive integer/);
    assert.throws(() => commercialPackageDraftLabel(invalidValue), /positive integer/);
    assert.throws(() => commercialPackageVersionLabel(invalidValue), /positive integer/);
    assert.throws(() => completeBidDraftLabel(invalidValue), /positive integer/);
    assert.throws(() => completeBidVersionLabel(invalidValue), /positive integer/);
  }
});

test('approved and customer-facing project versions are immutable', () => {
  assert.deepEqual(BID_IMMUTABLE_PROJECT_STATUSES, ['approved', 'sent', 'superseded', 'accepted']);
  assert.equal(isImmutableBidProjectStatus('approved'), true);
  assert.equal(isImmutableBidProjectStatus('sent'), true);
  assert.equal(isImmutableBidProjectStatus('draft'), false);
  assert.equal(isImmutableBidProjectStatus('rejected'), false);
});
