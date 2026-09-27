import { assertConceptReadyForSubmission, DevelopmentConceptError } from '../domain/developmentConcepts.mjs';

function fail(message, statusCode) {
  throw new DevelopmentConceptError(message, statusCode);
}

async function transaction(pool, action) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await action(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function loadTopic(client, topicId, forUpdate = true) {
  const found = await client.query(`
    SELECT * FROM development_topics WHERE id = $1 ${forUpdate ? 'FOR UPDATE' : ''}
  `, [topicId]);
  if (!found.rowCount) fail('Development topic not found', 404);
  return found.rows[0];
}

function requireVersion(topic, expectedRowVersion) {
  if (Number(topic.row_version) !== expectedRowVersion) {
    fail('Development topic changed; reload before continuing', 409);
  }
}

async function requireMember(client, topicId, actorUserId) {
  const result = await client.query(`
    SELECT 1 FROM development_memberships membership
    JOIN users actor ON actor.id = membership.user_id
    WHERE membership.topic_id = $1 AND membership.user_id = $2
      AND membership.ended_at IS NULL AND actor.is_active = true
  `, [topicId, actorUserId]);
  if (!result.rowCount) fail('Development topic not found', 404);
}

async function requireOwner(client, topic, actorUserId) {
  await requireMember(client, topic.id, actorUserId);
  if (Number(topic.owner_user_id) !== actorUserId) {
    fail('Only the active topic owner may change its concept', 403);
  }
}

async function requireTechnicalManager(client, topicId, actorUserId) {
  const role = await client.query(`
    SELECT 1 FROM users actor
    JOIN user_roles assignment ON assignment.user_id = actor.id
    JOIN roles role ON role.id = assignment.role_id
    WHERE actor.id = $1 AND actor.is_active = true
      AND role.code = 'technical_manager' AND role.is_active = true
  `, [actorUserId]);
  if (!role.rowCount) fail('Only a technical manager may decide a concept', 403);
  const delegation = await client.query(`
    SELECT delegation.id FROM development_reviewer_delegations delegation
    WHERE delegation.topic_id = $1 AND delegation.proxy_manager_user_id = $2
      AND delegation.valid_from <= now() AND delegation.valid_until > now()
      AND bestcrm_development_has_active_role(
        delegation.absent_manager_user_id, 'technical_manager')
      AND EXISTS (
        SELECT 1 FROM development_memberships membership
        WHERE membership.topic_id = delegation.topic_id
          AND membership.user_id = delegation.absent_manager_user_id
          AND membership.ended_at IS NULL
      )
      AND NOT EXISTS (
        SELECT 1 FROM development_reviewer_delegation_revocations revoked
        WHERE revoked.delegation_id = delegation.id
      )
    ORDER BY delegation.id DESC LIMIT 1
  `, [topicId, actorUserId]);
  if (delegation.rowCount) return Number(delegation.rows[0].id);
  const membership = await client.query(`
    SELECT 1 FROM development_memberships
    WHERE topic_id = $1 AND user_id = $2 AND ended_at IS NULL
  `, [topicId, actorUserId]);
  if (!membership.rowCount) fail('Development topic not found', 404);
  return null;
}

async function requireConceptViewer(client, topicId, actorUserId) {
  const membership = await client.query(`
    SELECT 1 FROM development_memberships membership
    JOIN users actor ON actor.id = membership.user_id
    WHERE membership.topic_id = $1 AND membership.user_id = $2
      AND membership.ended_at IS NULL AND actor.is_active = true
  `, [topicId, actorUserId]);
  if (membership.rowCount) return;
  try {
    await requireTechnicalManager(client, topicId, actorUserId);
  } catch (error) {
    if (error instanceof DevelopmentConceptError && [403, 404].includes(error.statusCode)) {
      fail('Development topic not found', 404);
    }
    throw error;
  }
}

async function latestRevision(client, topicId) {
  const result = await client.query(`
    SELECT revision.*, submission.id AS submission_id,
      submission.submitted_by_user_id, submission.submitted_at,
      decision.id AS decision_id, decision.decision_code,
      decision.reason AS decision_reason, decision.decided_by_user_id,
      decision.is_self_review, decision.self_review_reason, decision.delegation_id,
      decision.decided_at
    FROM development_concept_revisions revision
    LEFT JOIN development_concept_submissions submission ON submission.revision_id = revision.id
    LEFT JOIN development_concept_decisions decision ON decision.submission_id = submission.id
    WHERE revision.topic_id = $1
    ORDER BY revision.revision_no DESC LIMIT 1
  `, [topicId]);
  return result.rows[0] || null;
}

async function advanceTopic(client, topic, actorUserId, phase) {
  const updated = await client.query(`
    UPDATE development_topics
    SET phase = $2, row_version = row_version + 1,
        updated_by_user_id = $3, updated_at = now()
    WHERE id = $1 RETURNING row_version, phase
  `, [topic.id, phase, actorUserId]);
  return {
    rowVersion: Number(updated.rows[0].row_version),
    phase: updated.rows[0].phase
  };
}

function decisionResult(row, topicUpdate, repeated = false) {
  return {
    id: Number(row.id),
    submissionId: Number(row.submission_id),
    decisionCode: row.decision_code,
    reason: row.reason,
    decidedByUserId: Number(row.decided_by_user_id),
    isSelfReview: row.is_self_review,
    selfReviewReason: row.self_review_reason,
    delegationId: row.delegation_id ? Number(row.delegation_id) : null,
    decidedAt: row.decided_at,
    topic: topicUpdate,
    repeated
  };
}

export function createDevelopmentConceptRepository(pool) {
  return {
    async getConceptRevision(input) {
      return transaction(pool, async (client) => {
        const topic = await loadTopic(client, input.topicId, false);
        await requireConceptViewer(client, topic.id, input.actorUserId);
        const found = await client.query(`
          SELECT revision.*, submission.id AS submission_id,
            submission.submitted_at, submission.submitted_by_user_id,
            decision.id AS decision_id, decision.decision_code,
            decision.reason AS decision_reason, decision.decided_at,
            decision.decided_by_user_id, decision.is_self_review,
            decision.self_review_reason, decision.delegation_id
          FROM development_concept_revisions revision
          LEFT JOIN development_concept_submissions submission
            ON submission.revision_id = revision.id
          LEFT JOIN development_concept_decisions decision
            ON decision.submission_id = submission.id
          WHERE revision.topic_id = $1 AND revision.id = $2
        `, [topic.id, input.revisionId]);
        if (!found.rowCount) fail('Concept revision not found', 404);
        const latest = await latestRevision(client, topic.id);
        const row = found.rows[0];
        return {
          topicId: Number(topic.id), topicNo: topic.topic_no,
          topicTitle: topic.title, phase: topic.phase,
          revisionId: Number(row.id), revisionNo: Number(row.revision_no),
          isCurrent: Number(latest.id) === Number(row.id),
          snapshot: row.snapshot, snapshotSha256: row.snapshot_sha256,
          authoredByUserId: Number(row.authored_by_user_id),
          authoredAt: row.authored_at,
          submittedAt: row.submitted_at,
          submittedByUserId: row.submitted_by_user_id
            ? Number(row.submitted_by_user_id) : null,
          decisionCode: row.decision_code,
          decisionReason: row.decision_reason,
          decidedAt: row.decided_at,
          decidedByUserId: row.decided_by_user_id
            ? Number(row.decided_by_user_id) : null,
          isSelfReview: row.is_self_review || false,
          selfReviewReason: row.self_review_reason || '',
          delegationId: row.delegation_id ? Number(row.delegation_id) : null
        };
      });
    },

    async createConceptRevision(input) {
      return transaction(pool, async (client) => {
        const topic = await loadTopic(client, input.topicId);
        await requireOwner(client, topic, input.actorUserId);
        requireVersion(topic, input.expectedRowVersion);
        if (!['idea', 'exploration', 'concept_review', 'detailed_design'].includes(topic.phase)) {
          fail('Concept revision is unavailable in this topic phase', 409);
        }
        const latest = await latestRevision(client, topic.id);
        if (latest?.submission_id && !latest.decision_id) {
          fail('Pending review must be decided before a new revision', 409);
        }
        const next = (latest ? Number(latest.revision_no) : 0) + 1;
        // Any new sealed revision invalidates the former design qualification.
        const topicUpdate = await advanceTopic(client, topic, input.actorUserId,
          ['concept_review', 'detailed_design'].includes(topic.phase) ? 'exploration' : topic.phase);
        const created = await client.query(`
          INSERT INTO development_concept_revisions (
            topic_id, revision_no, snapshot, snapshot_sha256, authored_by_user_id
          ) VALUES ($1, $2, $3::jsonb, $4, $5)
          RETURNING *
        `, [topic.id, next, JSON.stringify(input.snapshot), input.snapshotSha256,
          input.actorUserId]);
        const row = created.rows[0];
        return {
          id: Number(row.id), topicId: Number(row.topic_id),
          revisionNo: Number(row.revision_no), snapshot: row.snapshot,
          snapshotSha256: row.snapshot_sha256, authoredAt: row.authored_at,
          topic: topicUpdate
        };
      });
    },

    async submitConceptRevision(input) {
      return transaction(pool, async (client) => {
        const topic = await loadTopic(client, input.topicId);
        await requireOwner(client, topic, input.actorUserId);
        requireVersion(topic, input.expectedRowVersion);
        if (!['idea', 'exploration'].includes(topic.phase)) {
          fail('Concept cannot be submitted in this topic phase', 409);
        }
        const latest = await latestRevision(client, topic.id);
        if (!latest || Number(latest.id) !== input.revisionId) {
          fail('Concept revision is no longer current', 409);
        }
        if (latest.submission_id) fail('Concept revision was already submitted', 409);
        assertConceptReadyForSubmission(latest.snapshot);
        const created = await client.query(`
          INSERT INTO development_concept_submissions (revision_id, submitted_by_user_id)
          VALUES ($1, $2) RETURNING *
        `, [input.revisionId, input.actorUserId]);
        const topicUpdate = await advanceTopic(client, topic, input.actorUserId, 'concept_review');
        return {
          id: Number(created.rows[0].id), revisionId: input.revisionId,
          submittedAt: created.rows[0].submitted_at, topic: topicUpdate
        };
      });
    },

    async decideConceptRevision(input) {
      return transaction(pool, async (client) => {
        const topic = await loadTopic(client, input.topicId);
        const delegationId = await requireTechnicalManager(client, topic.id, input.actorUserId);
        const latest = await latestRevision(client, topic.id);
        const priorKey = await client.query(`
          SELECT decision.*, revision.id AS revision_id
          FROM development_concept_decisions decision
          JOIN development_concept_submissions submission ON submission.id = decision.submission_id
          JOIN development_concept_revisions revision ON revision.id = submission.revision_id
          WHERE decision.idempotency_key = $1
        `, [input.idempotencyKey]);
        if (priorKey.rowCount) {
          const prior = priorKey.rows[0];
          if (Number(prior.revision_id) === input.revisionId &&
              Number(latest?.id) === input.revisionId &&
              Number(prior.decided_by_user_id) === input.actorUserId &&
              prior.decision_code === input.decisionCode && prior.reason === input.reason &&
              prior.self_review_reason === input.selfReviewReason) {
            return decisionResult(prior, {
              rowVersion: Number(topic.row_version), phase: topic.phase
            }, true);
          }
          fail('Idempotency key was already used for another decision', 409);
        }
        requireVersion(topic, input.expectedRowVersion);
        if (topic.phase !== 'concept_review') fail('Concept is not awaiting review', 409);
        if (!latest || Number(latest.id) !== input.revisionId || !latest.submission_id) {
          fail('Concept revision is no longer the current submission', 409);
        }
        if (latest.decision_id) fail('Concept was already decided', 409);
        const isSelfReview = [latest.authored_by_user_id, latest.submitted_by_user_id]
          .some((id) => Number(id) === input.actorUserId);
        if (isSelfReview && !input.selfReviewReason) {
          throw new DevelopmentConceptError('Self-review reason is required', 422,
            ['selfReviewReason']);
        }
        const created = await client.query(`
          INSERT INTO development_concept_decisions (
            submission_id, decision_code, reason, decided_by_user_id,
            idempotency_key, is_self_review, self_review_reason, delegation_id
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *
        `, [latest.submission_id, input.decisionCode, input.reason, input.actorUserId,
          input.idempotencyKey, isSelfReview, input.selfReviewReason, delegationId]);
        const topicUpdate = await advanceTopic(client, topic, input.actorUserId,
          input.decisionCode === 'revise_required' ? 'exploration' : 'concept_review');
        return decisionResult(created.rows[0], topicUpdate);
      });
    },

    async getConceptGate(input) {
      return transaction(pool, async (client) => {
        const topic = await loadTopic(client, input.topicId, false);
        await requireConceptViewer(client, topic.id, input.actorUserId);
        const latest = await latestRevision(client, topic.id);
        const handoff = latest ? await client.query(`
          SELECT id, requested_at FROM development_design_handoffs
          WHERE topic_id = $1 AND revision_id = $2
        `, [topic.id, latest.id]) : { rows: [] };
        return {
          topicId: Number(topic.id), topicNo: topic.topic_no,
          ownerUserId: Number(topic.owner_user_id),
          phase: topic.phase, rowVersion: Number(topic.row_version),
          currentRevisionId: latest ? Number(latest.id) : null,
          currentRevisionNo: latest ? Number(latest.revision_no) : null,
          currentSnapshotSha256: latest?.snapshot_sha256 || null,
          currentSnapshot: latest?.snapshot || null,
          authoredByUserId: latest ? Number(latest.authored_by_user_id) : null,
          authoredAt: latest?.authored_at || null,
          submissionId: latest?.submission_id ? Number(latest.submission_id) : null,
          submittedByUserId: latest?.submitted_by_user_id
            ? Number(latest.submitted_by_user_id) : null,
          submittedAt: latest?.submitted_at || null,
          decisionCode: latest?.decision_code || null,
          decisionId: latest?.decision_id ? Number(latest.decision_id) : null,
          decisionReason: latest?.decision_reason || null,
          decidedByUserId: latest?.decided_by_user_id
            ? Number(latest.decided_by_user_id) : null,
          decidedAt: latest?.decided_at || null,
          isSelfReview: latest?.is_self_review || false,
          selfReviewReason: latest?.self_review_reason || '',
          delegationId: latest?.delegation_id ? Number(latest.delegation_id) : null,
          eligibleForFormalDesign: topic.phase === 'concept_review'
            && latest?.decision_code === 'approved' && !handoff.rows.length,
          handoffId: handoff.rows.length ? Number(handoff.rows[0].id) : null
        };
      });
    },

    async requestFormalDesignHandoff(input) {
      return transaction(pool, async (client) => {
        const topic = await loadTopic(client, input.topicId);
        await requireOwner(client, topic, input.actorUserId);
        const latest = await latestRevision(client, topic.id);
        const priorKey = await client.query(`
          SELECT * FROM development_design_handoffs WHERE idempotency_key = $1
        `, [input.idempotencyKey]);
        if (priorKey.rowCount) {
          const prior = priorKey.rows[0];
          if (Number(prior.topic_id) === input.topicId &&
              Number(prior.revision_id) === input.revisionId &&
              Number(latest?.id) === input.revisionId &&
              Number(prior.requested_by_user_id) === input.actorUserId) {
            return {
              id: Number(prior.id), revisionId: input.revisionId,
              decisionId: Number(prior.decision_id),
              requestedAt: prior.requested_at, repeated: true,
              topic: { rowVersion: Number(topic.row_version), phase: topic.phase }
            };
          }
          fail('Idempotency key was already used for another handoff', 409);
        }
        requireVersion(topic, input.expectedRowVersion);
        if (topic.phase !== 'concept_review' || !latest ||
            Number(latest.id) !== input.revisionId || latest.decision_code !== 'approved') {
          fail('Current approved concept is required for formal design handoff', 409);
        }
        const created = await client.query(`
          INSERT INTO development_design_handoffs (
            topic_id, revision_id, decision_id, requested_by_user_id, idempotency_key
          ) VALUES ($1, $2, $3, $4, $5) RETURNING *
        `, [topic.id, input.revisionId, latest.decision_id,
          input.actorUserId, input.idempotencyKey]);
        const topicUpdate = await advanceTopic(client, topic, input.actorUserId, 'detailed_design');
        return {
          id: Number(created.rows[0].id), revisionId: input.revisionId,
          decisionId: Number(latest.decision_id),
          requestedAt: created.rows[0].requested_at, repeated: false,
          topic: topicUpdate
        };
      });
    }
  };
}
