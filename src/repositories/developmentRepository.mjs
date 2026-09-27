import { DevelopmentTopicError } from '../domain/developmentTopics.mjs';

function mapTopic(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    topicNo: row.topic_no,
    title: row.title,
    sourceType: row.source_type,
    problemStatement: row.problem_statement,
    phase: row.phase,
    result: row.result,
    ownerUserId: Number(row.owner_user_id),
    ownerName: row.owner_name || '',
    rowVersion: Number(row.row_version),
    directions: row.direction_codes || [],
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function failNotFound() {
  throw new DevelopmentTopicError('Development topic not found', 404);
}

async function lockActiveOwner(client, topicId, actorUserId) {
  const result = await client.query(`
    SELECT topic.owner_user_id
    FROM development_topics topic
    WHERE topic.id = $1
    FOR UPDATE
  `, [topicId]);
  if (!result.rowCount || Number(result.rows[0].owner_user_id) !== actorUserId) failNotFound();
  const member = await client.query(`
    SELECT 1 FROM development_memberships membership
    JOIN users actor ON actor.id = membership.user_id AND actor.is_active = true
    WHERE membership.topic_id = $1 AND membership.user_id = $2
      AND membership.added_at <= now() AND membership.ended_at IS NULL
    LIMIT 1
  `, [topicId, actorUserId]);
  if (!member.rowCount) failNotFound();
}

async function inTransaction(pool, callback) {
  const client = typeof pool.connect === 'function' ? await pool.connect() : pool;
  try {
    await client.query('BEGIN');
    const value = await callback(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    if (client !== pool) client.release();
  }
}

// The P1 storage methods remain internal. P4 entry points use only the
// visibility-scoped methods below; opportunity links are not exposed here.
export function createDevelopmentRepository(pool) {
  return {
    async createTopic(input) {
      return inTransaction(pool, async (client) => {
        const created = await client.query(`
          INSERT INTO development_topics (
            title, source_type, problem_statement,
            owner_user_id, created_by_user_id, updated_by_user_id
          ) VALUES ($1, $2, $3, $4, $4, $4)
          RETURNING *
        `, [input.title, input.sourceType, input.problemStatement, input.actorUserId]);
        const topic = created.rows[0];
        for (const direction of input.directions) {
          await client.query(`
            INSERT INTO development_topic_directions (
              topic_id, direction_code, added_by_user_id
            ) VALUES ($1, $2, $3)
          `, [topic.id, direction, input.actorUserId]);
        }
        await client.query(`
          INSERT INTO development_memberships (
            topic_id, user_id, responsibility_code, added_by_user_id
          ) VALUES ($1, $2, 'owner', $2)
        `, [topic.id, input.actorUserId]);
        return { ...mapTopic(topic), directions: input.directions };
      });
    },

    async findTopicById(topicId) {
      const result = await pool.query(`
        SELECT topic.*, COALESCE((
          SELECT array_agg(direction.direction_code ORDER BY direction.direction_code)
          FROM development_topic_directions direction
          WHERE direction.topic_id = topic.id AND direction.removed_at IS NULL
        ), '{}'::text[]) AS direction_codes
        FROM development_topics topic
        WHERE topic.id = $1
        LIMIT 1
      `, [Number(topicId)]);
      return mapTopic(result.rows[0]);
    },

    async listVisibleTopics({ actorUserId, limit, offset }) {
      const params = [actorUserId];
      const visibility = `EXISTS (
        SELECT 1 FROM development_memberships membership
        JOIN users actor ON actor.id = membership.user_id AND actor.is_active = true
        WHERE membership.topic_id = topic.id AND membership.user_id = $1
          AND membership.added_at <= now() AND membership.ended_at IS NULL
      )`;
      const totalResult = await pool.query(`
        SELECT count(*)::integer AS total FROM development_topics topic
        WHERE ${visibility}
      `, params);
      const rows = await pool.query(`
        SELECT topic.*, owner.display_name AS owner_name,
          COALESCE((
            SELECT array_agg(direction.direction_code ORDER BY direction.direction_code)
            FROM development_topic_directions direction
            WHERE direction.topic_id = topic.id AND direction.removed_at IS NULL
          ), '{}'::text[]) AS direction_codes
        FROM development_topics topic
        JOIN users owner ON owner.id = topic.owner_user_id
        WHERE ${visibility}
        ORDER BY topic.updated_at DESC, topic.id DESC
        LIMIT $2 OFFSET $3
      `, [...params, limit, offset]);
      return { topics: rows.rows.map(mapTopic), total: Number(totalResult.rows[0].total) };
    },

    async findVisibleTopicById({ topicId, actorUserId }) {
      const result = await pool.query(`
        SELECT topic.*, owner.display_name AS owner_name,
          COALESCE((
            SELECT array_agg(direction.direction_code ORDER BY direction.direction_code)
            FROM development_topic_directions direction
            WHERE direction.topic_id = topic.id AND direction.removed_at IS NULL
          ), '{}'::text[]) AS direction_codes
        FROM development_topics topic
        JOIN users owner ON owner.id = topic.owner_user_id
        WHERE topic.id = $1 AND EXISTS (
          SELECT 1 FROM development_memberships membership
          JOIN users actor ON actor.id = membership.user_id AND actor.is_active = true
          WHERE membership.topic_id = topic.id AND membership.user_id = $2
            AND membership.added_at <= now() AND membership.ended_at IS NULL
        )
        LIMIT 1
      `, [topicId, actorUserId]);
      return mapTopic(result.rows[0]);
    },

    async listVisibleDiscussion({ topicId, actorUserId, beforeId = null, limit = 30 }) {
      const result = await pool.query(`
        SELECT event.id, event.actor_user_id, author.display_name AS author_name,
          event.metadata->>'body' AS body, event.created_at
        FROM development_events event
        JOIN users author ON author.id = event.actor_user_id
        WHERE event.topic_id = $1 AND event.event_type = 'discussion_comment'
          AND ($3::bigint IS NULL OR event.id < $3)
          AND EXISTS (
            SELECT 1 FROM development_memberships membership
            JOIN users actor ON actor.id = membership.user_id AND actor.is_active = true
            WHERE membership.topic_id = event.topic_id AND membership.user_id = $2
              AND membership.added_at <= now() AND membership.ended_at IS NULL
          )
        ORDER BY event.id DESC
        LIMIT $4
      `, [topicId, actorUserId, beforeId, limit + 1]);
      return {
        comments: result.rows.slice(0, limit).map((row) => ({
          id: Number(row.id), authorUserId: Number(row.actor_user_id),
          authorName: row.author_name, body: row.body, createdAt: row.created_at
        })),
        hasMore: result.rows.length > limit
      };
    },

    async appendVisibleDiscussion({ topicId, actorUserId, body }) {
      return inTransaction(pool, async (client) => {
        const membership = await client.query(`
          SELECT membership.id
          FROM development_memberships membership
          JOIN users actor ON actor.id = membership.user_id AND actor.is_active = true
          WHERE membership.topic_id = $1 AND membership.user_id = $2
            AND membership.added_at <= now() AND membership.ended_at IS NULL
          FOR SHARE OF membership, actor
        `, [topicId, actorUserId]);
        if (!membership.rowCount) failNotFound();
        const result = await client.query(`
          INSERT INTO development_events (topic_id, event_type, actor_user_id, metadata)
          VALUES ($1, 'discussion_comment', $2, jsonb_build_object('body', $3::text))
          RETURNING id, created_at
        `, [topicId, actorUserId, body]);
        return { id: Number(result.rows[0].id), topicId, actorUserId,
          body, createdAt: result.rows[0].created_at };
      });
    },

    async listVisibleCurrentMembers({ topicId, actorUserId }) {
      const result = await pool.query(`
        SELECT membership.user_id, membership.responsibility_code,
          member.display_name, member.username, member.is_active
        FROM development_memberships membership
        JOIN users member ON member.id = membership.user_id
        WHERE membership.topic_id = $1 AND membership.added_at <= now()
          AND membership.ended_at IS NULL AND EXISTS (
            SELECT 1 FROM development_memberships viewer
            JOIN users actor ON actor.id = viewer.user_id AND actor.is_active = true
            WHERE viewer.topic_id = $1 AND viewer.user_id = $2
              AND viewer.added_at <= now() AND viewer.ended_at IS NULL
          )
        ORDER BY member.display_name, membership.id
      `, [topicId, actorUserId]);
      return result.rows.map((row) => ({
        userId: Number(row.user_id), displayName: row.display_name,
        username: row.username, isActive: row.is_active,
        responsibilityCode: row.responsibility_code
      }));
    },

    async listInviteCandidates({ topicId, actorUserId }) {
      const result = await pool.query(`
        SELECT candidate.id, candidate.display_name, candidate.username
        FROM users candidate
        WHERE candidate.is_active = true AND EXISTS (
          SELECT 1 FROM development_topics topic
          JOIN development_memberships owner_member
            ON owner_member.topic_id = topic.id
              AND owner_member.user_id = $2 AND owner_member.ended_at IS NULL
              AND owner_member.added_at <= now()
          JOIN users owner ON owner.id = $2 AND owner.is_active = true
          WHERE topic.id = $1 AND topic.owner_user_id = $2
        ) AND NOT EXISTS (
          SELECT 1 FROM development_memberships existing
          WHERE existing.topic_id = $1 AND existing.user_id = candidate.id
            AND existing.ended_at IS NULL
        )
        ORDER BY candidate.display_name, candidate.id
      `, [topicId, actorUserId]);
      return result.rows.map((row) => ({
        userId: Number(row.id), displayName: row.display_name, username: row.username
      }));
    },

    async addVisibleMember({ topicId, userId, actorUserId }) {
      return inTransaction(pool, async (client) => {
        await lockActiveOwner(client, topicId, actorUserId);
        const candidate = await client.query(`
          SELECT 1 FROM users WHERE id = $1 AND is_active = true FOR SHARE
        `, [userId]);
        if (!candidate.rowCount) {
          throw new DevelopmentTopicError('Invitee must be an active user', 422, ['userId']);
        }
        const result = await client.query(`
          INSERT INTO development_memberships (
            topic_id, user_id, responsibility_code, added_by_user_id
          ) VALUES ($1, $2, 'member', $3)
          ON CONFLICT (topic_id, user_id) WHERE ended_at IS NULL DO NOTHING
          RETURNING id
        `, [topicId, userId, actorUserId]);
        if (!result.rowCount) {
          throw new DevelopmentTopicError('User is already a topic member', 409);
        }
        return { topicId, userId };
      });
    },

    async endVisibleMember({ topicId, userId, actorUserId }) {
      return inTransaction(pool, async (client) => {
        await lockActiveOwner(client, topicId, actorUserId);
        if (userId === actorUserId) {
          throw new DevelopmentTopicError('Topic owner cannot remove their own membership', 422);
        }
        const result = await client.query(`
          UPDATE development_memberships
          SET ended_by_user_id = $3, ended_at = now()
          WHERE topic_id = $1 AND user_id = $2 AND ended_at IS NULL
          RETURNING id
        `, [topicId, userId, actorUserId]);
        if (!result.rowCount) failNotFound();
        return { topicId, userId };
      });
    },

    async addMember({ topicId, userId, responsibilityCode, actorUserId }) {
      const result = await pool.query(`
        INSERT INTO development_memberships (
          topic_id, user_id, responsibility_code, added_by_user_id
        ) VALUES ($1, $2, $3, $4)
        ON CONFLICT (topic_id, user_id) WHERE ended_at IS NULL DO NOTHING
        RETURNING id
      `, [topicId, userId, responsibilityCode, actorUserId]);
      return result.rowCount > 0;
    },

    async linkOpportunity({ topicId, opportunityId, reason = '', actorUserId }) {
      const result = await pool.query(`
        INSERT INTO development_opportunity_links (
          topic_id, opportunity_id, link_reason, linked_by_user_id
        ) VALUES ($1, $2, $3, $4)
        ON CONFLICT (topic_id, opportunity_id) WHERE unlinked_at IS NULL DO NOTHING
        RETURNING id
      `, [topicId, opportunityId, reason, actorUserId]);
      return result.rowCount > 0;
    }
  };
}
