import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { migrate } from '../../src/db/migrate.mjs';
import { createDevelopmentRepository } from '../../src/repositories/developmentRepository.mjs';
import {
  appendDevelopmentDiscussion, createDevelopmentTopicDraft, endDevelopmentMembership,
  getDevelopmentTopicWorkspace, inviteDevelopmentMember,
  listDevelopmentDiscussion, listDevelopmentTopics
} from '../../src/services/developmentTopicService.mjs';

const databaseUrl = process.env.DEVELOPMENT_P4_TEST_DATABASE_URL;

test('P4 topic visibility and owner-managed membership survive isolated PostgreSQL migration', {
  skip: !databaseUrl ? 'Set DEVELOPMENT_P4_TEST_DATABASE_URL to an isolated local test database' : false
}, async () => {
  const parsed = new URL(databaseUrl);
  assert.equal(parsed.hostname, '127.0.0.1');
  assert.match(parsed.pathname, /^\/bestcrm_npd_p4_[a-z0-9_]+$/);
  const pool = new pg.Pool({ connectionString: databaseUrl });
  try {
    await migrate(pool);
    await migrate(pool);
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
    const ids = [];
    for (const label of ['owner', 'member', 'outsider', 'inactive']) {
      const inserted = await pool.query(`
        INSERT INTO users (username, password_hash, display_name, is_active)
        VALUES ($1, 'isolated-test-only', $2, $3) RETURNING id
      `, [`p4_${label}_${suffix}`, `P4 ${label}`, label !== 'inactive']);
      ids.push(Number(inserted.rows[0].id));
    }
    const [ownerId, memberId, outsiderId, inactiveId] = ids;
    const owner = { id: ownerId, isActive: true };
    const member = { id: memberId, isActive: true };
    const outsider = { id: outsiderId, isActive: true };
    const repository = createDevelopmentRepository(pool);
    const topic = await createDevelopmentTopicDraft(repository, owner, {
      title: `P4 ${suffix}`, sourceType: 'customer_idea',
      problemStatement: 'Independent of opportunities', directions: ['key_equipment']
    });
    assert.equal((await listDevelopmentTopics(repository, owner)).total, 1);
    assert.equal((await listDevelopmentTopics(repository, outsider)).total, 0);
    await assert.rejects(getDevelopmentTopicWorkspace(repository, outsider, topic.id),
      (error) => error.statusCode === 404);
    await assert.rejects(inviteDevelopmentMember(repository, outsider, topic.id,
      { userId: memberId }), (error) => error.statusCode === 404);
    await assert.rejects(inviteDevelopmentMember(repository, owner, topic.id,
      { userId: inactiveId }), (error) => error.statusCode === 422);

    const invited = await inviteDevelopmentMember(repository, owner, topic.id,
      { userId: memberId });
    assert.equal(invited.userId, memberId);
    assert.equal((await listDevelopmentTopics(repository, member)).total, 1);
    const detail = await getDevelopmentTopicWorkspace(repository, member, topic.id);
    assert.equal(detail.canManageMembers, false);
    assert.deepEqual(detail.inviteCandidates, []);
    const firstComment = await appendDevelopmentDiscussion(repository, owner, topic.id,
      { body: '  Compare two equipment directions  ' });
    const secondComment = await appendDevelopmentDiscussion(repository, member, topic.id,
      { body: 'Run a low-cost trial before detailed design' });
    assert.ok(secondComment.id > firstComment.id);
    const discussion = await listDevelopmentDiscussion(repository, member, topic.id);
    assert.deepEqual(discussion.comments.map((entry) => entry.body), [
      'Run a low-cost trial before detailed design', 'Compare two equipment directions'
    ]);
    assert.equal(discussion.hasMore, false);
    const older = await listDevelopmentDiscussion(repository, owner, topic.id,
      { beforeId: secondComment.id });
    assert.deepEqual(older.comments.map((entry) => entry.id), [firstComment.id]);
    assert.deepEqual((await listDevelopmentDiscussion(repository, outsider, topic.id)).comments, []);
    await assert.rejects(appendDevelopmentDiscussion(repository, outsider, topic.id,
      { body: 'Not a member' }), (error) => error.statusCode === 404);
    await assert.rejects(pool.query(`
      INSERT INTO development_events (topic_id, event_type, actor_user_id, metadata)
      VALUES ($1, 'discussion_comment', $2, '{"body":"Not a member"}'::jsonb)
    `, [topic.id, outsiderId]), /Only an active topic member may add discussion/);
    await assert.rejects(pool.query(`
      INSERT INTO development_events (topic_id, event_type, actor_user_id, metadata)
      VALUES ($1, 'discussion_comment', $2, '{}'::jsonb)
    `, [topic.id, ownerId]), /development_discussion_comment_shape/);
    await assert.rejects(pool.query(`
      UPDATE development_events SET metadata = '{"body":"Overwritten"}'::jsonb WHERE id = $1
    `, [firstComment.id]), /immutable/);
    await assert.rejects(inviteDevelopmentMember(repository, member, topic.id,
      { userId: outsiderId }), (error) => error.statusCode === 404);
    await assert.rejects(endDevelopmentMembership(repository, owner, topic.id, ownerId),
      (error) => error.statusCode === 422);
    await assert.rejects(pool.query(`
      UPDATE development_memberships
      SET ended_by_user_id = $2, ended_at = now()
      WHERE topic_id = $1 AND user_id = $2 AND ended_at IS NULL
    `, [topic.id, ownerId]), /owner membership cannot be ended/);
    await assert.rejects(inviteDevelopmentMember(repository, owner, topic.id,
      { userId: memberId }), (error) => error.statusCode === 409);

    await pool.query('UPDATE users SET is_active = false WHERE id = $1', [memberId]);
    assert.equal((await listDevelopmentTopics(repository, member)).total, 0);
    assert.deepEqual((await listDevelopmentDiscussion(repository, member, topic.id)).comments, []);
    await assert.rejects(appendDevelopmentDiscussion(repository, member, topic.id,
      { body: 'Inactive member' }), (error) => error.statusCode === 404);
    const ownerView = await getDevelopmentTopicWorkspace(repository, owner, topic.id);
    assert.equal(ownerView.members.find((item) => item.userId === memberId)?.isActive, false);
    await endDevelopmentMembership(repository, owner, topic.id, memberId);
    await pool.query('UPDATE users SET is_active = true WHERE id = $1', [memberId]);
    assert.equal((await listDevelopmentTopics(repository, member)).total, 0);
    await assert.rejects(getDevelopmentTopicWorkspace(repository, member, topic.id),
      (error) => error.statusCode === 404);
    const audits = await pool.query(`
      SELECT event_type FROM development_events
      WHERE topic_id = $1 AND event_type IN ('member_added', 'member_removed')
      ORDER BY id
    `, [topic.id]);
    assert.deepEqual(audits.rows.map((row) => row.event_type),
      ['member_added', 'member_added', 'member_removed']);
    await inviteDevelopmentMember(repository, owner, topic.id, { userId: memberId });
    assert.equal((await listDevelopmentTopics(repository, member)).total, 1);
  } finally {
    await pool.end();
  }
});
