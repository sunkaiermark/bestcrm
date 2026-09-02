import test from 'node:test';
import assert from 'node:assert/strict';
import { createTechnicalTemplateRepository } from '../../src/repositories/technicalTemplateRepository.mjs';

function createFakeQueryTarget(responses = []) {
  return {
    queries: [],
    async query(sql, params) {
      this.queries.push({ sql, params });
      return responses.shift() || { rows: [], rowCount: 0 };
    }
  };
}

function templateRow(overrides = {}) {
  return {
    id: '4',
    template_code: 'MX-100',
    name: 'Mixer Technical Agreement',
    product_family: 'Mixing',
    product_model: 'MX-100',
    application: 'Polymerization',
    language: 'bilingual',
    current_published_revision_id: '9',
    current_revision_no: '2',
    current_revision_status: 'published',
    latest_revision_no: '2',
    latest_revision_status: 'published',
    is_active: true,
    created_by: '7',
    created_by_display_name: 'Technical Manager',
    updated_by: '7',
    updated_by_display_name: 'Technical Manager',
    created_at: '2026-09-02T01:00:00.000Z',
    updated_at: '2026-09-02T02:00:00.000Z',
    ...overrides
  };
}

test('technical template repository lists published templates with revision labels', async () => {
  const queryTarget = createFakeQueryTarget([{ rows: [templateRow()] }]);
  const repository = createTechnicalTemplateRepository(queryTarget);

  const templates = await repository.listTemplates({ publishedOnly: true });

  assert.equal(templates[0].id, 4);
  assert.equal(templates[0].currentRevisionLabel, 'TPL-R2');
  assert.equal(templates[0].currentPublishedRevisionId, 9);
  assert.match(queryTarget.queries[0].sql, /t\.is_active = true/);
  assert.match(queryTarget.queries[0].sql, /current_revision\.status = 'published'/);
});

test('technical template detail preserves revision variable snapshots and audit history', async () => {
  const queryTarget = createFakeQueryTarget([
    { rows: [templateRow()] },
    { rows: [{
      id: '9', template_id: '4', revision_no: '2', status: 'published',
      change_summary: 'Updated design ranges',
      content_schema: { schemaVersion: 1, sections: [{ key: 'design_parameters' }] },
      created_by: '7', created_by_display_name: 'Technical Manager',
      submitted_by: '7', submitted_by_display_name: 'Technical Manager', submitted_at: '2026-09-02T01:20:00.000Z',
      published_by: '7', published_by_display_name: 'Technical Manager', published_at: '2026-09-02T02:00:00.000Z',
      retired_by: null, retired_by_display_name: null, retired_at: null,
      created_at: '2026-09-02T01:00:00.000Z', updated_at: '2026-09-02T02:00:00.000Z'
    }] },
    { rows: [{
      id: '15', template_revision_id: '9', variable_definition_id: '3',
      variable_key: 'design_pressure', label_en: 'Design Pressure', label_zh: '设计压力',
      data_type: 'number', source_field: 'pressure', is_required: true,
      default_value: null, validation_rules: { min: 0, max: 16 }, sort_order: '1',
      created_by: '7', updated_by: '7', created_at: '2026-09-02T01:00:00.000Z', updated_at: '2026-09-02T01:00:00.000Z'
    }] },
    { rows: [{
      id: '21', template_id: '4', entity_type: 'revision', entity_id: '9', event_type: 'published',
      from_status: 'review_pending', to_status: 'published', actor_user_id: '7',
      actor_display_name: 'Technical Manager', details: {}, created_at: '2026-09-02T02:00:00.000Z'
    }] }
  ]);
  const repository = createTechnicalTemplateRepository(queryTarget);

  const template = await repository.getTemplateDetail(4);

  assert.equal(template.revisions[0].revisionLabel, 'TPL-R2');
  assert.equal(template.revisions[0].variables[0].variableKey, 'design_pressure');
  assert.deepEqual(template.revisions[0].variables[0].validationRules, { min: 0, max: 16 });
  assert.equal(template.events[0].actorDisplayName, 'Technical Manager');
  assert.match(queryTarget.queries[2].sql, /technical_agreement_revision_variables/);
  assert.match(queryTarget.queries[3].sql, /technical_template_events/);
});

test('repository creates a template and its first structured draft atomically', async () => {
  const queryTarget = createFakeQueryTarget([{ rows: [{ id: '4', revision_id: '8' }] }]);
  const repository = createTechnicalTemplateRepository(queryTarget);
  const contentSchema = { schemaVersion: 1, sections: [{ key: 'project_basis' }] };

  const created = await repository.createTemplate({
    templateCode: 'RX-1',
    name: 'Reactor Agreement',
    productFamily: 'Reactor',
    productModel: null,
    application: null,
    language: 'en',
    changeSummary: 'Initial revision',
    contentSchema
  }, 7);

  assert.deepEqual(created, { id: 4, revisionId: 8 });
  assert.match(queryTarget.queries[0].sql, /WITH inserted_template AS/);
  assert.match(queryTarget.queries[0].sql, /INSERT INTO technical_agreement_template_revisions/);
  assert.match(queryTarget.queries[0].sql, /INSERT INTO technical_template_events/);
  assert.equal(queryTarget.queries[0].params[8], JSON.stringify(contentSchema));
});

test('repository clones the latest immutable revision and its variable snapshots', async () => {
  const queryTarget = createFakeQueryTarget([{ rows: [{ id: '10', template_id: '4', revision_no: '3' }] }]);
  const repository = createTechnicalTemplateRepository(queryTarget);

  const revision = await repository.createRevision(4, 'Customer application update', 7);

  assert.deepEqual(revision, { id: 10, templateId: 4, revisionNo: 3 });
  assert.match(queryTarget.queries[0].sql, /NOT EXISTS/);
  assert.match(queryTarget.queries[0].sql, /copied_variables AS/);
  assert.match(queryTarget.queries[0].sql, /rv\.variable_key/);
  assert.deepEqual(queryTarget.queries[0].params, [4, 'Customer application update', 7]);
});

test('publishing a template revision retires the former current revision and updates the master', async () => {
  const queryTarget = createFakeQueryTarget([{ rows: [{ id: '10', template_id: '4' }] }]);
  const repository = createTechnicalTemplateRepository(queryTarget);

  const published = await repository.publishRevision(10, 7);

  assert.deepEqual(published, { id: 10, templateId: 4 });
  assert.match(queryTarget.queries[0].sql, /old_revision\.status = 'published'/);
  assert.match(queryTarget.queries[0].sql, /current_published_revision_id = published\.id/);
  assert.match(queryTarget.queries[0].sql, /'review_pending', 'published'/);
  assert.deepEqual(queryTarget.queries[0].params, [10, 7]);
});

test('revision variable upsert copies approved catalogue fields into the revision snapshot', async () => {
  const queryTarget = createFakeQueryTarget([{ rows: [{
    id: '12', template_revision_id: '10', variable_definition_id: '3',
    variable_key: 'capacity', label_en: 'Capacity', label_zh: '处理能力',
    data_type: 'number', source_field: 'capacity', section_key: 'design_parameters', is_required: true,
    default_value: '1000', validation_rules: { min: 1 }, sort_order: '2',
    created_by: '7', updated_by: '7', created_at: '2026-09-02', updated_at: '2026-09-02'
  }] }]);
  const repository = createTechnicalTemplateRepository(queryTarget);

  const saved = await repository.upsertRevisionVariable(10, {
    variableDefinitionId: 3,
    sectionKey: 'design_parameters',
    isRequired: true,
    defaultValue: '1000',
    validationRules: { min: 1 },
    sortOrder: 2
  }, 7);

  assert.equal(saved.variableKey, 'capacity');
  assert.equal(saved.templateRevisionId, 10);
  assert.match(queryTarget.queries[0].sql, /d\.is_active = true/);
  assert.match(queryTarget.queries[0].sql, /variable_key = EXCLUDED\.variable_key/);
  assert.deepEqual(queryTarget.queries[0].params, [10, 3, 'design_parameters', true, '1000', '{"min":1}', 2, 7]);
});

test('standard clause revisions use controlled status transitions', async () => {
  const queryTarget = createFakeQueryTarget([
    { rows: [{
      id: '30', clause_code: 'FAT-01', revision_no: '1', title: 'Factory acceptance test',
      language: 'en', product_family: 'Mixer', product_model: null, application: null,
      content: 'Documented FAT required.', condition_schema: { all: [] }, status: 'draft',
      change_summary: 'Initial', created_by: '7', created_by_display_name: 'Technical Manager',
      submitted_by: null, submitted_at: null, published_by: null, published_at: null,
      retired_by: null, retired_at: null, created_at: '2026-09-02', updated_at: '2026-09-02'
    }] },
    { rows: [{
      id: '30', clause_code: 'FAT-01', revision_no: '1', title: 'Factory acceptance test',
      language: 'en', product_family: 'Mixer', product_model: null, application: null,
      content: 'Documented FAT required.', condition_schema: { all: [] }, status: 'published',
      change_summary: 'Initial', created_by: '7', created_by_display_name: 'Technical Manager',
      submitted_by: '7', submitted_at: '2026-09-02', published_by: '7', published_at: '2026-09-02',
      retired_by: null, retired_at: null, created_at: '2026-09-02', updated_at: '2026-09-02'
    }] }
  ]);
  const repository = createTechnicalTemplateRepository(queryTarget);

  const submitted = await repository.submitClause(30, 7);
  const published = await repository.publishClause(30, 7);

  assert.equal(submitted.revisionLabel, 'FAT-01-R1');
  assert.equal(published.status, 'published');
  assert.match(queryTarget.queries[0].sql, /status = 'review_pending'/);
  assert.match(queryTarget.queries[1].sql, /old_clause\.status = 'published'/);
  assert.match(queryTarget.queries[1].sql, /status = 'published'/);
});
