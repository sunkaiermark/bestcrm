import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { migrate } from '../../src/db/migrate.mjs';
import { createDevelopmentRepository } from '../../src/repositories/developmentRepository.mjs';
import { createDevelopmentTopicDraft } from '../../src/services/developmentTopicService.mjs';

const databaseUrl = process.env.DEVELOPMENT_P1_TEST_DATABASE_URL;

test('P1 relational constraints and audit survive isolated PostgreSQL migration', {
  skip: !databaseUrl ? 'Set DEVELOPMENT_P1_TEST_DATABASE_URL to an isolated local test database' : false
}, async () => {
  const parsed = new URL(databaseUrl);
  assert.equal(parsed.hostname, '127.0.0.1');
  assert.match(parsed.pathname, /^\/bestcrm_npd_p1_[a-z0-9_]+$/);
  const pool = new pg.Pool({ connectionString: databaseUrl });
  try {
    const identity = await pool.query('SELECT current_database() AS name');
    assert.equal(identity.rows[0].name, parsed.pathname.slice(1));
    await migrate(pool);
    await migrate(pool);
    const migration = await pool.query(`
      SELECT count(*)::integer AS n FROM schema_migrations
      WHERE name = '083_development_foundation.sql'
    `);
    assert.equal(migration.rows[0].n, 1);

    const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
    const sales = await pool.query(`
      INSERT INTO users (username, password_hash, display_name)
      VALUES ($1, 'isolated-test-only', 'Development Sales') RETURNING id
    `, [`npd_sales_${suffix}`]);
    const manager = await pool.query(`
      INSERT INTO users (username, password_hash, display_name)
      VALUES ($1, 'isolated-test-only', 'Development Technical Manager') RETURNING id
    `, [`npd_manager_${suffix}`]);
    const salesId = Number(sales.rows[0].id);
    const managerId = Number(manager.rows[0].id);
    const role = await pool.query(`
      INSERT INTO roles (code, name) VALUES ('technical_manager', 'Technical Manager')
      ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name RETURNING id
    `);
    await pool.query(`
      INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)
    `, [managerId, role.rows[0].id]);

    const repository = createDevelopmentRepository(pool);
    const actor = { id: salesId, isActive: true };
    const topicA = await createDevelopmentTopicDraft(repository, actor, {
      title: `P1 isolated test ${suffix}`,
      sourceType: 'customer_idea',
      directions: ['key_equipment', 'process_technology', 'key_equipment']
    });
    const topicB = await createDevelopmentTopicDraft(repository, actor, {
      title: `P1 second topic ${suffix}`,
      sourceType: 'product_upgrade',
      directions: ['implementation_support']
    });
    assert.match(topicA.topicNo, /^NPD-[1-9][0-9]*$/);
    assert.notEqual(topicA.topicNo, topicB.topicNo);
    assert.equal(topicA.phase, 'idea');
    assert.equal(topicA.result, null);
    const loaded = await repository.findTopicById(topicA.id);
    assert.deepEqual(loaded.directions, ['key_equipment', 'process_technology']);

    const membership = await pool.query(`
      SELECT count(*)::integer AS n FROM development_memberships
      WHERE topic_id = $1 AND user_id = $2 AND ended_at IS NULL
    `, [topicA.id, salesId]);
    assert.equal(membership.rows[0].n, 1);
    assert.equal(await repository.addMember({
      topicId: topicA.id, userId: managerId,
      responsibilityCode: 'contributor', actorUserId: salesId
    }), true);
    assert.equal(await repository.addMember({
      topicId: topicA.id, userId: managerId,
      responsibilityCode: 'contributor', actorUserId: salesId
    }), false);

    const customer = await pool.query(`
      INSERT INTO customers (name, owner_user_id)
      VALUES ($1, $2) RETURNING id
    `, [`P1 test customer ${suffix}`, salesId]);
    const opportunity = await pool.query(`
      INSERT INTO opportunities (
        opportunity_no, title, customer_id, requirement, status, salesperson_id
      ) VALUES ($1, 'P1 test opportunity', $2, 'Test only', 'draft', $3)
      RETURNING id
    `, [`NPD-ISOLATED-OPP-${suffix}`, customer.rows[0].id, salesId]);
    const opportunityId = Number(opportunity.rows[0].id);
    assert.equal(await repository.linkOpportunity({
      topicId: topicA.id, opportunityId, actorUserId: salesId
    }), true);
    assert.equal(await repository.linkOpportunity({
      topicId: topicA.id, opportunityId, actorUserId: salesId
    }), false);
    assert.equal(await repository.linkOpportunity({
      topicId: topicB.id, opportunityId, actorUserId: salesId
    }), true);
    const secondOpportunity = await pool.query(`
      INSERT INTO opportunities (
        opportunity_no, title, customer_id, requirement, status, salesperson_id
      ) VALUES ($1, 'P1 second opportunity', $2, 'Test only', 'draft', $3)
      RETURNING id
    `, [`NPD-ISOLATED-OPP-2-${suffix}`, customer.rows[0].id, salesId]);
    assert.equal(await repository.linkOpportunity({
      topicId: topicA.id, opportunityId: Number(secondOpportunity.rows[0].id),
      actorUserId: salesId
    }), true);
    await assert.rejects(repository.linkOpportunity({
      topicId: topicA.id, opportunityId: 999999999,
      actorUserId: salesId
    }), /foreign key/);

    const revision = await pool.query(`
      INSERT INTO development_concept_revisions (
        topic_id, revision_no, snapshot, snapshot_sha256, authored_by_user_id
      ) VALUES ($1, 1, '{"problem":"test only"}'::jsonb, $2, $3)
      RETURNING id
    `, [topicA.id, 'a'.repeat(64), salesId]);
    const revisionId = Number(revision.rows[0].id);
    await assert.rejects(pool.query(`
      UPDATE development_concept_revisions SET snapshot = '{}'::jsonb WHERE id = $1
    `, [revisionId]), /immutable/);
    await assert.rejects(pool.query(`
      INSERT INTO development_concept_revisions (
        topic_id, revision_no, snapshot, snapshot_sha256, authored_by_user_id
      ) VALUES ($1, 1, '{}'::jsonb, $2, $3)
    `, [topicA.id, 'b'.repeat(64), salesId]), /duplicate key/);
    const submission = await pool.query(`
      INSERT INTO development_concept_submissions (revision_id, submitted_by_user_id)
      VALUES ($1, $2) RETURNING id
    `, [revisionId, salesId]);
    const submissionId = Number(submission.rows[0].id);
    // P2 adds a gate: a decision is legal only while this exact revision is
    // the current submitted concept and the topic is awaiting review.
    await pool.query(`
      UPDATE development_topics
      SET phase = 'concept_review', row_version = row_version + 1,
          updated_by_user_id = $2, updated_at = now()
      WHERE id = $1
    `, [topicA.id, salesId]);
    await assert.rejects(pool.query(`
      INSERT INTO development_concept_decisions (
        submission_id, decision_code, reason, decided_by_user_id, idempotency_key
      ) VALUES ($1, 'approved', 'test', $2, $3)
    `, [submissionId, salesId, `sales-${suffix}`]), /Only an active technical manager/);
    await pool.query(`
      INSERT INTO development_concept_decisions (
        submission_id, decision_code, reason, decided_by_user_id, idempotency_key
      ) VALUES ($1, 'revise_required', 'Test direction', $2, $3)
    `, [submissionId, managerId, `manager-${suffix}`]);
    await assert.rejects(pool.query(`
      INSERT INTO development_concept_decisions (
        submission_id, decision_code, reason, decided_by_user_id, idempotency_key
      ) VALUES ($1, 'approved', 'again', $2, $3)
    `, [submissionId, managerId, `again-${suffix}`]), /duplicate key/);

    const events = await pool.query(`
      SELECT event_type, metadata FROM development_events
      WHERE topic_id = $1 ORDER BY id
    `, [topicA.id]);
    assert.deepEqual(events.rows.map(({ event_type }) => event_type), [
      'topic_created', 'direction_added', 'direction_added', 'member_added',
      'member_added', 'opportunity_linked', 'opportunity_linked', 'concept_revision_created',
      'concept_submitted', 'topic_updated', 'concept_decided'
    ]);
    assert.equal(JSON.stringify(events.rows).includes('test only'), false);
    await assert.rejects(pool.query(`
      DELETE FROM development_events WHERE topic_id = $1
    `, [topicA.id]), /immutable/);

    await assert.rejects(pool.query(`
      DELETE FROM development_opportunity_links
      WHERE topic_id = $1 AND opportunity_id = $2
    `, [topicA.id, opportunityId]), /cannot be deleted/);
    await pool.query(`
      UPDATE development_opportunity_links
      SET unlinked_at = now(), unlinked_by_user_id = $3
      WHERE topic_id = $1 AND opportunity_id = $2 AND unlinked_at IS NULL
    `, [topicA.id, opportunityId, salesId]);
    assert.equal(await repository.linkOpportunity({
      topicId: topicA.id, opportunityId, actorUserId: salesId
    }), true);
    const linkHistory = await pool.query(`
      SELECT count(*)::integer AS n FROM development_opportunity_links
      WHERE topic_id = $1 AND opportunity_id = $2
    `, [topicA.id, opportunityId]);
    assert.equal(linkHistory.rows[0].n, 2);

    await pool.query(`
      UPDATE development_memberships
      SET ended_at = now(), ended_by_user_id = $3
      WHERE topic_id = $1 AND user_id = $2 AND ended_at IS NULL
    `, [topicA.id, managerId, salesId]);
    assert.equal(await repository.addMember({
      topicId: topicA.id, userId: managerId,
      responsibilityCode: 'contributor', actorUserId: salesId
    }), true);
    await pool.query(`
      UPDATE development_topic_directions
      SET removed_at = now(), removed_by_user_id = $3
      WHERE topic_id = $1 AND direction_code = $2 AND removed_at IS NULL
    `, [topicA.id, 'key_equipment', salesId]);
    await pool.query(`
      INSERT INTO development_topic_directions (
        topic_id, direction_code, added_by_user_id
      ) VALUES ($1, 'key_equipment', $2)
    `, [topicA.id, salesId]);
    assert.deepEqual((await repository.findTopicById(topicA.id)).directions,
      ['key_equipment', 'process_technology']);
    await pool.query(`
      UPDATE development_topics
      SET phase = 'exploration', row_version = row_version + 1,
          updated_by_user_id = $2, updated_at = now()
      WHERE id = $1
    `, [topicA.id, salesId]);
    await assert.rejects(pool.query(`
      UPDATE development_topics SET phase = 'concluded' WHERE id = $1
    `, [topicA.id]), /next row version/);
    const laterEvents = await pool.query(`
      SELECT event_type FROM development_events WHERE topic_id = $1 ORDER BY id
    `, [topicA.id]);
    for (const eventType of [
      'opportunity_unlinked', 'member_removed', 'direction_removed', 'topic_updated'
    ]) {
      assert.ok(laterEvents.rows.some((row) => row.event_type === eventType));
    }

    await assert.rejects(repository.createTopic({
      title: `Rollback ${suffix}`, sourceType: 'customer_idea',
      problemStatement: '', actorUserId: salesId, directions: ['invalid_direction']
    }), /development_topic_directions_direction_code_check/);
    const rollback = await pool.query(`
      SELECT count(*)::integer AS n FROM development_topics WHERE title = $1
    `, [`Rollback ${suffix}`]);
    assert.equal(rollback.rows[0].n, 0);
  } finally {
    await pool.end();
  }
});
