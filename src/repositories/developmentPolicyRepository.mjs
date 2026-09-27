import { DevelopmentConceptError } from '../domain/developmentConcepts.mjs';

function fail(message, statusCode = 409) {
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
    if (error.code === 'P0001') fail(error.message);
    throw error;
  } finally {
    client.release();
  }
}

async function topicForUpdate(client, topicId) {
  const result = await client.query('SELECT * FROM development_topics WHERE id = $1 FOR UPDATE',
    [topicId]);
  if (!result.rowCount) fail('Development topic not found', 404);
  return result.rows[0];
}

async function requireOwner(client, topic, actorUserId) {
  if (Number(topic.owner_user_id) !== actorUserId) fail('Development topic not found', 404);
  const result = await client.query(`
    SELECT 1 FROM development_memberships membership
    JOIN users actor ON actor.id = membership.user_id
    WHERE membership.topic_id = $1 AND membership.user_id = $2
      AND membership.ended_at IS NULL AND actor.is_active = true
  `, [topic.id, actorUserId]);
  if (!result.rowCount) fail('Development topic not found', 404);
}

async function requireAdmin(client, actorUserId) {
  const result = await client.query(`
    SELECT bestcrm_development_has_active_role($1, 'administrator') AS allowed
  `, [actorUserId]);
  if (!result.rows[0]?.allowed) fail('Administrator required', 403);
}

async function requireTechnicalManager(client, actorUserId) {
  const result = await client.query(`
    SELECT bestcrm_development_has_active_role($1, 'technical_manager') AS allowed
  `, [actorUserId]);
  if (!result.rows[0]?.allowed) fail('Active technical manager required', 422);
}

function requestResult(row, repeated = false) {
  return {
    id: Number(row.id), topicId: Number(row.topic_id), actionCode: row.action_code,
    fromPhase: row.from_phase, resumeToPhase: row.resume_to_phase,
    topicRowVersion: Number(row.topic_row_version), reason: row.reason,
    requestedByUserId: Number(row.requested_by_user_id), requestedAt: row.requested_at,
    repeated
  };
}

function decisionResult(row, topic, repeated = false) {
  return {
    id: Number(row.id), requestId: Number(row.request_id),
    decisionCode: row.decision_code, reason: row.reason,
    decidedByAdminUserId: Number(row.decided_by_admin_user_id),
    isSelfApproval: row.is_self_approval,
    selfApprovalReason: row.self_approval_reason, decidedAt: row.decided_at,
    topic: { phase: topic.phase, rowVersion: Number(topic.row_version) }, repeated
  };
}

function delegationResult(row, repeated = false) {
  return {
    id: Number(row.id), topicId: Number(row.topic_id),
    absentManagerUserId: Number(row.absent_manager_user_id),
    proxyManagerUserId: Number(row.proxy_manager_user_id),
    validFrom: row.valid_from, validUntil: row.valid_until,
    reason: row.reason, recordedByAdminUserId: Number(row.recorded_by_admin_user_id),
    recordedAt: row.recorded_at, revokedAt: row.revoked_at || null,
    repeated
  };
}

async function getLatestApprovedTransition(client, topicId) {
  const result = await client.query(`
    SELECT request.action_code, request.resume_to_phase
    FROM development_lifecycle_requests request
    JOIN development_lifecycle_decisions decision ON decision.request_id = request.id
    WHERE request.topic_id = $1 AND decision.decision_code = 'approved'
    ORDER BY decision.id DESC LIMIT 1
  `, [topicId]);
  return result.rows[0] || null;
}

export function createDevelopmentPolicyRepository(pool) {
  return {
    async getLifecycle(input) {
      return transaction(pool, async (client) => {
        const topic = await topicForUpdate(client, input.topicId);
        if (input.isAdmin) await requireAdmin(client, input.actorUserId);
        else await requireOwner(client, topic, input.actorUserId);
        const result = await client.query(`
          SELECT request.*, decision.id AS decision_id,
            decision.decision_code, decision.reason AS decision_reason,
            decision.decided_by_admin_user_id, decision.decided_at,
            decision.is_self_approval, decision.self_approval_reason
          FROM development_lifecycle_requests request
          LEFT JOIN development_lifecycle_decisions decision ON decision.request_id = request.id
          WHERE request.topic_id = $1 ORDER BY request.id DESC
        `, [topic.id]);
        return {
          topicId: Number(topic.id), topicNo: topic.topic_no,
          phase: topic.phase, rowVersion: Number(topic.row_version),
          requests: result.rows.map((row) => ({
            ...requestResult(row), decision: row.decision_id ? {
              id: Number(row.decision_id), decisionCode: row.decision_code,
              reason: row.decision_reason,
              decidedByAdminUserId: Number(row.decided_by_admin_user_id),
              decidedAt: row.decided_at, isSelfApproval: row.is_self_approval,
              selfApprovalReason: row.self_approval_reason
            } : null
          }))
        };
      });
    },

    async requestLifecycle(input) {
      return transaction(pool, async (client) => {
        const topic = await topicForUpdate(client, input.topicId);
        await requireOwner(client, topic, input.actorUserId);
        const prior = await client.query(`
          SELECT * FROM development_lifecycle_requests WHERE idempotency_key = $1
        `, [input.idempotencyKey]);
        if (prior.rowCount) {
          const row = prior.rows[0];
          if (Number(row.topic_id) === input.topicId &&
              Number(row.requested_by_user_id) === input.actorUserId &&
              row.action_code === input.actionCode && row.reason === input.reason) {
            return requestResult(row, true);
          }
          fail('Idempotency key was already used for another request');
        }
        if (Number(topic.row_version) !== input.expectedRowVersion) {
          fail('Development topic changed; reload before continuing');
        }
        const pending = await client.query(`
          SELECT 1 FROM development_lifecycle_requests request
          WHERE request.topic_id = $1 AND NOT EXISTS (
            SELECT 1 FROM development_lifecycle_decisions decision
            WHERE decision.request_id = request.id
          ) LIMIT 1
        `, [topic.id]);
        if (pending.rowCount) fail('Another lifecycle request is pending');
        const last = await getLatestApprovedTransition(client, topic.id);
        let resumeToPhase;
        if (input.actionCode === 'resume') {
          if (!['paused', 'stopped'].includes(topic.phase) ||
              !['pause', 'stop'].includes(last?.action_code)) {
            fail('Only paused or stopped topics may resume');
          }
          resumeToPhase = last.resume_to_phase;
        } else if (input.actionCode === 'stop' && topic.phase === 'paused') {
          if (!last?.resume_to_phase) fail('Recovery phase is missing');
          resumeToPhase = last.resume_to_phase;
        } else {
          if (['paused', 'stopped', 'concluded'].includes(topic.phase)) {
            fail('Topic cannot pause or stop from this phase');
          }
          resumeToPhase = topic.phase;
        }
        const result = await client.query(`
          INSERT INTO development_lifecycle_requests (
            topic_id, action_code, from_phase, resume_to_phase,
            topic_row_version, reason, requested_by_user_id, idempotency_key
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *
        `, [topic.id, input.actionCode, topic.phase, resumeToPhase,
          topic.row_version, input.reason, input.actorUserId, input.idempotencyKey]);
        return requestResult(result.rows[0]);
      });
    },

    async decideLifecycle(input) {
      return transaction(pool, async (client) => {
        const topic = await topicForUpdate(client, input.topicId);
        await requireAdmin(client, input.actorUserId);
        const priorKey = await client.query(`
          SELECT * FROM development_lifecycle_decisions WHERE idempotency_key = $1
        `, [input.idempotencyKey]);
        if (priorKey.rowCount) {
          const row = priorKey.rows[0];
          if (Number(row.request_id) === input.requestId &&
              Number(row.decided_by_admin_user_id) === input.actorUserId &&
              row.decision_code === input.decisionCode && row.reason === input.reason &&
              row.self_approval_reason === input.selfApprovalReason) {
            return decisionResult(row, topic, true);
          }
          fail('Idempotency key was already used for another decision');
        }
        const request = await client.query(`
          SELECT * FROM development_lifecycle_requests WHERE id = $1 AND topic_id = $2
        `, [input.requestId, topic.id]);
        if (!request.rowCount) fail('Lifecycle request not found', 404);
        const lifecycle = request.rows[0];
        if (Number(lifecycle.requested_by_user_id) === input.actorUserId &&
            !input.selfApprovalReason) {
          throw new DevelopmentConceptError('Self-approval reason is required', 422,
            ['selfApprovalReason']);
        }
        if (input.decisionCode === 'approved' && (
            lifecycle.from_phase !== topic.phase ||
            Number(lifecycle.topic_row_version) !== Number(topic.row_version))) {
          fail('Lifecycle request is stale');
        }
        const existing = await client.query(`
          SELECT 1 FROM development_lifecycle_decisions WHERE request_id = $1
        `, [lifecycle.id]);
        if (existing.rowCount) fail('Lifecycle request was already decided');
        const result = await client.query(`
          INSERT INTO development_lifecycle_decisions (
            request_id, decision_code, reason, decided_by_admin_user_id,
            self_approval_reason, idempotency_key
          ) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *
        `, [lifecycle.id, input.decisionCode, input.reason, input.actorUserId,
          input.selfApprovalReason, input.idempotencyKey]);
        const updated = await client.query('SELECT phase, row_version FROM development_topics WHERE id = $1',
          [topic.id]);
        return decisionResult(result.rows[0], updated.rows[0]);
      });
    },

    async listReviewerDelegations(input) {
      return transaction(pool, async (client) => {
        await topicForUpdate(client, input.topicId);
        await requireAdmin(client, input.actorUserId);
        const result = await client.query(`
          SELECT delegation.*, revoked.revoked_at FROM development_reviewer_delegations delegation
          LEFT JOIN development_reviewer_delegation_revocations revoked
            ON revoked.delegation_id = delegation.id
          WHERE delegation.topic_id = $1 ORDER BY delegation.id DESC
        `, [input.topicId]);
        return result.rows.map((row) => delegationResult(row));
      });
    },

    async appointReviewerProxy(input) {
      return transaction(pool, async (client) => {
        await topicForUpdate(client, input.topicId);
        await requireAdmin(client, input.actorUserId);
        const prior = await client.query(`
          SELECT * FROM development_reviewer_delegations WHERE idempotency_key = $1
        `, [input.idempotencyKey]);
        if (prior.rowCount) {
          const row = prior.rows[0];
          if (Number(row.topic_id) === input.topicId &&
              Number(row.absent_manager_user_id) === input.absentManagerUserId &&
              Number(row.proxy_manager_user_id) === input.proxyManagerUserId &&
              Number(row.recorded_by_admin_user_id) === input.actorUserId &&
              row.reason === input.reason &&
              new Date(row.valid_from).toISOString() === input.validFrom &&
              new Date(row.valid_until).toISOString() === input.validUntil) {
            return delegationResult(row, true);
          }
          fail('Idempotency key was already used for another appointment');
        }
        if (input.absentManagerUserId === input.proxyManagerUserId) {
          fail('Proxy must be another technical manager', 422);
        }
        await requireTechnicalManager(client, input.absentManagerUserId);
        await requireTechnicalManager(client, input.proxyManagerUserId);
        const assigned = await client.query(`
          SELECT 1 FROM development_memberships
          WHERE topic_id = $1 AND user_id = $2 AND ended_at IS NULL
        `, [input.topicId, input.absentManagerUserId]);
        if (!assigned.rowCount) fail('Absent manager is not assigned to this topic', 422);
        const overlap = await client.query(`
          SELECT 1 FROM development_reviewer_delegations delegation
          WHERE delegation.topic_id = $1 AND delegation.absent_manager_user_id = $2
            AND delegation.valid_from < $4 AND delegation.valid_until > $3
            AND NOT EXISTS (
              SELECT 1 FROM development_reviewer_delegation_revocations revoked
              WHERE revoked.delegation_id = delegation.id
            ) LIMIT 1
        `, [input.topicId, input.absentManagerUserId, input.validFrom, input.validUntil]);
        if (overlap.rowCount) fail('An overlapping proxy appointment already exists');
        const result = await client.query(`
          INSERT INTO development_reviewer_delegations (
            topic_id, absent_manager_user_id, proxy_manager_user_id,
            valid_from, valid_until, reason, recorded_by_admin_user_id,
            idempotency_key
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *
        `, [input.topicId, input.absentManagerUserId, input.proxyManagerUserId,
          input.validFrom, input.validUntil, input.reason, input.actorUserId,
          input.idempotencyKey]);
        return delegationResult(result.rows[0]);
      });
    },

    async revokeReviewerProxy(input) {
      return transaction(pool, async (client) => {
        await topicForUpdate(client, input.topicId);
        await requireAdmin(client, input.actorUserId);
        const prior = await client.query(`
          SELECT * FROM development_reviewer_delegation_revocations WHERE idempotency_key = $1
        `, [input.idempotencyKey]);
        if (prior.rowCount) {
          const row = prior.rows[0];
          if (Number(row.delegation_id) === input.delegationId &&
              Number(row.revoked_by_admin_user_id) === input.actorUserId &&
              row.reason === input.reason) {
            return { id: Number(row.id), delegationId: input.delegationId,
              revokedAt: row.revoked_at, repeated: true };
          }
          fail('Idempotency key was already used for another revocation');
        }
        const delegation = await client.query(`
          SELECT 1 FROM development_reviewer_delegations
          WHERE id = $1 AND topic_id = $2
        `, [input.delegationId, input.topicId]);
        if (!delegation.rowCount) fail('Proxy appointment not found', 404);
        const result = await client.query(`
          INSERT INTO development_reviewer_delegation_revocations (
            delegation_id, revoked_by_admin_user_id, reason, idempotency_key
          ) VALUES ($1, $2, $3, $4) RETURNING *
        `, [input.delegationId, input.actorUserId, input.reason, input.idempotencyKey]);
        const row = result.rows[0];
        return { id: Number(row.id), delegationId: input.delegationId,
          revokedAt: row.revoked_at, repeated: false };
      });
    }
  };
}
