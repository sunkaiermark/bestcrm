import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  normalizeDevelopmentTopicDraft,
  DEVELOPMENT_DIRECTIONS
} from '../../src/domain/developmentTopics.mjs';
import {
  canCreateDevelopmentTopic,
  createDevelopmentTopicDraft
} from '../../src/services/developmentTopicService.mjs';
import { createDevelopmentRepository } from '../../src/repositories/developmentRepository.mjs';

const migrationUrl = new URL('../../src/db/migrations/083_development_foundation.sql', import.meta.url);

test('P1 migration keeps NPD independent, multi-linked, and its history append-only', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  for (const table of [
    'development_topics', 'development_topic_directions', 'development_memberships',
    'development_opportunity_links', 'development_concept_revisions',
    'development_concept_submissions', 'development_concept_decisions', 'development_events'
  ]) {
    assert.match(sql, new RegExp(`CREATE TABLE ${table} \\(`));
  }
  assert.match(sql, /CREATE SEQUENCE development_topic_number_seq/);
  assert.match(sql, /'NPD-' \|\| nextval/);
  assert.match(sql, /development_opportunity_links_active_pair_idx[\s\S]*ON development_opportunity_links \(topic_id, opportunity_id\)[\s\S]*WHERE unlinked_at IS NULL/);
  assert.match(sql, /development_topic_directions_active_pair_idx/);
  assert.match(sql, /ON DELETE RESTRICT/);
  assert.match(sql, /BEFORE UPDATE OR DELETE ON development_concept_revisions/);
  assert.match(sql, /BEFORE UPDATE OR DELETE ON development_events/);
  assert.match(sql, /BEFORE UPDATE OR DELETE ON development_memberships/);
  assert.match(sql, /BEFORE UPDATE OR DELETE ON development_opportunity_links/);
  assert.match(sql, /role\.code = 'technical_manager'/);
  assert.match(sql, /role\.is_active = true/);
  assert.doesNotMatch(sql, /REFERENCES attachments\(/);
  assert.doesNotMatch(sql, /ON DELETE CASCADE/);
});

test('topic draft accepts independent multi-direction ideas but not unknown categories', () => {
  const normalized = normalizeDevelopmentTopicDraft({
    title: '  New process equipment  ',
    sourceType: 'customer_idea',
    problemStatement: '  Reduce downtime  ',
    directions: ['key_equipment', 'process_technology', 'key_equipment']
  });
  assert.deepEqual(normalized, {
    title: 'New process equipment',
    sourceType: 'customer_idea',
    problemStatement: 'Reduce downtime',
    directions: ['key_equipment', 'process_technology']
  });
  assert.equal(DEVELOPMENT_DIRECTIONS.length, 3);
  assert.throws(() => normalizeDevelopmentTopicDraft({
    title: 'Idea', sourceType: 'customer_idea', directions: ['mixers']
  }), /Invalid development direction/);
  assert.throws(() => normalizeDevelopmentTopicDraft({
    title: ' ', sourceType: 'customer_idea', directions: []
  }), /title/);
});

test('all active employees may create topics regardless of role, but inactive accounts may not', () => {
  assert.equal(canCreateDevelopmentTopic({ id: 9, isActive: true, roles: ['salesperson'] }), true);
  assert.equal(canCreateDevelopmentTopic({ id: 10, isActive: true, roles: ['technical_manager'] }), true);
  assert.equal(canCreateDevelopmentTopic({ id: 11, isActive: true, roles: [] }), true);
  assert.equal(canCreateDevelopmentTopic({ id: 12, isActive: false, roles: ['administrator'] }), false);
});

test('unwired P1 service assigns the creator as owner and rejects an inactive actor', async () => {
  const writes = [];
  const repository = {
    async createTopic(input) {
      writes.push(input);
      return { id: 1, ...input };
    }
  };
  await assert.rejects(() => createDevelopmentTopicDraft(repository, {
    id: 9, isActive: false
  }, {
    title: 'Idea', sourceType: 'customer_idea', directions: []
  }), /active user/);
  assert.equal(writes.length, 0);

  const created = await createDevelopmentTopicDraft(repository, { id: 9, isActive: true }, {
    title: 'Idea', sourceType: 'internal_research', directions: ['implementation_support']
  });
  assert.equal(created.actorUserId, 9);
  assert.equal(writes[0].opportunityId, undefined);
});

test('repository creates topic, directions and owner membership on one transaction client', async () => {
  const queries = [];
  const client = {
    async query(sql, params = []) {
      queries.push({ sql: String(sql), params });
      if (String(sql).includes('INSERT INTO development_topics')) {
        return { rows: [{
          id: '12', topic_no: 'NPD-1', title: 'Idea', source_type: 'internal_research',
          problem_statement: '', phase: 'idea', result: null, owner_user_id: '9',
          row_version: '1', created_at: new Date(), updated_at: new Date()
        }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    },
    release() { queries.push({ sql: 'RELEASE' }); }
  };
  const pool = { async connect() { return client; } };
  const repository = createDevelopmentRepository(pool);
  const created = await repository.createTopic({
    title: 'Idea', sourceType: 'internal_research', problemStatement: '',
    actorUserId: 9, directions: ['key_equipment', 'process_technology']
  });
  assert.equal(created.topicNo, 'NPD-1');
  assert.equal(created.ownerUserId, 9);
  assert.deepEqual(queries.map(({ sql }) => sql.trim().split(/\s+/)[0]), [
    'BEGIN', 'INSERT', 'INSERT', 'INSERT', 'INSERT', 'COMMIT', 'RELEASE'
  ]);
  assert.match(queries[4].sql, /INSERT INTO development_memberships/);
});
