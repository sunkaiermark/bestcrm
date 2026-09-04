import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_COMMERCIAL_PACKAGE_SCHEMA,
  BID_CONTENT_COMPONENT_TYPES,
  contentRevisionLabel
} from '../../src/domain/bidCenterLibrary.mjs';

test('commercial package baseline exposes the frozen twenty structured sections', () => {
  assert.equal(DEFAULT_COMMERCIAL_PACKAGE_SCHEMA.sections.length, 20);
  assert.equal(DEFAULT_COMMERCIAL_PACKAGE_SCHEMA.sections[0].key, 'commercial_cover');
  assert.equal(DEFAULT_COMMERCIAL_PACKAGE_SCHEMA.sections.at(-1).key, 'commercial_attachments');
  assert.equal(new Set(DEFAULT_COMMERCIAL_PACKAGE_SCHEMA.sections.map((section) => section.key)).size, 20);
  assert.ok(BID_CONTENT_COMPONENT_TYPES.includes('controlled_attachment'));
  assert.equal(contentRevisionLabel('COMPANY-PROFILE', 2), 'COMPANY-PROFILE-R2');
});
