import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { migrate } from '../../src/db/migrate.mjs';
import { createDevelopmentRepository } from '../../src/repositories/developmentRepository.mjs';
import { createDevelopmentConceptRepository } from '../../src/repositories/developmentConceptRepository.mjs';
import { createDevelopmentPolicyRepository } from '../../src/repositories/developmentPolicyRepository.mjs';
import { createDevelopmentTopicDraft } from '../../src/services/developmentTopicService.mjs';
import {
  createConceptRevision, decideConceptRevision, getConceptGate,
  submitConceptRevision
} from '../../src/services/developmentConceptService.mjs';
import {
  appointReviewerProxy, decideLifecycle, getLifecycle, requestLifecycle,
  revokeReviewerProxy
} from '../../src/services/developmentPolicyService.mjs';

const databaseUrl = process.env.DEVELOPMENT_POLICY_TEST_DATABASE_URL;
const snapshot = {
  problem: 'Cleaning time is excessive', application: 'Batch process', scope: 'Mixer',
  options: [{ name: 'Alternative seal', benefits: 'Shorter cleaning', tradeoffs: 'Seal trial' }],
  preferredOption: 'Alternative seal', assumptions: ['Temperature is stable'],
  risks: ['Seal lifetime unknown'], evidence: ['Bench report 1'],
  nextStepEffort: 'One week', customerOpportunityRelation: ''
};

test('P2 proxy and lifecycle policy requires scoped managers and administrator approval', {
  skip: !databaseUrl ? 'Set DEVELOPMENT_POLICY_TEST_DATABASE_URL to an isolated local test database' : false
}, async () => {
  const parsed = new URL(databaseUrl);
  assert.equal(parsed.hostname, '127.0.0.1');
  assert.match(parsed.pathname, /^\/bestcrm_npd_p2_[a-z0-9_]+$/);
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 6 });
  try {
    await migrate(pool);
    await migrate(pool);
    const applied = await pool.query(`
      SELECT count(*)::integer AS n FROM schema_migrations
      WHERE name = '085_development_lifecycle_and_proxy.sql'
    `);
    assert.equal(applied.rows[0].n, 1);
    const suffix = randomUUID().replaceAll('-', '').slice(0, 10);
    async function user(label, roles = []) {
      const result = await pool.query(`
        INSERT INTO users (username, password_hash, display_name)
        VALUES ($1, 'isolated-test-only', $2) RETURNING id
      `, [`npd_policy_${label}_${suffix}`, label]);
      const userId = Number(result.rows[0].id);
      for (const code of roles) {
        const role = await pool.query(`
          INSERT INTO roles (code, name) VALUES ($1, $2)
          ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name RETURNING id
        `, [code, code]);
        await pool.query('INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)',
          [userId, role.rows[0].id]);
      }
      return { id: userId, isActive: true, roles };
    }
    const owner = await user('owner', ['salesperson']);
    const admin = await user('admin', ['administrator']);
    const ownerAdmin = await user('owner_admin', ['administrator']);
    const absent = await user('absent', ['technical_manager']);
    const proxy = await user('proxy', ['technical_manager']);
    const other = await user('other', ['salesperson']);
    const topics = createDevelopmentRepository(pool);
    const concepts = createDevelopmentConceptRepository(pool);
    const policies = createDevelopmentPolicyRepository(pool);
    const topic = await createDevelopmentTopicDraft(topics, owner, {
      title: `Lifecycle ${suffix}`, sourceType: 'internal_research', directions: []
    });
    await topics.addMember({ topicId: topic.id, userId: absent.id,
      responsibilityCode: 'concept_reviewer', actorUserId: owner.id });
    await assert.rejects(getLifecycle(policies, other, topic.id),
      (error) => error.statusCode === 404);
    await assert.rejects(appointReviewerProxy(policies, owner, topic.id, {
      absentManagerUserId: absent.id, proxyManagerUserId: proxy.id,
      validFrom: new Date(Date.now() - 1000).toISOString(),
      validUntil: new Date(Date.now() + 3600000).toISOString(),
      reason: 'Absence', idempotencyKey: `unauthorized-${suffix}`
    }), (error) => error.statusCode === 403);
    await assert.rejects(pool.query(`
      UPDATE development_topics SET phase = 'paused', row_version = row_version + 1,
        updated_by_user_id = $2, updated_at = now() WHERE id = $1
    `, [topic.id, owner.id]), /lifecycle request is required/i);
    await assert.rejects(requestLifecycle(policies, other, topic.id, {
      actionCode: 'pause', reason: 'Wait for evidence',
      expectedRowVersion: topic.rowVersion, idempotencyKey: `other-${suffix}`
    }), (error) => error.statusCode === 404);
    const pause = await requestLifecycle(policies, owner, topic.id, {
      actionCode: 'pause', reason: 'Wait for evidence',
      expectedRowVersion: topic.rowVersion, idempotencyKey: `pause-${suffix}`
    });
    assert.equal(pause.resumeToPhase, 'idea');
    assert.equal((await requestLifecycle(policies, owner, topic.id, {
      actionCode: 'pause', reason: 'Wait for evidence',
      expectedRowVersion: topic.rowVersion, idempotencyKey: `pause-${suffix}`
    })).repeated, true);
    await assert.rejects(requestLifecycle(policies, owner, topic.id, {
      actionCode: 'stop', reason: 'Stop now', expectedRowVersion: topic.rowVersion,
      idempotencyKey: `duplicate-${suffix}`
    }), (error) => error.statusCode === 409);
    await assert.rejects(decideLifecycle(policies, owner, topic.id, pause.id, {
      decisionCode: 'approved', reason: 'Reasonable', idempotencyKey: `notadmin-${suffix}`
    }), (error) => error.statusCode === 403);
    await assert.rejects(pool.query(`
      INSERT INTO development_lifecycle_decisions
        (request_id, decision_code, reason, decided_by_admin_user_id, idempotency_key)
      VALUES ($1, 'approved', 'Bypass', $2, $3)
    `, [pause.id, owner.id, `db-bypass-${suffix}`]), /Only an active administrator/);
    const paused = await decideLifecycle(policies, admin, topic.id, pause.id, {
      decisionCode: 'approved', reason: 'Wait for lab result',
      idempotencyKey: `pause-approve-${suffix}`
    });
    assert.equal(paused.topic.phase, 'paused');
    assert.equal((await decideLifecycle(policies, admin, topic.id, pause.id, {
      decisionCode: 'approved', reason: 'Wait for lab result',
      idempotencyKey: `pause-approve-${suffix}`
    })).repeated, true);
    await assert.rejects(pool.query(`
      UPDATE development_topics SET phase = 'idea', row_version = row_version + 1,
        updated_by_user_id = $2, updated_at = now() WHERE id = $1
    `, [topic.id, owner.id]), /Approved lifecycle request is required/);
    const stop = await requestLifecycle(policies, owner, topic.id, {
      actionCode: 'stop', reason: 'Trial ended',
      expectedRowVersion: paused.topic.rowVersion, idempotencyKey: `stop-${suffix}`
    });
    assert.equal(stop.resumeToPhase, 'idea');
    const stopped = await decideLifecycle(policies, admin, topic.id, stop.id, {
      decisionCode: 'approved', reason: 'Archive work safely',
      idempotencyKey: `stop-approve-${suffix}`
    });
    assert.equal(stopped.topic.phase, 'stopped');
    const resume = await requestLifecycle(policies, owner, topic.id, {
      actionCode: 'resume', reason: 'New evidence received',
      expectedRowVersion: stopped.topic.rowVersion, idempotencyKey: `resume-${suffix}`
    });
    assert.equal(resume.resumeToPhase, 'idea');
    const resumed = await decideLifecycle(policies, admin, topic.id, resume.id, {
      decisionCode: 'approved', reason: 'Reopen old work',
      idempotencyKey: `resume-approve-${suffix}`
    });
    assert.equal(resumed.topic.phase, 'idea');
    const pauseAgain = await requestLifecycle(policies, owner, topic.id, {
      actionCode: 'pause', reason: 'Second pause',
      expectedRowVersion: resumed.topic.rowVersion, idempotencyKey: `pause2-${suffix}`
    });
    const pausedAgain = await decideLifecycle(policies, admin, topic.id, pauseAgain.id, {
      decisionCode: 'approved', reason: 'Wait again', idempotencyKey: `pause2-ok-${suffix}`
    });
    const resumePause = await requestLifecycle(policies, owner, topic.id, {
      actionCode: 'resume', reason: 'Ready again',
      expectedRowVersion: pausedAgain.topic.rowVersion,
      idempotencyKey: `resume-pause-${suffix}`
    });
    const resumedPause = await decideLifecycle(policies, admin, topic.id, resumePause.id, {
      decisionCode: 'approved', reason: 'Reopen', idempotencyKey: `resume-pause-ok-${suffix}`
    });
    assert.equal(resumedPause.topic.phase, 'idea');
    assert.equal((await getLifecycle(policies, owner, topic.id)).requests.length, 5);

    const selfTopic = await createDevelopmentTopicDraft(topics, ownerAdmin, {
      title: `Self approval ${suffix}`, sourceType: 'internal_research', directions: []
    });
    const selfRequest = await requestLifecycle(policies, ownerAdmin, selfTopic.id, {
      actionCode: 'stop', reason: 'Stop trial', expectedRowVersion: selfTopic.rowVersion,
      idempotencyKey: `self-${suffix}`
    });
    await assert.rejects(decideLifecycle(policies, ownerAdmin, selfTopic.id, selfRequest.id, {
      decisionCode: 'approved', reason: 'Stop approved',
      idempotencyKey: `self-no-reason-${suffix}`
    }), (error) => error.statusCode === 422 && error.fields.includes('selfApprovalReason'));
    const selfDecision = await decideLifecycle(policies, ownerAdmin, selfTopic.id,
      selfRequest.id, { decisionCode: 'approved', reason: 'Stop approved',
        selfApprovalReason: 'I own this lab topic; emergency hold is needed',
        idempotencyKey: `self-reason-${suffix}` });
    assert.equal(selfDecision.isSelfApproval, true);
    assert.equal(selfDecision.topic.phase, 'stopped');

    const staleTopic = await createDevelopmentTopicDraft(topics, owner, {
      title: `Stale request ${suffix}`, sourceType: 'internal_research', directions: []
    });
    const staleRequest = await requestLifecycle(policies, owner, staleTopic.id, {
      actionCode: 'pause', reason: 'Possible hold',
      expectedRowVersion: staleTopic.rowVersion,
      idempotencyKey: `stale-request-${suffix}`
    });
    const edited = await createConceptRevision(concepts, owner, staleTopic.id, {
      expectedRowVersion: staleTopic.rowVersion, snapshot
    });
    await assert.rejects(decideLifecycle(policies, admin, staleTopic.id, staleRequest.id, {
      decisionCode: 'approved', reason: 'Too late', idempotencyKey: `stale-yes-${suffix}`
    }), (error) => error.statusCode === 409);
    const staleRejected = await decideLifecycle(policies, admin, staleTopic.id,
      staleRequest.id, { decisionCode: 'rejected', reason: 'Topic changed since request',
        idempotencyKey: `stale-no-${suffix}` });
    assert.equal(staleRejected.topic.phase, 'idea');
    assert.equal(staleRejected.topic.rowVersion, edited.topic.rowVersion);
    const fresh = await requestLifecycle(policies, owner, staleTopic.id, {
      actionCode: 'pause', reason: 'New hold',
      expectedRowVersion: edited.topic.rowVersion,
      idempotencyKey: `fresh-${suffix}`
    });
    assert.equal(fresh.fromPhase, 'idea');

    await assert.rejects(getConceptGate(concepts, proxy, topic.id),
      (error) => error.statusCode === 404);
    const futureFrom = new Date(Date.now() + 3600000).toISOString();
    const futureUntil = new Date(Date.now() + 7200000).toISOString();
    const future = await appointReviewerProxy(policies, admin, topic.id, {
      absentManagerUserId: absent.id, proxyManagerUserId: proxy.id,
      validFrom: futureFrom, validUntil: futureUntil,
      reason: 'Planned absence', idempotencyKey: `future-${suffix}`
    });
    assert.equal(future.proxyManagerUserId, proxy.id);
    await assert.rejects(getConceptGate(concepts, proxy, topic.id),
      (error) => error.statusCode === 404);
    const activeFrom = new Date(Date.now() - 3600000).toISOString();
    const activeUntil = new Date(Date.now() + 1800000).toISOString();
    const active = await appointReviewerProxy(policies, admin, topic.id, {
      absentManagerUserId: absent.id, proxyManagerUserId: proxy.id,
      validFrom: activeFrom, validUntil: activeUntil,
      reason: 'Technical manager absent', idempotencyKey: `active-${suffix}`
    });
    assert.equal((await getConceptGate(concepts, proxy, topic.id)).topicId, topic.id);
    await assert.rejects(appointReviewerProxy(policies, admin, topic.id, {
      absentManagerUserId: absent.id, proxyManagerUserId: proxy.id,
      validFrom: activeFrom, validUntil: activeUntil,
      reason: 'Overlap', idempotencyKey: `overlap-${suffix}`
    }), (error) => error.statusCode === 409);
    await assert.rejects(appointReviewerProxy(policies, admin, topic.id, {
      absentManagerUserId: absent.id, proxyManagerUserId: other.id,
      validFrom: activeFrom, validUntil: activeUntil,
      reason: 'Wrong role', idempotencyKey: `wrong-role-${suffix}`
    }), (error) => error.statusCode === 422);
    const revoked = await revokeReviewerProxy(policies, admin, topic.id, active.id, {
      reason: 'Manager returned', idempotencyKey: `revoke-${suffix}`
    });
    assert.equal(revoked.delegationId, active.id);
    await assert.rejects(getConceptGate(concepts, proxy, topic.id),
      (error) => error.statusCode === 404);
    const replacement = await appointReviewerProxy(policies, admin, topic.id, {
      absentManagerUserId: absent.id, proxyManagerUserId: proxy.id,
      validFrom: activeFrom, validUntil: activeUntil,
      reason: 'Manager absent again', idempotencyKey: `replacement-${suffix}`
    });
    const concept = await createConceptRevision(concepts, owner, topic.id, {
      expectedRowVersion: resumedPause.topic.rowVersion, snapshot
    });
    const proxyPreview = await concepts.getConceptRevision({
      topicId: topic.id, revisionId: concept.id, actorUserId: proxy.id
    });
    assert.equal(proxyPreview.revisionId, concept.id);
    const submitted = await submitConceptRevision(concepts, owner, topic.id, concept.id, {
      expectedRowVersion: concept.topic.rowVersion
    });
    const decided = await decideConceptRevision(concepts, proxy, topic.id, concept.id, {
      expectedRowVersion: submitted.topic.rowVersion, decisionCode: 'approved',
      reason: 'Bench evidence supports design', idempotencyKey: `proxy-decision-${suffix}`
    });
    assert.equal(decided.delegationId, replacement.id);
    assert.equal(decided.isSelfReview, false);
    await pool.query('UPDATE users SET is_active = false WHERE id = $1', [absent.id]);
    await assert.rejects(getConceptGate(concepts, proxy, topic.id),
      (error) => error.statusCode === 404);
    await assert.rejects(concepts.getConceptRevision({
      topicId: topic.id, revisionId: concept.id, actorUserId: proxy.id
    }), (error) => error.statusCode === 404);
    const audit = await pool.query(`
      SELECT event_type FROM development_events WHERE topic_id = $1 ORDER BY id
    `, [topic.id]);
    for (const event of ['lifecycle_requested', 'lifecycle_decided',
      'reviewer_proxy_appointed', 'reviewer_proxy_revoked', 'concept_decided']) {
      assert.ok(audit.rows.some((row) => row.event_type === event));
    }
  } finally {
    await pool.end();
  }
});
