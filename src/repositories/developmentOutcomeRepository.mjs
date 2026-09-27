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

async function topicForMember(client, topicId, actorUserId, lock = false) {
  const result = await client.query(`
    SELECT topic.id, topic.topic_no, topic.title, topic.phase, topic.owner_user_id
    FROM development_topics topic
    WHERE topic.id = $1 AND EXISTS (
      SELECT 1 FROM development_memberships membership
      JOIN users actor ON actor.id = membership.user_id
      WHERE membership.topic_id = topic.id AND membership.user_id = $2
        AND membership.added_at <= now() AND membership.ended_at IS NULL
        AND actor.is_active = true
    ) ${lock ? 'FOR UPDATE OF topic' : ''}
  `, [topicId, actorUserId]);
  if (!result.rowCount) fail('Development topic not found', 404);
  return result.rows[0];
}

function mapRevision(row) {
  return {
    id: Number(row.id), topicId: Number(row.topic_id),
    revisionNo: Number(row.revision_no), outcomeKind: row.outcome_kind,
    title: row.title, finding: row.finding, applicability: row.applicability,
    limitations: row.limitations, evidenceReferences: row.evidence_references || [],
    authoredByUserId: Number(row.authored_by_user_id), authoredAt: row.authored_at,
    asset: row.asset_id ? {
      id: Number(row.asset_id), publishedAt: row.published_at,
      publishedByUserId: Number(row.published_by_user_id),
      publicationReason: row.publication_reason,
      withdrawnAt: row.withdrawn_at || null,
      withdrawalReason: row.withdrawal_reason || null
    } : null,
    candidate: row.candidate_id ? {
      id: Number(row.candidate_id), rationale: row.rationale,
      proposedByUserId: Number(row.proposed_by_user_id), proposedAt: row.proposed_at,
      review: row.review_id ? {
        id: Number(row.review_id), decisionCode: row.decision_code,
        reason: row.review_reason, reviewedByUserId: Number(row.reviewed_by_user_id),
        reviewedAt: row.reviewed_at
      } : null
    } : null
  };
}

export function createDevelopmentOutcomeRepository(pool) {
  return {
    async listTopicOutcomes({ topicId, actorUserId }) {
      return transaction(pool, async (client) => {
        const topic = await topicForMember(client, topicId, actorUserId);
        const result = await client.query(`
          SELECT revision.*, candidate.id AS candidate_id, candidate.rationale,
            candidate.proposed_by_user_id, candidate.proposed_at,
            review.id AS review_id, review.decision_code,
            review.reason AS review_reason, review.reviewed_by_user_id,
            review.reviewed_at, asset.id AS asset_id, asset.published_at,
            asset.published_by_user_id, asset.publication_reason,
            withdrawal.withdrawn_at, withdrawal.reason AS withdrawal_reason
          FROM development_outcome_revisions revision
          LEFT JOIN development_asset_candidates candidate
            ON candidate.outcome_revision_id = revision.id
          LEFT JOIN development_asset_candidate_reviews review
            ON review.candidate_id = candidate.id
          LEFT JOIN development_assets asset ON asset.outcome_revision_id = revision.id
          LEFT JOIN development_asset_withdrawals withdrawal ON withdrawal.asset_id = asset.id
          WHERE revision.topic_id = $1
          ORDER BY revision.revision_no DESC
        `, [topicId]);
        return {
          topic: { id: Number(topic.id), topicNo: topic.topic_no,
            title: topic.title, phase: topic.phase, ownerUserId: Number(topic.owner_user_id) },
          revisions: result.rows.map(mapRevision)
        };
      });
    },

    async createOutcomeRevision(input) {
      return transaction(pool, async (client) => {
        await topicForMember(client, input.topicId, input.actorUserId, true);
        const latest = await client.query(`
          SELECT coalesce(max(revision_no), 0)::integer AS last_no
          FROM development_outcome_revisions WHERE topic_id = $1
        `, [input.topicId]);
        const revisionNo = latest.rows[0].last_no + 1;
        const result = await client.query(`
          INSERT INTO development_outcome_revisions (
            topic_id, revision_no, outcome_kind, title, finding, applicability,
            limitations, evidence_references, authored_by_user_id
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9)
          RETURNING *
        `, [input.topicId, revisionNo, input.outcomeKind, input.title,
          input.finding, input.applicability, input.limitations,
          JSON.stringify(input.evidenceReferences), input.actorUserId]);
        return mapRevision(result.rows[0]);
      });
    },

    async proposeAssetCandidate(input) {
      return transaction(pool, async (client) => {
        await topicForMember(client, input.topicId, input.actorUserId, true);
        const latest = await client.query(`
          SELECT id, evidence_references FROM development_outcome_revisions
          WHERE topic_id = $1 ORDER BY revision_no DESC LIMIT 1
        `, [input.topicId]);
        if (Number(latest.rows[0]?.id) !== input.revisionId) {
          fail('Only the current outcome revision may be proposed');
        }
        if (!latest.rows[0].evidence_references?.length) {
          fail('Evidence references are required before asset review', 422);
        }
        const result = await client.query(`
          INSERT INTO development_asset_candidates (
            outcome_revision_id, rationale, proposed_by_user_id
          ) VALUES ($1, $2, $3)
          ON CONFLICT (outcome_revision_id) DO NOTHING RETURNING *
        `, [input.revisionId, input.rationale, input.actorUserId]);
        if (!result.rowCount) fail('Outcome revision is already a candidate');
        return {
          id: Number(result.rows[0].id), outcomeRevisionId: input.revisionId,
          rationale: result.rows[0].rationale,
          proposedByUserId: input.actorUserId, proposedAt: result.rows[0].proposed_at
        };
      });
    },

    async reviewAssetCandidate(input) {
      return transaction(pool, async (client) => {
        await topicForMember(client, input.topicId, input.reviewerUserId, true);
        const candidate = await client.query(`
          SELECT candidate.id, candidate.outcome_revision_id,
            candidate.proposed_by_user_id, revision.authored_by_user_id
          FROM development_asset_candidates candidate
          JOIN development_outcome_revisions revision
            ON revision.id = candidate.outcome_revision_id
          WHERE candidate.id = $1 AND revision.topic_id = $2
        `, [input.candidateId, input.topicId]);
        if (!candidate.rowCount) fail('Asset candidate not found', 404);
        const row = candidate.rows[0];
        if ([row.proposed_by_user_id, row.authored_by_user_id]
          .some((id) => Number(id) === input.reviewerUserId)) {
          fail('Author or proposer cannot review their own outcome', 403);
        }
        const role = await client.query(`
          SELECT bestcrm_development_has_active_role($1, 'technical_manager') AS allowed
        `, [input.reviewerUserId]);
        if (!role.rows[0]?.allowed) fail('Active technical manager required', 403);
        const latest = await client.query(`
          SELECT id FROM development_outcome_revisions
          WHERE topic_id = $1 ORDER BY revision_no DESC LIMIT 1
        `, [input.topicId]);
        if (Number(latest.rows[0]?.id) !== Number(row.outcome_revision_id)) {
          fail('Only the current outcome revision may be reviewed');
        }
        const result = await client.query(`
          INSERT INTO development_asset_candidate_reviews (
            candidate_id, decision_code, reason, reviewed_by_user_id
          ) VALUES ($1, $2, $3, $4)
          ON CONFLICT (candidate_id) DO NOTHING RETURNING *
        `, [input.candidateId, input.decisionCode, input.reason, input.reviewerUserId]);
        if (!result.rowCount) fail('Asset candidate was already reviewed');
        return {
          id: Number(result.rows[0].id), candidateId: input.candidateId,
          decisionCode: result.rows[0].decision_code, reason: result.rows[0].reason,
          reviewedByUserId: input.reviewerUserId,
          reviewedAt: result.rows[0].reviewed_at
        };
      });
    },

    async publishAsset(input) {
      return transaction(pool, async (client) => {
        await topicForMember(client, input.topicId, input.publisherUserId, true);
        const role = await client.query(`
          SELECT bestcrm_development_has_active_role($1, 'technical_manager') AS allowed
        `, [input.publisherUserId]);
        if (!role.rows[0]?.allowed) fail('Active technical manager required', 403);
        const candidate = await client.query(`
          SELECT revision.id AS revision_id, revision.authored_by_user_id,
            candidate.proposed_by_user_id, review.id AS review_id,
            review.decision_code, revision.access_policy_state
          FROM development_asset_candidates candidate
          JOIN development_outcome_revisions revision
            ON revision.id = candidate.outcome_revision_id
          LEFT JOIN development_asset_candidate_reviews review
            ON review.candidate_id = candidate.id
          WHERE candidate.id = $1 AND revision.topic_id = $2
        `, [input.candidateId, input.topicId]);
        if (!candidate.rowCount) fail('Asset candidate not found', 404);
        const row = candidate.rows[0];
        if (row.decision_code !== 'endorsed' || row.access_policy_state !== 'topic_internal') {
          fail('Current internally releasable endorsement is required');
        }
        if ([row.authored_by_user_id, row.proposed_by_user_id]
          .some((id) => Number(id) === input.publisherUserId)) {
          fail('Author or proposer cannot publish their own asset', 403);
        }
        const latest = await client.query(`
          SELECT id FROM development_outcome_revisions
          WHERE topic_id = $1 ORDER BY revision_no DESC LIMIT 1
        `, [input.topicId]);
        if (Number(latest.rows[0]?.id) !== Number(row.revision_id)) {
          fail('Only the current outcome revision may be published');
        }
        const result = await client.query(`
          INSERT INTO development_assets (
            candidate_review_id, outcome_revision_id, publication_reason,
            published_by_user_id
          ) VALUES ($1, $2, $3, $4)
          ON CONFLICT (outcome_revision_id) DO NOTHING RETURNING *
        `, [row.review_id, row.revision_id, input.reason, input.publisherUserId]);
        if (!result.rowCount) fail('Outcome revision was already published');
        return {
          id: Number(result.rows[0].id), outcomeRevisionId: Number(row.revision_id),
          publishedByUserId: input.publisherUserId,
          publishedAt: result.rows[0].published_at
        };
      });
    },

    async withdrawAsset(input) {
      return transaction(pool, async (client) => {
        await topicForMember(client, input.topicId, input.actorUserId, true);
        const role = await client.query(`
          SELECT bestcrm_development_has_active_role($1, 'technical_manager') AS allowed
        `, [input.actorUserId]);
        if (!role.rows[0]?.allowed) fail('Active technical manager required', 403);
        const asset = await client.query(`
          SELECT asset.id FROM development_assets asset
          JOIN development_outcome_revisions revision
            ON revision.id = asset.outcome_revision_id
          WHERE asset.id = $1 AND revision.topic_id = $2
        `, [input.assetId, input.topicId]);
        if (!asset.rowCount) fail('Development asset not found', 404);
        const result = await client.query(`
          INSERT INTO development_asset_withdrawals (
            asset_id, reason, withdrawn_by_user_id
          ) VALUES ($1, $2, $3)
          ON CONFLICT (asset_id) DO NOTHING RETURNING *
        `, [input.assetId, input.reason, input.actorUserId]);
        if (!result.rowCount) fail('Development asset was already withdrawn');
        return { id: Number(result.rows[0].id), assetId: input.assetId,
          withdrawnAt: result.rows[0].withdrawn_at };
      });
    },

    async listVisibleAssets({ actorUserId, limit = 50, offset = 0 }) {
      const result = await pool.query(`
        SELECT asset.id, asset.published_at, asset.publication_reason,
          revision.id AS revision_id, revision.revision_no, revision.outcome_kind,
          revision.title, revision.finding, revision.applicability, revision.limitations,
          topic.id AS topic_id, topic.topic_no, topic.title AS topic_title
        FROM development_assets asset
        JOIN development_outcome_revisions revision ON revision.id = asset.outcome_revision_id
        JOIN development_topics topic ON topic.id = revision.topic_id
        JOIN development_memberships membership
          ON membership.topic_id = topic.id AND membership.user_id = $1
          AND membership.added_at <= now() AND membership.ended_at IS NULL
        JOIN users actor ON actor.id = membership.user_id AND actor.is_active = true
        WHERE NOT EXISTS (
          SELECT 1 FROM development_asset_withdrawals withdrawal
          WHERE withdrawal.asset_id = asset.id
        )
        ORDER BY asset.published_at DESC, asset.id DESC
        LIMIT $2 OFFSET $3
      `, [actorUserId, limit, offset]);
      return result.rows.map((row) => ({
        id: Number(row.id), publishedAt: row.published_at,
        publicationReason: row.publication_reason,
        outcomeRevisionId: Number(row.revision_id), revisionNo: Number(row.revision_no),
        outcomeKind: row.outcome_kind, title: row.title,
        finding: row.finding, applicability: row.applicability,
        limitations: row.limitations,
        topicId: Number(row.topic_id), topicNo: row.topic_no, topicTitle: row.topic_title
      }));
    }
  };
}
