import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyCommercialVariableOverrides,
  buildOpportunityCommercialDraftSnapshot,
  normalizeCommercialVariableSchema,
  prefillCommercialDraftVariables,
  validateCommercialDraftVariables
} from '../../src/services/opportunityCommercialDraftService.mjs';

function variable(overrides = {}) {
  return {
    variableKey: 'total_price',
    labelEn: 'Total price',
    labelZh: '总价',
    dataType: 'number',
    sourceField: 'total_price',
    sectionKey: 'pricing_schedule',
    isRequired: true,
    defaultValue: '',
    validationRules: { min: 1, max: 1000000 },
    sortOrder: 1,
    ...overrides
  };
}

function templateFixture() {
  return {
    template: {
      id: 5,
      templateCode: 'COMM-GLOBAL',
      nameEn: 'Global Commercial Package',
      nameZh: '全球商务包',
      language: 'bilingual',
      isActive: true,
      currentPublishedRevisionId: 9
    },
    revision: {
      id: 9,
      revisionNo: 2,
      status: 'published',
      contentSchema: {
        schemaVersion: 1,
        sections: [{ key: 'pricing_schedule', sortOrder: 1, contentBlockIds: [20] }]
      },
      variableSchema: [variable()],
      validationRules: { submission: 'all_required' }
    }
  };
}

function contentSnapshot(overrides = {}) {
  return {
    blockId: 20,
    blockCode: 'PAYMENT-01',
    revisionId: 21,
    revisionNo: 1,
    revisionLabel: 'PAYMENT-01-R1',
    category: 'commercial',
    ownerRoleCode: 'commercial_manager',
    sensitivity: 'confidential',
    effectiveDate: '2026-01-01',
    expiresAt: null,
    attachmentSha256: 'a'.repeat(64),
    ...overrides
  };
}

test('commercial variables are normalized, sorted, and limited to approved CRM fields', () => {
  const schema = normalizeCommercialVariableSchema([
    variable({ variableKey: 'customer', dataType: 'text', sourceField: 'customer_legal_name', sortOrder: 2 }),
    variable({ sortOrder: 1 })
  ]);
  assert.deepEqual(schema.map((item) => item.variableKey), ['total_price', 'customer']);
  assert.throws(() => normalizeCommercialVariableSchema([
    variable({ sourceField: 'database_query' })
  ]), /source is not approved/);
  assert.throws(() => normalizeCommercialVariableSchema([
    variable(), variable()
  ]), /key is invalid/);
});

test('CRM prefill provenance survives and a user override records the prior value', () => {
  const schema = normalizeCommercialVariableSchema([
    variable(),
    variable({ variableKey: 'customer', dataType: 'text', sourceField: 'customer_legal_name', isRequired: false, validationRules: {}, sortOrder: 2 })
  ]);
  const prefilled = prefillCommercialDraftVariables(schema, { totalPrice: 12000, customerName: 'Acme' });
  const overridden = applyCommercialVariableOverrides(schema, prefilled.values, prefilled.sources, { total_price: '15000' });
  assert.equal(overridden.values.customer, 'Acme');
  assert.equal(overridden.sources.customer.sourceType, 'crm');
  assert.equal(overridden.values.total_price, 15000);
  assert.deepEqual(overridden.sources.total_price, {
    sourceType: 'manual_override', sourceField: 'total_price', previousValue: 12000, valueAtCreation: 15000
  });
});

test('commercial validation reports required, type, range, date, and approved-list issues', () => {
  const schema = normalizeCommercialVariableSchema([
    variable(),
    variable({ variableKey: 'count', dataType: 'integer', sourceField: 'manual', validationRules: { min: 2 }, sortOrder: 2 }),
    variable({ variableKey: 'signed', dataType: 'boolean', sourceField: 'manual', validationRules: {}, sortOrder: 3 }),
    variable({ variableKey: 'date', dataType: 'date', sourceField: 'signature_date', validationRules: {}, sortOrder: 4 }),
    variable({ variableKey: 'currency', dataType: 'text', sourceField: 'currency', validationRules: { allowedValues: ['USD', 'CNY'] }, sortOrder: 5 })
  ]);
  const issues = validateCommercialDraftVariables(schema, {
    total_price: '', count: 1.5, signed: 'yes', date: '2026-02-30', currency: 'EUR'
  });
  assert.deepEqual(issues.map((issue) => issue.code), ['required', 'type', 'type', 'type', 'allowed_values']);
});

test('commercial project draft freezes template, variables, rendered blocks, hashes, and provenance', () => {
  const { template, revision } = templateFixture();
  const snapshot = buildOpportunityCommercialDraftSnapshot({
    opportunity: { id: 11, opportunityNo: 'OPP-11' },
    template,
    revision,
    context: { customerId: 2, contactId: 3, totalPrice: 12000, quoteId: 8 },
    contentSnapshots: [contentSnapshot()],
    language: 'en',
    actorUserId: 7,
    overrides: { total_price: '15000' },
    snapshotAt: '2026-09-04T00:00:00.000Z'
  });
  revision.variableSchema[0].labelEn = 'Changed later';
  assert.equal(snapshot.templateRevisionId, 9);
  assert.equal(snapshot.variableValues.total_price, 15000);
  assert.equal(snapshot.variableSchemaSnapshot[0].labelEn, 'Total price');
  assert.equal(snapshot.renderedContent.sections[0].contentBlocks[0].attachmentSha256, 'a'.repeat(64));
  assert.equal(snapshot.sourceMetadata.variableValueSources.total_price.sourceType, 'manual_override');
  assert.equal(snapshot.validationIssues.length, 0);
});

test('draft generation rejects missing, future, and expired controlled content', () => {
  const { template, revision } = templateFixture();
  const input = {
    opportunity: { id: 11, opportunityNo: 'OPP-11' }, template, revision,
    context: { customerId: 2, contactId: 3, totalPrice: 12000 }, language: 'en', actorUserId: 7,
    snapshotAt: '2026-09-04T00:00:00.000Z'
  };
  assert.throws(() => buildOpportunityCommercialDraftSnapshot({ ...input, contentSnapshots: [] }), /not currently published/);
  assert.throws(() => buildOpportunityCommercialDraftSnapshot({
    ...input, contentSnapshots: [contentSnapshot({ effectiveDate: new Date('2026-10-01T00:00:00Z') })]
  }), /outside its effective dates/);
  assert.throws(() => buildOpportunityCommercialDraftSnapshot({
    ...input, contentSnapshots: [contentSnapshot({ expiresAt: new Date('2026-08-31T00:00:00Z') })]
  }), /outside its effective dates/);
});
