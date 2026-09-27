import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { migrate } from '../../src/db/migrate.mjs';
import { createDevelopmentRepository } from '../../src/repositories/developmentRepository.mjs';
import { createDevelopmentTopicDraft } from '../../src/services/developmentTopicService.mjs';

const databaseUrl = process.env.DEVELOPMENT_P3B_TEST_DATABASE_URL;

test('P3b reviews require another active technical manager who is an active topic member', {
  skip: !databaseUrl ? 'Set DEVELOPMENT_P3B_TEST_DATABASE_URL to an isolated local test database' : false
}, async () => {
  const parsed = new URL(databaseUrl);
  assert.equal(parsed.hostname, '127.0.0.1');
  assert.match(parsed.pathname, /^\/bestcrm_npd_p3b_[a-z0-9_]+$/);
  const pool = new pg.Pool({ connectionString: databaseUrl });
  try {
    await migrate(pool);
    await migrate(pool);
    const applied = await pool.query(`
      SELECT count(*)::integer AS n FROM schema_migrations
      WHERE name = '087_development_asset_candidate_review.sql'
    `);
    assert.equal(applied.rows[0].n, 1);
    const suffix = randomUUID().replaceAll('-', '').slice(0, 10);
    const roleIds = new Map();
    for (const code of ['technical_manager', 'administrator']) {
      const role = await pool.query(`
        INSERT INTO roles (code, name) VALUES ($1, $2)
        ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name RETURNING id
      `, [code, code]);
      roleIds.set(code, role.rows[0].id);
    }
    async function user(label, roles = []) {
      const result = await pool.query(`
        INSERT INTO users (username, password_hash, display_name)
        VALUES ($1, 'isolated-test-only', $2) RETURNING id
      `, [`npd_p3b_${label}_${suffix}`, label]);
      const id = Number(result.rows[0].id);
      for (const code of roles) {
        await pool.query('INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)',
          [id, roleIds.get(code)]);
      }
      return { id, isActive: true, roles };
    }
    const author = await user('author', ['technical_manager']);
    const proposer = await user('proposer', ['technical_manager']);
    const reviewer = await user('reviewer', ['technical_manager']);
    const otherManager = await user('other_manager', ['technical_manager']);
    const ordinaryMember = await user('ordinary_member');
    const inactiveManager = await user('inactive_manager', ['technical_manager']);
    const roleRevokedManager = await user('role_revoked_manager', ['technical_manager']);
    const futureMember = await user('future_member', ['technical_manager']);
    const administrator = await user('administrator', ['administrator']);
    const topics = createDevelopmentRepository(pool);
    const topic = await createDevelopmentTopicDraft(topics, author, {
      title: `Independent conclusion review ${suffix}`,
      sourceType: 'internal_research', directions: []
    });
    for (const actor of [proposer, reviewer, ordinaryMember, inactiveManager,
      roleRevokedManager]) {
      assert.equal(await topics.addMember({ topicId: topic.id, userId: actor.id,
        responsibilityCode: 'contributor', actorUserId: author.id }), true);
    }
    await pool.query('UPDATE users SET is_active = false WHERE id = $1', [inactiveManager.id]);
    await pool.query('DELETE FROM user_roles WHERE user_id = $1', [roleRevokedManager.id]);
    await pool.query(`
      INSERT INTO development_memberships (
        topic_id, user_id, responsibility_code, added_by_user_id, added_at
      ) VALUES ($1, $2, 'future_reviewer', $3, now() + interval '1 day')
    `, [topic.id, futureMember.id, author.id]);

    async function outcome(revisionNo) {
      const result = await pool.query(`
        INSERT INTO development_outcome_revisions (
          topic_id, revision_no, outcome_kind, title, finding,
          applicability, limitations, authored_by_user_id
        ) VALUES ($1, $2, 'technical_result', 'Research finding',
          'Bench result', 'Within stated limits', 'Not field proven', $3)
        RETURNING id
      `, [topic.id, revisionNo, author.id]);
      return Number(result.rows[0].id);
    }
    async function candidate(revisionId) {
      const result = await pool.query(`
        INSERT INTO development_asset_candidates
          (outcome_revision_id, rationale, proposed_by_user_id)
        VALUES ($1, 'Candidate for later controlled publication', $2) RETURNING id
      `, [revisionId, proposer.id]);
      return Number(result.rows[0].id);
    }
    async function review(candidateId, actorId, decisionCode = 'endorsed') {
      return pool.query(`
        INSERT INTO development_asset_candidate_reviews
          (candidate_id, decision_code, reason, reviewed_by_user_id)
        VALUES ($1, $2, 'Independent technical assessment', $3)
        RETURNING id, reviewed_at
      `, [candidateId, decisionCode, actorId]);
    }

    const staleCandidate = await candidate(await outcome(1));
    const currentRevisionId = await outcome(2);
    await assert.rejects(review(staleCandidate, reviewer.id),
      /Only the current outcome revision may be reviewed/);
    const currentCandidate = await candidate(currentRevisionId);
    await assert.rejects(review(currentCandidate, author.id), /cannot review their own work/);
    await assert.rejects(review(currentCandidate, proposer.id), /cannot review their own work/);
    await assert.rejects(review(currentCandidate, ordinaryMember.id),
      /active technical manager and active topic member/);
    await assert.rejects(review(currentCandidate, inactiveManager.id),
      /active technical manager and active topic member/);
    await assert.rejects(review(currentCandidate, roleRevokedManager.id),
      /active technical manager and active topic member/);
    await assert.rejects(review(currentCandidate, futureMember.id),
      /active technical manager and active topic member/);
    await assert.rejects(review(currentCandidate, otherManager.id),
      /active technical manager and active topic member/);

    // A valid P2 proxy appointment is not permission to review a P3 outcome.
    await pool.query(`
      INSERT INTO development_reviewer_delegations (
        topic_id, absent_manager_user_id, proxy_manager_user_id,
        valid_from, valid_until, reason, recorded_by_admin_user_id, idempotency_key
      ) VALUES ($1, $2, $3, now() - interval '1 minute',
        now() + interval '1 day', 'Concept proxy only', $4, $5)
    `, [topic.id, author.id, otherManager.id, administrator.id, `p3b-proxy-${suffix}`]);
    await assert.rejects(review(currentCandidate, otherManager.id),
      /active technical manager and active topic member/);

    await pool.query(`
      UPDATE development_memberships SET ended_at = now(), ended_by_user_id = $3
      WHERE topic_id = $1 AND user_id = $2 AND ended_at IS NULL
    `, [topic.id, reviewer.id, author.id]);
    await assert.rejects(review(currentCandidate, reviewer.id),
      /active technical manager and active topic member/);
    assert.equal(await topics.addMember({ topicId: topic.id, userId: reviewer.id,
      responsibilityCode: 'independent_reviewer', actorUserId: author.id }), true);
    await assert.rejects(review(currentCandidate, reviewer.id, 'published'),
      /check constraint/);
    const endorsed = await review(currentCandidate, reviewer.id);
    assert.ok(Number(endorsed.rows[0].id) > 0);
    assert.ok(endorsed.rows[0].reviewed_at);
    await assert.rejects(review(currentCandidate, reviewer.id), /unique constraint/);
    await assert.rejects(pool.query(`
      UPDATE development_asset_candidate_reviews SET decision_code = 'revision_required'
      WHERE id = $1
    `, [endorsed.rows[0].id]), /immutable/);
    await assert.rejects(pool.query(`
      DELETE FROM development_asset_candidate_reviews WHERE id = $1
    `, [endorsed.rows[0].id]), /immutable/);

    const nextCandidate = await candidate(await outcome(3));
    const rejected = await review(nextCandidate, reviewer.id, 'revision_required');
    assert.ok(Number(rejected.rows[0].id) > Number(endorsed.rows[0].id));
    const audit = await pool.query(`
      SELECT metadata->>'decisionCode' AS decision_code
      FROM development_events WHERE topic_id = $1 AND event_type = 'asset_candidate_reviewed'
      ORDER BY id
    `, [topic.id]);
    assert.deepEqual(audit.rows.map((row) => row.decision_code),
      ['endorsed', 'revision_required']);
    const published = await pool.query(`
      SELECT count(*)::integer AS total FROM development_assets
    `);
    assert.equal(published.rows[0].total, 0);
  } finally {
    await pool.end();
  }
});
