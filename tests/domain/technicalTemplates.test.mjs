import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TECHNICAL_DOCUMENT_TYPES,
  TECHNICAL_PRODUCT_CATEGORIES,
  opportunityTechnicalDocumentCode,
  opportunityTechnicalDocumentVersionLabel,
  localizedTechnicalField,
  technicalDocumentType,
  technicalProductCategory
} from '../../src/domain/technicalTemplates.mjs';

test('technical document and product category catalogues are frozen to three by ten slots', () => {
  assert.equal(TECHNICAL_DOCUMENT_TYPES.length, 3);
  assert.equal(TECHNICAL_PRODUCT_CATEGORIES.length, 10);
  assert.equal(technicalDocumentType('datasheet').label, 'Datasheet');
  assert.equal(technicalProductCategory('sk3000e_kneader').labelZh, 'SK3000E 捏合机');
});

test('opportunity technical document codes are deterministic and versioned without overwriting', () => {
  assert.equal(opportunityTechnicalDocumentCode('OPP-800001', 'datasheet', 2), 'OPP-800001-02-DATASHEET');
  assert.equal(opportunityTechnicalDocumentCode('OPP-800001', 'technical_agreement'), 'OPP-800001-TECHNICAL-AGREEMENT');
  assert.equal(opportunityTechnicalDocumentCode('OPP-800001', 'bidding_document'), 'OPP-800001-BIDDING-DOCUMENT');
  assert.equal(opportunityTechnicalDocumentVersionLabel('OPP-800001-DATASHEET', 3), 'OPP-800001-DATASHEET-V3');
  assert.equal(opportunityTechnicalDocumentCode('OPP-800001', 'datasheet'), '');
});

test('localized technical fields never fall back to the opposite stored language', () => {
  const localized = { name: 'Legacy English', nameEn: 'English name', nameZh: '' };
  assert.equal(localizedTechnicalField(localized, 'name', 'en'), 'English name');
  assert.equal(localizedTechnicalField(localized, 'name', 'zh'), '');
  assert.equal(localizedTechnicalField({ name: 'Legacy name' }, 'name', 'zh'), 'Legacy name');
});
