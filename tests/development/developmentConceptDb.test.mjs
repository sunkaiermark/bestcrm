import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { migrate } from '../../src/db/migrate.mjs';
import { createDevelopmentRepository } from '../../src/repositories/developmentRepository.mjs';
import { createDevelopmentConceptRepository } from '../../src/repositories/developmentConceptRepository.mjs';
import { conceptSnapshotSha256 } from '../../src/domain/developmentConcepts.mjs';
import { createDevelopmentTopicDraft } from '../../src/services/developmentTopicService.mjs';
import {
  createConceptRevision, decideConceptRevision, getConceptGate,
  requestFormalDesignHandoff, submitConceptRevision
} from '../../src/services/developmentConceptService.mjs';

const databaseUrl = process.env.DEVELOPMENT_P2_TEST_DATABASE_URL;
const snapshot = {
  problem: 'Unreliable cleaning', application: 'Batch reactor', scope: 'Mixer and vessel',
  options: [{ name: 'New impeller', benefits: 'Faster cleaning', tradeoffs: 'Seal risk' }],
  preferredOption: 'New impeller', assumptions: ['Viscosity below limit'],
  risks: ['Seal not yet proven'], evidence: ['Bench test log 2026-09-27'],
  nextStepEffort: 'Two engineer-weeks', customerOpportunityRelation: 'No active opportunity'
};

test('P2 concept revisions, reviews and formal design gate are transactional', {
  skip: !databaseUrl ? 'Set DEVELOPMENT_P2_TEST_DATABASE_URL to an isolated local test database' : false
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
      WHERE name = '084_development_concept_gate.sql'
    `);
    assert.equal(applied.rows[0].n, 1);

    const suffix = randomUUID().replaceAll('-', '').slice(0, 10);
    async function user(label, roles = []) {
      const result = await pool.query(`
        INSERT INTO users (username, password_hash, display_name)
        VALUES ($1, 'isolated-test-only', $2) RETURNING id
      `, [`npd_p2_${label}_${suffix}`, label]);
      const id = Number(result.rows[0].id);
      if (roles.includes('technical_manager')) {
        const role = await pool.query(`
          INSERT INTO roles (code, name) VALUES ('technical_manager', 'Technical Manager')
          ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name RETURNING id
        `);
        await pool.query(`INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)`,
          [id, role.rows[0].id]);
      }
      return { id, isActive: true, roles };
    }
    const owner = await user('owner', ['salesperson']);
    const reviewerA = await user('reviewer_a', ['technical_manager']);
    const reviewerB = await user('reviewer_b', ['technical_manager']);
    const outsider = await user('outsider', ['technical_manager']);
    await assert.rejects(pool.query(`
      INSERT INTO development_topics (
        title, source_type, phase, owner_user_id,
        created_by_user_id, updated_by_user_id
      ) VALUES ('Forbidden shortcut', 'customer_idea', 'detailed_design', $1, $1, $1)
    `, [owner.id]), /Current approved concept handoff is required/);
    const topics = createDevelopmentRepository(pool);
    const concepts = createDevelopmentConceptRepository(pool);
    const topic = await createDevelopmentTopicDraft(topics, owner, {
      title: `Concept gate ${suffix}`, sourceType: 'customer_idea',
      directions: ['key_equipment']
    });
    await topics.addMember({ topicId: topic.id, userId: reviewerA.id,
      responsibilityCode: 'reviewer', actorUserId: owner.id });
    await topics.addMember({ topicId: topic.id, userId: reviewerB.id,
      responsibilityCode: 'reviewer', actorUserId: owner.id });
    await assert.rejects(getConceptGate(concepts, outsider, topic.id),
      (error) => error.statusCode === 404);
    await assert.rejects(requestFormalDesignHandoff(concepts, owner, topic.id, {
      revisionId: 1, expectedRowVersion: topic.rowVersion, idempotencyKey: `early-${suffix}`
    }), (error) => error.statusCode === 409);
    await assert.rejects(pool.query(`
      UPDATE development_topics SET phase = 'detailed_design', row_version = row_version + 1,
        updated_by_user_id = $2, updated_at = now() WHERE id = $1
    `, [topic.id, owner.id]), /Current approved concept handoff is required/);

    const incomplete = await createConceptRevision(concepts, owner, topic.id, {
      expectedRowVersion: topic.rowVersion, snapshot: { problem: 'Only a problem' }
    });
    await assert.rejects(submitConceptRevision(concepts, owner, topic.id, incomplete.id, {
      expectedRowVersion: incomplete.topic.rowVersion
    }), (error) => error.statusCode === 422 && error.fields.includes('evidence'));
    const full = await createConceptRevision(concepts, owner, topic.id, {
      expectedRowVersion: incomplete.topic.rowVersion, snapshot
    });
    const preview = await concepts.getConceptRevision({
      topicId: topic.id, revisionId: full.id, actorUserId: owner.id
    });
    assert.equal(preview.isCurrent, true);
    assert.equal(preview.snapshot.problem, snapshot.problem);
    await assert.rejects(concepts.getConceptRevision({
      topicId: topic.id, revisionId: full.id, actorUserId: outsider.id
    }), (error) => error.statusCode === 404);
    const roundTrip = await getConceptGate(concepts, owner, topic.id);
    assert.equal(conceptSnapshotSha256(roundTrip.currentSnapshot),
      roundTrip.currentSnapshotSha256);
    await assert.rejects(submitConceptRevision(concepts, owner, topic.id, incomplete.id, {
      expectedRowVersion: full.topic.rowVersion
    }), (error) => error.statusCode === 409);
    const submitted = await submitConceptRevision(concepts, owner, topic.id, full.id, {
      expectedRowVersion: full.topic.rowVersion
    });
    assert.equal(submitted.topic.phase, 'concept_review');
    await assert.rejects(createConceptRevision(concepts, owner, topic.id, {
      expectedRowVersion: submitted.topic.rowVersion, snapshot
    }), (error) => error.statusCode === 409);
    await assert.rejects(decideConceptRevision(concepts, owner, topic.id, full.id, {
      expectedRowVersion: submitted.topic.rowVersion, decisionCode: 'approved',
      reason: 'Ready', idempotencyKey: `sales-${suffix}`
    }), (error) => error.statusCode === 403);
    await assert.rejects(decideConceptRevision(concepts, outsider, topic.id, full.id, {
      expectedRowVersion: submitted.topic.rowVersion, decisionCode: 'approved',
      reason: 'Ready', idempotencyKey: `outsider-${suffix}`
    }), (error) => error.statusCode === 404);

    const attempts = await Promise.allSettled([
      decideConceptRevision(concepts, reviewerA, topic.id, full.id, {
        expectedRowVersion: submitted.topic.rowVersion, decisionCode: 'approved',
        reason: 'Bench evidence is enough', idempotencyKey: `a-${suffix}`
      }),
      decideConceptRevision(concepts, reviewerB, topic.id, full.id, {
        expectedRowVersion: submitted.topic.rowVersion, decisionCode: 'approved',
        reason: 'Ready for limited design', idempotencyKey: `b-${suffix}`
      })
    ]);
    assert.equal(attempts.filter((result) => result.status === 'fulfilled').length, 1);
    assert.equal(attempts.filter((result) => result.status === 'rejected').length, 1);
    assert.equal(attempts.find((result) => result.status === 'rejected').reason.statusCode, 409);
    const winner = attempts.find((result) => result.status === 'fulfilled').value;
    const decisionCount = await pool.query(`
      SELECT count(*)::integer AS n FROM development_concept_decisions
      WHERE submission_id = $1
    `, [submitted.id]);
    assert.equal(decisionCount.rows[0].n, 1);
    const gate = await getConceptGate(concepts, owner, topic.id);
    assert.equal(gate.currentRevisionId, full.id);
    assert.equal(gate.eligibleForFormalDesign, true);

    if (winner.decisionCode === 'approved') {
      const handoff = await requestFormalDesignHandoff(concepts, owner, topic.id, {
        revisionId: full.id, expectedRowVersion: gate.rowVersion,
        idempotencyKey: `handoff-${suffix}`
      });
      assert.equal(handoff.topic.phase, 'detailed_design');
      assert.equal((await requestFormalDesignHandoff(concepts, owner, topic.id, {
        revisionId: full.id, expectedRowVersion: gate.rowVersion,
        idempotencyKey: `handoff-${suffix}`
      })).repeated, true);
      await assert.rejects(pool.query(`
        INSERT INTO development_concept_revisions (
          topic_id, revision_no, snapshot, snapshot_sha256, authored_by_user_id
        ) VALUES ($1, 3, '{}'::jsonb, $2, $3)
      `, [topic.id, 'a'.repeat(64), owner.id]), /Return topic to exploration/);
      const changed = await createConceptRevision(concepts, owner, topic.id, {
        expectedRowVersion: handoff.topic.rowVersion,
        snapshot: { ...snapshot, scope: 'Changed core scope' }
      });
      assert.equal(changed.topic.phase, 'exploration');
      assert.equal((await getConceptGate(concepts, owner, topic.id)).eligibleForFormalDesign,
        false);
      await assert.rejects(requestFormalDesignHandoff(concepts, owner, topic.id, {
        revisionId: full.id, expectedRowVersion: gate.rowVersion,
        idempotencyKey: `handoff-${suffix}`
      }), (error) => error.statusCode === 409);
      await assert.rejects(requestFormalDesignHandoff(concepts, owner, topic.id, {
        revisionId: full.id, expectedRowVersion: changed.topic.rowVersion,
        idempotencyKey: `stale-${suffix}`
      }), (error) => error.statusCode === 409);
    }

    const selfTopic = await createDevelopmentTopicDraft(topics, reviewerA, {
      title: `Self review ${suffix}`, sourceType: 'internal_research', directions: []
    });
    const selfRevision = await createConceptRevision(concepts, reviewerA, selfTopic.id, {
      expectedRowVersion: selfTopic.rowVersion, snapshot
    });
    const selfSubmission = await submitConceptRevision(concepts, reviewerA,
      selfTopic.id, selfRevision.id, {
        expectedRowVersion: selfRevision.topic.rowVersion
      });
    await assert.rejects(decideConceptRevision(concepts, reviewerA, selfTopic.id,
      selfRevision.id, {
        expectedRowVersion: selfSubmission.topic.rowVersion,
        decisionCode: 'approved', reason: 'The assumptions are bounded',
        idempotencyKey: `self-first-${suffix}`
      }), (error) => error.statusCode === 422);
    const selfDecision = await decideConceptRevision(concepts, reviewerA,
      selfTopic.id, selfRevision.id, {
        expectedRowVersion: selfSubmission.topic.rowVersion,
        decisionCode: 'approved', reason: 'The assumptions are bounded',
        selfReviewReason: 'I authored this; no other scoped technical manager is assigned',
        idempotencyKey: `self-final-${suffix}`
      });
    assert.equal(selfDecision.isSelfReview, true);
    assert.match(selfDecision.selfReviewReason, /I authored/);
    assert.equal((await decideConceptRevision(concepts, reviewerA, selfTopic.id,
      selfRevision.id, {
        expectedRowVersion: selfSubmission.topic.rowVersion,
        decisionCode: 'approved', reason: 'The assumptions are bounded',
        selfReviewReason: 'I authored this; no other scoped technical manager is assigned',
        idempotencyKey: `self-final-${suffix}`
      })).repeated, true);
    const corrected = await createConceptRevision(concepts, reviewerA, selfTopic.id, {
      expectedRowVersion: selfDecision.topic.rowVersion,
      snapshot: { ...snapshot, scope: 'Revised operating scope' }
    });
    assert.equal(corrected.topic.phase, 'exploration');
    assert.equal((await getConceptGate(concepts, reviewerA, selfTopic.id))
      .eligibleForFormalDesign, false);
    await assert.rejects(decideConceptRevision(concepts, reviewerA, selfTopic.id,
      selfRevision.id, {
        expectedRowVersion: selfSubmission.topic.rowVersion,
        decisionCode: 'approved', reason: 'The assumptions are bounded',
        selfReviewReason: 'I authored this; no other scoped technical manager is assigned',
        idempotencyKey: `self-final-${suffix}`
      }), (error) => error.statusCode === 409);
    const resubmitted = await submitConceptRevision(concepts, reviewerA,
      selfTopic.id, corrected.id, {
        expectedRowVersion: corrected.topic.rowVersion
      });
    await assert.rejects(decideConceptRevision(concepts, reviewerA, selfTopic.id,
      selfRevision.id, {
        expectedRowVersion: resubmitted.topic.rowVersion,
        decisionCode: 'approved', reason: 'Stale version',
        selfReviewReason: 'I authored this', idempotencyKey: `stale-self-${suffix}`
      }), (error) => error.statusCode === 409);
    const revise = await decideConceptRevision(concepts, reviewerA, selfTopic.id,
      corrected.id, {
        expectedRowVersion: resubmitted.topic.rowVersion,
        decisionCode: 'revise_required', reason: 'Scope needs another bench trial',
        selfReviewReason: 'I authored this and need more evidence',
        idempotencyKey: `revise-${suffix}`
      });
    assert.equal(revise.topic.phase, 'exploration');
    const eventRows = await pool.query(`
      SELECT event_type FROM development_events WHERE topic_id = $1 ORDER BY id
    `, [selfTopic.id]);
    for (const name of ['concept_revision_created', 'concept_submitted', 'concept_decided']) {
      assert.ok(eventRows.rows.some((row) => row.event_type === name));
    }
  } finally {
    await pool.end();
  }
});
