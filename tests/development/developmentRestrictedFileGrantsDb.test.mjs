import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { migrate } from '../../src/db/migrate.mjs';
import { createDevelopmentRepository } from '../../src/repositories/developmentRepository.mjs';
import { createDevelopmentTopicDraft } from '../../src/services/developmentTopicService.mjs';

const databaseUrl = process.env.DEVELOPMENT_P3C_TEST_DATABASE_URL;

test('P3c restricted file grants are owner-only, topic-scoped and membership-bound', {
  skip: !databaseUrl ? 'Set DEVELOPMENT_P3C_TEST_DATABASE_URL to an isolated local test database' : false
}, async () => {
  const parsed = new URL(databaseUrl);
  assert.equal(parsed.hostname, '127.0.0.1');
  assert.match(parsed.pathname, /^\/bestcrm_npd_p3c_[a-z0-9_]+$/);
  const pool = new pg.Pool({ connectionString: databaseUrl });
  try {
    await migrate(pool);
    await migrate(pool);
    const applied = await pool.query(`
      SELECT count(*)::integer AS n FROM schema_migrations
      WHERE name = '088_development_restricted_file_grants.sql'
    `);
    assert.equal(applied.rows[0].n, 1);
    const suffix = randomUUID().replaceAll('-', '').slice(0, 10);
    async function user(label) {
      const row = await pool.query(`
        INSERT INTO users (username, password_hash, display_name)
        VALUES ($1, 'isolated-test-only', $2) RETURNING id
      `, [`npd_p3c_${label}_${suffix}`, label]);
      return { id: Number(row.rows[0].id), isActive: true, roles: [] };
    }
    const owner = await user('owner');
    const member = await user('member');
    const outsider = await user('outsider');
    const inactiveMember = await user('inactive_member');
    const newOwner = await user('new_owner');
    const topics = createDevelopmentRepository(pool);
    const topic = await createDevelopmentTopicDraft(topics, owner, {
      title: `Research access ${suffix}`, sourceType: 'internal_research', directions: []
    });
    const secondTopic = await createDevelopmentTopicDraft(topics, outsider, {
      title: `Unrelated access ${suffix}`, sourceType: 'internal_research', directions: []
    });
    for (const actor of [member, inactiveMember, newOwner]) {
      assert.equal(await topics.addMember({ topicId: topic.id, userId: actor.id,
        responsibilityCode: 'researcher', actorUserId: owner.id }), true);
    }
    const memberRow = await pool.query(`
      SELECT id FROM development_memberships WHERE topic_id = $1
        AND user_id = $2 AND ended_at IS NULL
    `, [topic.id, member.id]);
    const memberMembershipId = Number(memberRow.rows[0].id);
    const inactiveRow = await pool.query(`
      SELECT id FROM development_memberships WHERE topic_id = $1
        AND user_id = $2 AND ended_at IS NULL
    `, [topic.id, inactiveMember.id]);
    await pool.query('UPDATE users SET is_active = false WHERE id = $1', [inactiveMember.id]);
    const material = await pool.query(`
      INSERT INTO development_materials
        (topic_id, title, category_code, created_by_user_id)
      VALUES ($1, 'Restricted experiment', 'test_data', $2) RETURNING id
    `, [topic.id, owner.id]);
    const materialId = Number(material.rows[0].id);
    const version = await pool.query(`
      INSERT INTO development_material_versions (
        material_id, version_no, original_filename, stored_path,
        mime_type, file_size, sha256, recorded_by_user_id
      ) VALUES ($1, 1, 'test.pdf', $2, 'application/pdf', 25, $3, $4)
      RETURNING id
    `, [materialId, `development/${topic.id}/${randomUUID()}`,
      'a'.repeat(64), owner.id]);
    const versionId = Number(version.rows[0].id);
    async function grant(membershipId, actorId, reason = 'Controlled collaboration') {
      return pool.query(`
        INSERT INTO development_restricted_file_grants (
          material_version_id, grantee_membership_id,
          granted_by_owner_user_id, reason
        ) VALUES ($1, $2, $3, $4) RETURNING id
      `, [versionId, membershipId, actorId, reason]);
    }
    async function revoke(grantId, actorId) {
      return pool.query(`
        INSERT INTO development_restricted_file_grant_revocations (
          grant_id, revoked_by_owner_user_id, reason
        ) VALUES ($1, $2, 'Access no longer required') RETURNING id
      `, [grantId, actorId]);
    }
    async function hasGrant(actorId) {
      const result = await pool.query(`
        SELECT bestcrm_development_has_restricted_file_grant($1, $2) AS allowed
      `, [versionId, actorId]);
      return result.rows[0].allowed;
    }
    const outsiderMembership = await pool.query(`
      SELECT id FROM development_memberships WHERE topic_id = $1 AND user_id = $2
    `, [secondTopic.id, outsider.id]);
    await assert.rejects(grant(memberMembershipId, member.id), /Only the active topic owner/);
    await assert.rejects(grant(outsiderMembership.rows[0].id, owner.id),
      /active member of the same topic/);
    await assert.rejects(grant(inactiveRow.rows[0].id, owner.id),
      /active member of the same topic/);
    const first = await grant(memberMembershipId, owner.id);
    const grantId = Number(first.rows[0].id);
    assert.equal(await hasGrant(member.id), true);
    assert.equal(await hasGrant(outsider.id), false);
    await assert.rejects(grant(memberMembershipId, owner.id), /active grant already exists/);
    await assert.rejects(revoke(grantId, member.id), /Only the active topic owner/);
    await revoke(grantId, owner.id);
    assert.equal(await hasGrant(member.id), false);
    await assert.rejects(revoke(grantId, owner.id), /unique constraint/);
    const second = await grant(memberMembershipId, owner.id, 'Reapproved after review');
    assert.ok(Number(second.rows[0].id) > grantId);
    assert.equal(await hasGrant(member.id), true);
    await pool.query(`
      UPDATE development_memberships SET ended_at = now(), ended_by_user_id = $3
      WHERE topic_id = $1 AND user_id = $2 AND ended_at IS NULL
    `, [topic.id, member.id, owner.id]);
    assert.equal(await hasGrant(member.id), false);
    await assert.rejects(grant(memberMembershipId, owner.id),
      /active member of the same topic/);
    assert.equal(await topics.addMember({ topicId: topic.id, userId: member.id,
      responsibilityCode: 'rejoined', actorUserId: owner.id }), true);
    const newMembership = await pool.query(`
      SELECT id FROM development_memberships WHERE topic_id = $1 AND user_id = $2
        AND ended_at IS NULL
    `, [topic.id, member.id]);
    assert.notEqual(Number(newMembership.rows[0].id), memberMembershipId);
    assert.equal(await hasGrant(member.id), false);
    const third = await grant(newMembership.rows[0].id, owner.id);
    assert.ok(Number(third.rows[0].id) > Number(second.rows[0].id));
    assert.equal(await hasGrant(member.id), true);
    await pool.query(`
      UPDATE development_topics SET owner_user_id = $2,
        updated_by_user_id = $2, updated_at = now(), row_version = row_version + 1
      WHERE id = $1
    `, [topic.id, newOwner.id]);
    await assert.rejects(revoke(third.rows[0].id, owner.id),
      /Only the active topic owner/);
    await revoke(third.rows[0].id, newOwner.id);
    assert.equal(await hasGrant(member.id), false);
    await assert.rejects(pool.query(`
      UPDATE development_restricted_file_grants SET reason = 'rewrite' WHERE id = $1
    `, [grantId]), /immutable/);
    await assert.rejects(pool.query(`
      DELETE FROM development_restricted_file_grant_revocations WHERE grant_id = $1
    `, [grantId]), /immutable/);
    const events = await pool.query(`
      SELECT event_type FROM development_events WHERE topic_id = $1
        AND event_type LIKE 'restricted_file_access_%' ORDER BY id
    `, [topic.id]);
    assert.deepEqual(events.rows.map((row) => row.event_type), [
      'restricted_file_access_granted', 'restricted_file_access_revoked',
      'restricted_file_access_granted', 'restricted_file_access_granted',
      'restricted_file_access_revoked'
    ]);
    const activation = await pool.query(`
      SELECT to_regclass('development_material_file_activations') AS object
    `);
    assert.equal(activation.rows[0].object, 'development_material_file_activations');
    const blockedRead = await pool.query(`
      SELECT bestcrm_development_can_read_material_version($1, $2) AS allowed
    `, [versionId, member.id]);
    assert.equal(blockedRead.rows[0].allowed, false);
  } finally {
    await pool.end();
  }
});
