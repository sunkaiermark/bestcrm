import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { migrate } from '../../src/db/migrate.mjs';
import { createDevelopmentRepository } from '../../src/repositories/developmentRepository.mjs';
import { createDevelopmentOutcomeRepository } from '../../src/repositories/developmentOutcomeRepository.mjs';
import { createDevelopmentTopicDraft } from '../../src/services/developmentTopicService.mjs';
import {
  createDevelopmentOutcomeRevision, listDevelopmentOutcomes,
  listVisibleDevelopmentAssets, proposeDevelopmentAssetCandidate,
  publishDevelopmentAsset, reviewDevelopmentAssetCandidate, withdrawDevelopmentAsset
} from '../../src/services/developmentOutcomeService.mjs';

const databaseUrl = process.env.DEVELOPMENT_OUTCOME_TEST_DATABASE_URL;

test('outcome revisions and independent candidate reviews remain member-scoped and immutable', {
  skip: !databaseUrl ? 'Set DEVELOPMENT_OUTCOME_TEST_DATABASE_URL to an isolated local test database' : false
}, async () => {
  const parsed = new URL(databaseUrl);
  assert.equal(parsed.hostname, '127.0.0.1');
  assert.match(parsed.pathname, /^\/bestcrm_npd_outcome_[a-z0-9_]+$/);
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 4 });
  try {
    await migrate(pool);
    await migrate(pool);
    const suffix = randomUUID().replaceAll('-', '').slice(0, 10);
    const managerRole = await pool.query(`
      INSERT INTO roles (code, name) VALUES ('technical_manager', 'Technical Manager')
      ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name RETURNING id
    `);
    async function user(label, manager = false) {
      const created = await pool.query(`
        INSERT INTO users (username, password_hash, display_name)
        VALUES ($1, 'isolated-test-only', $2) RETURNING id
      `, [`npd_outcome_${label}_${suffix}`, label]);
      const id = Number(created.rows[0].id);
      if (manager) await pool.query(`
        INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)
      `, [id, managerRole.rows[0].id]);
      return { id, isActive: true, roles: manager ? ['technical_manager'] : ['salesperson'] };
    }
    const author = await user('author', true);
    const proposer = await user('proposer');
    const reviewer = await user('reviewer', true);
    const outsider = await user('outsider', true);
    const topics = createDevelopmentRepository(pool);
    const outcomes = createDevelopmentOutcomeRepository(pool);
    const topic = await createDevelopmentTopicDraft(topics, author, {
      title: `Outcome workflow ${suffix}`, sourceType: 'internal_research', directions: []
    });
    for (const member of [proposer, reviewer]) {
      await topics.addMember({ topicId: topic.id, userId: member.id,
        responsibilityCode: 'contributor', actorUserId: author.id });
    }
    await assert.rejects(listDevelopmentOutcomes(outcomes, outsider, topic.id),
      (error) => error.statusCode === 404);
    const revision = await createDevelopmentOutcomeRevision(outcomes, author, topic.id, {
      outcomeKind: 'technical_result', title: 'Seal finding',
      finding: 'The seal failed at high viscosity', applicability: 'Lab conditions',
      limitations: 'One trial only', evidenceReferences: ['Lab log 42']
    });
    assert.equal(revision.revisionNo, 1);
    assert.deepEqual((await listDevelopmentOutcomes(outcomes, proposer, topic.id))
      .revisions[0].evidenceReferences, ['Lab log 42']);
    await assert.rejects(proposeDevelopmentAssetCandidate(outcomes, outsider,
      topic.id, revision.id, { rationale: 'Reuse' }),
    (error) => error.statusCode === 404);
    const candidate = await proposeDevelopmentAssetCandidate(outcomes, proposer,
      topic.id, revision.id, { rationale: 'Potentially useful after review' });
    await assert.rejects(proposeDevelopmentAssetCandidate(outcomes, proposer,
      topic.id, revision.id, { rationale: 'Again' }),
    (error) => error.statusCode === 409);
    await assert.rejects(reviewDevelopmentAssetCandidate(outcomes, author,
      topic.id, candidate.id, { decisionCode: 'endorsed', reason: 'Self' }),
    (error) => error.statusCode === 403);
    await assert.rejects(reviewDevelopmentAssetCandidate(outcomes, proposer,
      topic.id, candidate.id, { decisionCode: 'endorsed', reason: 'Self' }),
    (error) => error.statusCode === 403);
    await assert.rejects(reviewDevelopmentAssetCandidate(outcomes, outsider,
      topic.id, candidate.id, { decisionCode: 'endorsed', reason: 'Outsider' }),
    (error) => error.statusCode === 404);
    const review = await reviewDevelopmentAssetCandidate(outcomes, reviewer,
      topic.id, candidate.id, { decisionCode: 'endorsed', reason: 'Evidence checked' });
    assert.equal(review.decisionCode, 'endorsed');
    await assert.rejects(publishDevelopmentAsset(outcomes, author, topic.id,
      candidate.id, { reason: 'My own result' }),
    (error) => error.statusCode === 403);
    const asset = await publishDevelopmentAsset(outcomes, reviewer, topic.id,
      candidate.id, { reason: 'Internally reusable within tested limits' });
    assert.equal(asset.outcomeRevisionId, revision.id);
    await assert.rejects(publishDevelopmentAsset(outcomes, reviewer, topic.id,
      candidate.id, { reason: 'Again' }),
    (error) => error.statusCode === 409);
    assert.equal((await listVisibleDevelopmentAssets(outcomes, author)).length, 1);
    assert.deepEqual(await listVisibleDevelopmentAssets(outcomes, outsider), []);
    await topics.endVisibleMember({ topicId: topic.id, userId: proposer.id,
      actorUserId: author.id });
    assert.deepEqual(await listVisibleDevelopmentAssets(outcomes, proposer), []);
    await assert.rejects(reviewDevelopmentAssetCandidate(outcomes, reviewer,
      topic.id, candidate.id, { decisionCode: 'endorsed', reason: 'Again' }),
    (error) => error.statusCode === 409);
    await assert.rejects(pool.query(`
      UPDATE development_outcome_revisions SET finding = 'rewritten' WHERE id = $1
    `, [revision.id]), /immutable|change|update/i);
    const visible = await listDevelopmentOutcomes(outcomes, author, topic.id);
    assert.equal(visible.revisions[0].candidate.review.decisionCode, 'endorsed');
    assert.equal(visible.revisions[0].asset.id, asset.id);
    await withdrawDevelopmentAsset(outcomes, reviewer, topic.id, asset.id, {
      reason: 'Subsequent experiment invalidated applicability'
    });
    assert.deepEqual(await listVisibleDevelopmentAssets(outcomes, author), []);
    assert((await listDevelopmentOutcomes(outcomes, author, topic.id))
      .revisions[0].asset.withdrawnAt);
  } finally {
    await pool.end();
  }
});
