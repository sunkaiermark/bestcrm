import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { migrate } from '../../src/db/migrate.mjs';
import { createDevelopmentRepository } from '../../src/repositories/developmentRepository.mjs';
import { createDevelopmentTopicDraft } from '../../src/services/developmentTopicService.mjs';

const databaseUrl = process.env.DEVELOPMENT_P3A_TEST_DATABASE_URL;

test('P3a research drafts are versioned, blocked and immutable without publishing', {
  skip: !databaseUrl ? 'Set DEVELOPMENT_P3A_TEST_DATABASE_URL to an isolated local test database' : false
}, async () => {
  const parsed = new URL(databaseUrl);
  assert.equal(parsed.hostname, '127.0.0.1');
  assert.match(parsed.pathname, /^\/bestcrm_npd_p3a_[a-z0-9_]+$/);
  const pool = new pg.Pool({ connectionString: databaseUrl });
  try {
    await migrate(pool);
    await migrate(pool);
    const applied = await pool.query(`
      SELECT count(*)::integer AS n FROM schema_migrations
      WHERE name = '086_development_research_draft_foundation.sql'
    `);
    assert.equal(applied.rows[0].n, 1);
    const suffix = randomUUID().replaceAll('-', '').slice(0, 10);
    async function user(label) {
      const result = await pool.query(`
        INSERT INTO users (username, password_hash, display_name)
        VALUES ($1, 'isolated-test-only', $2) RETURNING id
      `, [`npd_p3a_${label}_${suffix}`, label]);
      return Number(result.rows[0].id);
    }
    const ownerId = await user('owner');
    const outsiderId = await user('outsider');
    const topic = await createDevelopmentTopicDraft(createDevelopmentRepository(pool),
      { id: ownerId, isActive: true }, {
        title: `Research ${suffix}`, sourceType: 'internal_research', directions: []
      });
    await assert.rejects(pool.query(`
      INSERT INTO development_materials
        (topic_id, title, category_code, created_by_user_id)
      VALUES ($1, 'Competitor note', 'competitor_analysis', $2)
    `, [topic.id, outsiderId]), /Only an active topic member/);
    const material = await pool.query(`
      INSERT INTO development_materials (
        topic_id, title, category_code, source_reference, created_by_user_id
      ) VALUES ($1, 'Bench test', 'experiment_data', 'Lab notebook 1', $2)
      RETURNING id
    `, [topic.id, ownerId]);
    const materialId = Number(material.rows[0].id);
    await assert.rejects(pool.query(`
      INSERT INTO development_material_versions (
        material_id, version_no, original_filename, stored_path, mime_type,
        file_size, sha256, recorded_by_user_id
      ) VALUES ($1, 2, 'bench.csv', 'development/bench.csv', 'text/csv', 3, $2, $3)
    `, [materialId, 'a'.repeat(64), ownerId]), /version must be sequential/);
    await assert.rejects(pool.query(`
      INSERT INTO development_material_versions (
        material_id, version_no, original_filename, stored_path, mime_type,
        file_size, sha256, recorded_by_user_id
      ) VALUES ($1, 1, 'bench.csv', '../secret.csv', 'text/csv', 3, $2, $3)
    `, [materialId, 'a'.repeat(64), ownerId]), /check constraint/);
    const firstVersion = await pool.query(`
      INSERT INTO development_material_versions (
        material_id, version_no, original_filename, stored_path, mime_type,
        file_size, sha256, recorded_by_user_id
      ) VALUES ($1, 1, 'bench.csv', $2, 'text/csv', 3, $3, $4)
      RETURNING id, access_policy_state
    `, [materialId, `development/test/${suffix}/bench-v1.csv`, 'a'.repeat(64), ownerId]);
    assert.equal(firstVersion.rows[0].access_policy_state, 'blocked_pending_policy');
    await assert.rejects(pool.query(`
      UPDATE development_material_versions SET sha256 = $2 WHERE id = $1
    `, [firstVersion.rows[0].id, 'b'.repeat(64)]), /immutable/);
    await assert.rejects(pool.query(`
      DELETE FROM development_material_versions WHERE id = $1
    `, [firstVersion.rows[0].id]), /immutable/);
    await assert.rejects(pool.query(`
      INSERT INTO development_material_versions (
        material_id, version_no, original_filename, stored_path, mime_type,
        file_size, sha256, access_policy_state, recorded_by_user_id
      ) VALUES ($1, 2, 'bench-v2.csv', $2, 'text/csv', 3, $3, 'public', $4)
    `, [materialId, `development/test/${suffix}/bench-v2.csv`, 'b'.repeat(64), ownerId]),
    /check constraint/);
    const secondVersion = await pool.query(`
      INSERT INTO development_material_versions (
        material_id, version_no, original_filename, stored_path, mime_type,
        file_size, sha256, recorded_by_user_id
      ) VALUES ($1, 2, 'bench-v2.csv', $2, 'text/csv', 3, $3, $4)
      RETURNING id
    `, [materialId, `development/test/${suffix}/bench-v2.csv`, 'b'.repeat(64), ownerId]);
    assert.ok(Number(secondVersion.rows[0].id) > Number(firstVersion.rows[0].id));

    const outcome = await pool.query(`
      INSERT INTO development_outcome_revisions (
        topic_id, revision_no, outcome_kind, title, finding,
        applicability, limitations, evidence_references, authored_by_user_id
      ) VALUES ($1, 1, 'technical_result', 'Seal result', 'Bench passed',
        'Only at stated viscosity', 'Not validated at scale', '["Lab notebook 1"]'::jsonb, $2)
      RETURNING id, access_policy_state
    `, [topic.id, ownerId]);
    assert.equal(outcome.rows[0].access_policy_state, 'blocked_pending_policy');
    await assert.rejects(pool.query(`
      INSERT INTO development_outcome_revisions (
        topic_id, revision_no, outcome_kind, title, finding,
        applicability, limitations, authored_by_user_id
      ) VALUES ($1, 3, 'lesson_learned', 'Wrong seal', 'Wear', 'Trial only', 'No field data', $2)
    `, [topic.id, ownerId]), /revision must be sequential/);
    const corrected = await pool.query(`
      INSERT INTO development_outcome_revisions (
        topic_id, revision_no, outcome_kind, title, finding,
        applicability, limitations, authored_by_user_id
      ) VALUES ($1, 2, 'lesson_learned', 'Seal lesson', 'Wear observed',
        'Trial only', 'Not suitable for reuse yet', $2) RETURNING id
    `, [topic.id, ownerId]);
    await assert.rejects(pool.query(`
      INSERT INTO development_asset_candidates
        (outcome_revision_id, rationale, proposed_by_user_id)
      VALUES ($1, 'Candidate', $2)
    `, [outcome.rows[0].id, ownerId]), /Only the current outcome revision/);
    const candidate = await pool.query(`
      INSERT INTO development_asset_candidates
        (outcome_revision_id, rationale, proposed_by_user_id)
      VALUES ($1, 'Keep as a cautionary lesson', $2) RETURNING id
    `, [corrected.rows[0].id, ownerId]);
    assert.ok(Number(candidate.rows[0].id) > 0);
    await assert.rejects(pool.query(`
      DELETE FROM development_asset_candidates WHERE id = $1
    `, [candidate.rows[0].id]), /immutable/);
    const published = await pool.query(`
      SELECT to_regclass('development_assets') AS table_name
    `);
    assert.equal(published.rows[0].table_name, null);
    const events = await pool.query(`
      SELECT event_type FROM development_events WHERE topic_id = $1
    `, [topic.id]);
    for (const name of ['research_material_registered',
      'research_material_version_registered', 'outcome_revision_created',
      'asset_candidate_proposed']) {
      assert.ok(events.rows.some((row) => row.event_type === name));
    }
  } finally {
    await pool.end();
  }
});
