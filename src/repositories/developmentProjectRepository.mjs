import { DevelopmentProjectError } from '../domain/developmentProjects.mjs';

function dateOnly(value) {
  if (value instanceof Date) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
  }
  return String(value).slice(0, 10);
}

function itemCode(row) {
  return `${row.item_kind === 'concept_gate' ? 'G' : 'SP'}-${String(row.ordinal).padStart(2, '0')}`;
}

function mapProject(row) {
  if (!row) return null;
  return {
    id: Number(row.id), projectNo: row.project_no, title: row.title,
    objective: row.objective, plannedStartOn: dateOnly(row.planned_start_on),
    plannedEndOn: dateOnly(row.planned_end_on), ownerUserId: Number(row.owner_user_id),
    ownerName: row.owner_name || '', rowVersion: Number(row.row_version),
    createdAt: row.created_at, updatedAt: row.updated_at
  };
}

function mapItem(row) {
  return {
    id: Number(row.id), projectId: Number(row.project_id),
    itemKind: row.item_kind, code: itemCode(row), ordinal: Number(row.ordinal),
    title: row.title, plannedStartOn: dateOnly(row.planned_start_on),
    plannedEndOn: dateOnly(row.planned_end_on),
    gateTopicId: row.gate_topic_id ? Number(row.gate_topic_id) : null,
    gateApproved: row.gate_approved === true,
    gateTopicNo: row.visible_gate_topic_no || null,
    rowVersion: Number(row.row_version)
  };
}

function notFound() {
  throw new DevelopmentProjectError('Development project not found', 404);
}

async function transaction(pool, callback) {
  const client = typeof pool.connect === 'function' ? await pool.connect() : pool;
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    if (client !== pool) client.release();
  }
}

async function readTransaction(pool, callback) {
  const client = typeof pool.connect === 'function' ? await pool.connect() : pool;
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    if (client !== pool) client.release();
  }
}

async function visibleProject(client, { projectId, actorUserId }) {
  const result = await client.query(`
    SELECT project.*, owner.display_name AS owner_name
    FROM development_projects project
    JOIN users owner ON owner.id = project.owner_user_id
    WHERE project.id = $1 AND EXISTS (
      SELECT 1 FROM development_project_memberships member
      JOIN users actor ON actor.id = member.user_id AND actor.is_active = true
      WHERE member.project_id = project.id AND member.user_id = $2
        AND member.added_at <= now() AND member.ended_at IS NULL
    )
  `, [projectId, actorUserId]);
  if (!result.rowCount) notFound();
  return mapProject(result.rows[0]);
}

async function requireOwner(client, projectId, actorUserId) {
  const result = await client.query(`
    SELECT project.* FROM development_projects project
    JOIN users actor ON actor.id = $2 AND actor.is_active = true
    JOIN development_project_memberships membership
      ON membership.project_id = project.id AND membership.user_id = actor.id
        AND membership.added_at <= now() AND membership.ended_at IS NULL
    WHERE project.id = $1 AND project.owner_user_id = actor.id
    FOR UPDATE OF project
  `, [projectId, actorUserId]);
  if (!result.rowCount) notFound();
  return result.rows[0];
}

async function requireTopicMember(client, topicId, actorUserId) {
  const result = await client.query(`
    SELECT 1 FROM development_topics topic
    JOIN development_memberships membership ON membership.topic_id = topic.id
    JOIN users actor ON actor.id = membership.user_id AND actor.is_active = true
    WHERE topic.id = $1 AND membership.user_id = $2
      AND membership.added_at <= now() AND membership.ended_at IS NULL
    LIMIT 1
  `, [topicId, actorUserId]);
  if (!result.rowCount) {
    throw new DevelopmentProjectError('Development topic is not available', 404);
  }
}

function requireInsideProject(item, project) {
  const projectStart = dateOnly(project.planned_start_on);
  const projectEnd = dateOnly(project.planned_end_on);
  if (item.plannedStartOn < projectStart || item.plannedEndOn > projectEnd) {
    throw new DevelopmentProjectError('Plan item must fit within project dates', 422,
      ['plannedStartOn', 'plannedEndOn']);
  }
}

async function insertPlanItem(client, { projectId, actorUserId, item }) {
  const next = await client.query(`
    SELECT COALESCE(max(ordinal), 0) + 1 AS ordinal
    FROM development_project_items
    WHERE project_id = $1 AND item_kind = $2
  `, [projectId, item.itemKind]);
  const created = await client.query(`
    INSERT INTO development_project_items (
      project_id, item_kind, ordinal, title, planned_start_on, planned_end_on,
      gate_topic_id, created_by_user_id, updated_by_user_id
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8) RETURNING *
  `, [projectId, item.itemKind, next.rows[0].ordinal, item.title,
    item.plannedStartOn, item.plannedEndOn, item.gateTopicId, actorUserId]);
  return mapItem(created.rows[0]);
}

async function insertDependency(client, { projectId, actorUserId, dependency }) {
  const result = await client.query(`
    INSERT INTO development_project_dependencies (
      project_id, predecessor_item_id, successor_item_id,
      relation_code, lag_calendar_days, linked_by_user_id
    ) VALUES ($1, $2, $3, $4, $5, $6)
    ON CONFLICT (predecessor_item_id, successor_item_id)
      WHERE ended_at IS NULL DO NOTHING RETURNING id
  `, [projectId, dependency.predecessorItemId, dependency.successorItemId,
    dependency.relationCode, dependency.lagCalendarDays, actorUserId]);
  if (!result.rowCount) throw new DevelopmentProjectError('Dependency already exists', 409);
  return { id: Number(result.rows[0].id), ...dependency };
}

function translateDependencyCycle(error) {
  if (/Development project dependency cycle is not allowed/i.test(error.message)) {
    throw new DevelopmentProjectError('Dependency would create a cycle', 409);
  }
  throw error;
}

export function createDevelopmentProjectRepository(pool) {
  return {
    async createProject(input) {
      return transaction(pool, async (client) => {
        const actor = await client.query(`
          SELECT 1 FROM users WHERE id = $1 AND is_active = true FOR SHARE
        `, [input.actorUserId]);
        if (!actor.rowCount) throw new DevelopmentProjectError('Active user required', 403);
        const created = await client.query(`
          INSERT INTO development_projects (
            title, objective, planned_start_on, planned_end_on,
            owner_user_id, created_by_user_id, updated_by_user_id
          ) VALUES ($1, $2, $3, $4, $5, $5, $5) RETURNING *
        `, [input.title, input.objective, input.plannedStartOn,
          input.plannedEndOn, input.actorUserId]);
        await client.query(`
          INSERT INTO development_project_memberships (
            project_id, user_id, added_by_user_id
          ) VALUES ($1, $2, $2)
        `, [created.rows[0].id, input.actorUserId]);
        return mapProject(created.rows[0]);
      });
    },

    async listVisibleProjects({ actorUserId, limit, offset }) {
      const visible = `EXISTS (
        SELECT 1 FROM development_project_memberships member
        JOIN users actor ON actor.id = member.user_id AND actor.is_active = true
        WHERE member.project_id = project.id AND member.user_id = $1
          AND member.added_at <= now() AND member.ended_at IS NULL
      )`;
      const total = await pool.query(`
        SELECT count(*)::integer AS n FROM development_projects project WHERE ${visible}
      `, [actorUserId]);
      const result = await pool.query(`
        SELECT project.*, owner.display_name AS owner_name
        FROM development_projects project
        JOIN users owner ON owner.id = project.owner_user_id
        WHERE ${visible}
        ORDER BY project.updated_at DESC, project.id DESC LIMIT $2 OFFSET $3
      `, [actorUserId, limit, offset]);
      return { projects: result.rows.map(mapProject), total: Number(total.rows[0].n) };
    },

    async getVisibleProject({ projectId, actorUserId }) {
      return visibleProject(pool, { projectId, actorUserId });
    },

    async updateProjectDates({ projectId, actorUserId, expectedRowVersion,
      plannedStartOn, plannedEndOn }) {
      return transaction(pool, async (client) => {
        const project = await requireOwner(client, projectId, actorUserId);
        if (Number(project.row_version) !== expectedRowVersion) {
          throw new DevelopmentProjectError('Project changed; reload before editing', 409);
        }
        const outside = await client.query(`
          SELECT 1 FROM development_project_items
          WHERE project_id = $1 AND (planned_start_on < $2 OR planned_end_on > $3)
          LIMIT 1
        `, [projectId, plannedStartOn, plannedEndOn]);
        if (outside.rowCount) {
          throw new DevelopmentProjectError('Project dates must contain every plan item', 422,
            ['plannedStartOn', 'plannedEndOn']);
        }
        const updated = await client.query(`
          UPDATE development_projects
          SET planned_start_on = $2, planned_end_on = $3,
            updated_by_user_id = $4, updated_at = now(), row_version = row_version + 1
          WHERE id = $1 RETURNING *
        `, [projectId, plannedStartOn, plannedEndOn, actorUserId]);
        return mapProject(updated.rows[0]);
      });
    },

    async getVisiblePlan({ projectId, actorUserId }) {
      return readTransaction(pool, async (client) => {
      const project = await visibleProject(client, { projectId, actorUserId });
      const itemResult = await client.query(`
          SELECT item.*,
            CASE WHEN item.item_kind = 'concept_gate'
              AND gate_topic.phase NOT IN ('paused', 'stopped')
              AND latest_decision.decision_code = 'approved'
              THEN true ELSE false END AS gate_approved,
            CASE WHEN topic_member.user_id IS NOT NULL
              THEN gate_topic.topic_no ELSE NULL END AS visible_gate_topic_no
          FROM development_project_items item
          LEFT JOIN development_topics gate_topic ON gate_topic.id = item.gate_topic_id
          LEFT JOIN LATERAL (
            SELECT decision.decision_code
            FROM development_concept_revisions revision
            LEFT JOIN development_concept_submissions submission
              ON submission.revision_id = revision.id
            LEFT JOIN development_concept_decisions decision
              ON decision.submission_id = submission.id
            WHERE revision.topic_id = item.gate_topic_id
            ORDER BY revision.revision_no DESC LIMIT 1
          ) latest_decision ON true
          LEFT JOIN development_memberships topic_member
            ON topic_member.topic_id = item.gate_topic_id
              AND topic_member.user_id = $2 AND topic_member.ended_at IS NULL
              AND topic_member.added_at <= now()
          WHERE item.project_id = $1
          ORDER BY item.planned_start_on, item.item_kind DESC, item.ordinal, item.id
        `, [projectId, actorUserId]);
      const dependencyResult = await client.query(`
          SELECT id, predecessor_item_id, successor_item_id, relation_code,
            lag_calendar_days
          FROM development_project_dependencies
          WHERE project_id = $1 AND ended_at IS NULL ORDER BY id
        `, [projectId]);
      const linkResult = await client.query(`
          SELECT link.item_id, link.topic_id, link.is_primary,
            CASE WHEN membership.user_id IS NOT NULL THEN topic.topic_no ELSE NULL END AS topic_no,
            CASE WHEN membership.user_id IS NOT NULL THEN topic.title ELSE NULL END AS topic_title
          FROM development_project_topic_links link
          JOIN development_topics topic ON topic.id = link.topic_id
          LEFT JOIN development_memberships membership ON membership.topic_id = topic.id
            AND membership.user_id = $2 AND membership.ended_at IS NULL
            AND membership.added_at <= now()
          WHERE link.project_id = $1 AND link.ended_at IS NULL
          ORDER BY link.item_id, link.is_primary DESC, link.id
        `, [projectId, actorUserId]);
      const memberResult = await client.query(`
          SELECT member.user_id, user_record.display_name, user_record.is_active
          FROM development_project_memberships member
          JOIN users user_record ON user_record.id = member.user_id
          WHERE member.project_id = $1 AND member.ended_at IS NULL
          ORDER BY user_record.display_name, member.id
        `, [projectId]);
      const eventResult = await client.query(`
          SELECT event_type, created_at, actor_user_id, metadata
          FROM development_project_events WHERE project_id = $1
          ORDER BY id DESC LIMIT 20
        `, [projectId]);
      return {
        project,
        items: itemResult.rows.map((row) => {
          const item = mapItem(row);
          if (item.itemKind === 'concept_gate' && !row.visible_gate_topic_no) {
            item.gateTopicId = null;
          }
          return item;
        }),
        dependencies: dependencyResult.rows.map((row) => ({
          id: Number(row.id), predecessorItemId: Number(row.predecessor_item_id),
          successorItemId: Number(row.successor_item_id), relationCode: row.relation_code,
          lagCalendarDays: Number(row.lag_calendar_days)
        })),
        topicLinks: linkResult.rows.map((row) => ({
          itemId: Number(row.item_id), topicId: row.topic_no ? Number(row.topic_id) : null,
          topicNo: row.topic_no, topicTitle: row.topic_title,
          isPrimary: row.is_primary
        })),
        members: memberResult.rows.map((row) => ({
          userId: Number(row.user_id), displayName: row.display_name,
          isActive: row.is_active
        })),
        events: eventResult.rows.map((row) => ({
          eventType: row.event_type, createdAt: row.created_at,
          actorUserId: Number(row.actor_user_id), metadata: row.metadata
        }))
      };
      });
    },

    async listInviteCandidates({ projectId, actorUserId }) {
      const result = await pool.query(`
        SELECT candidate.id, candidate.display_name
        FROM users candidate
        WHERE candidate.is_active = true AND EXISTS (
          SELECT 1 FROM development_projects project
          JOIN development_project_memberships owner_member
            ON owner_member.project_id = project.id
              AND owner_member.user_id = $2 AND owner_member.ended_at IS NULL
              AND owner_member.added_at <= now()
          JOIN users owner ON owner.id = $2 AND owner.is_active = true
          WHERE project.id = $1 AND project.owner_user_id = $2
        ) AND NOT EXISTS (
          SELECT 1 FROM development_project_memberships existing
          WHERE existing.project_id = $1 AND existing.user_id = candidate.id
            AND existing.ended_at IS NULL
        ) ORDER BY candidate.display_name, candidate.id
      `, [projectId, actorUserId]);
      return result.rows.map((row) => ({ id: Number(row.id), name: row.display_name }));
    },

    async listLinkableTopics({ actorUserId }) {
      const result = await pool.query(`
        SELECT topic.id, topic.topic_no, topic.title
        FROM development_topics topic
        JOIN development_memberships member ON member.topic_id = topic.id
          AND member.user_id = $1 AND member.ended_at IS NULL
          AND member.added_at <= now()
        JOIN users actor ON actor.id = member.user_id AND actor.is_active = true
        ORDER BY topic.updated_at DESC, topic.id DESC LIMIT 100
      `, [actorUserId]);
      return result.rows.map((row) => ({ id: Number(row.id), no: row.topic_no, title: row.title }));
    },

    async addMember({ projectId, userId, actorUserId }) {
      return transaction(pool, async (client) => {
        await requireOwner(client, projectId, actorUserId);
        const user = await client.query(`
          SELECT 1 FROM users WHERE id = $1 AND is_active = true FOR SHARE
        `, [userId]);
        if (!user.rowCount) throw new DevelopmentProjectError('Invitee must be active', 422, ['userId']);
        const result = await client.query(`
          INSERT INTO development_project_memberships (project_id, user_id, added_by_user_id)
          VALUES ($1, $2, $3)
          ON CONFLICT (project_id, user_id) WHERE ended_at IS NULL DO NOTHING
          RETURNING id
        `, [projectId, userId, actorUserId]);
        if (!result.rowCount) throw new DevelopmentProjectError('Already a project member', 409);
        return { projectId, userId };
      });
    },

    async endMember({ projectId, userId, actorUserId }) {
      return transaction(pool, async (client) => {
        await requireOwner(client, projectId, actorUserId);
        if (userId === actorUserId) {
          throw new DevelopmentProjectError('Owner cannot remove own membership', 422);
        }
        const result = await client.query(`
          UPDATE development_project_memberships
          SET ended_by_user_id = $3, ended_at = now()
          WHERE project_id = $1 AND user_id = $2 AND ended_at IS NULL RETURNING id
        `, [projectId, userId, actorUserId]);
        if (!result.rowCount) notFound();
        return { projectId, userId };
      });
    },

    async addItem({ projectId, actorUserId, item }) {
      return transaction(pool, async (client) => {
        const project = await requireOwner(client, projectId, actorUserId);
        requireInsideProject(item, project);
        if (item.itemKind === 'concept_gate') {
          await requireTopicMember(client, item.gateTopicId, actorUserId);
          const linked = await client.query(`
            SELECT 1 FROM development_project_topic_links
            WHERE project_id = $1 AND topic_id = $2 AND ended_at IS NULL LIMIT 1
          `, [projectId, item.gateTopicId]);
          if (!linked.rowCount) {
            throw new DevelopmentProjectError('Link the topic to a subproject before adding its gate',
              422, ['gateTopicId']);
          }
        }
        return insertPlanItem(client, { projectId, actorUserId, item });
      });
    },

    async addSubprojectWithDependencies({ projectId, actorUserId, item,
      upstream, downstream }) {
      try {
        return await transaction(pool, async (client) => {
          const project = await requireOwner(client, projectId, actorUserId);
          requireInsideProject(item, project);
          const selectedIds = [...new Set([upstream?.itemId, downstream?.itemId]
            .filter((value) => value !== undefined && value !== null))];
          if (selectedIds.length) {
            const endpoints = await client.query(`
              SELECT id FROM development_project_items
              WHERE project_id = $1 AND id = ANY($2::bigint[])
            `, [projectId, selectedIds]);
            if (endpoints.rowCount !== selectedIds.length) {
              throw new DevelopmentProjectError('Dependency item must belong to this project',
                422, ['upstreamItemId', 'downstreamItemId']);
            }
          }
          const created = await insertPlanItem(client, { projectId, actorUserId, item });
          const dependencies = [];
          if (upstream) {
            dependencies.push(await insertDependency(client, { projectId, actorUserId,
              dependency: { predecessorItemId: upstream.itemId, successorItemId: created.id,
                relationCode: upstream.relationCode,
                lagCalendarDays: upstream.lagCalendarDays } }));
          }
          if (downstream) {
            dependencies.push(await insertDependency(client, { projectId, actorUserId,
              dependency: { predecessorItemId: created.id, successorItemId: downstream.itemId,
                relationCode: downstream.relationCode,
                lagCalendarDays: downstream.lagCalendarDays } }));
          }
          return { ...created, dependencies };
        });
      } catch (error) { translateDependencyCycle(error); }
    },

    async updateItemDates({ projectId, itemId, actorUserId, expectedRowVersion,
      plannedStartOn, plannedEndOn }) {
      return transaction(pool, async (client) => {
        const project = await requireOwner(client, projectId, actorUserId);
        requireInsideProject({ plannedStartOn, plannedEndOn }, project);
        const result = await client.query(`
          UPDATE development_project_items
          SET planned_start_on = $3, planned_end_on = $4,
            updated_by_user_id = $5, updated_at = now(), row_version = row_version + 1
          WHERE project_id = $1 AND id = $2 AND row_version = $6
            AND (item_kind = 'subproject' OR $3::date = $4::date)
          RETURNING *
        `, [projectId, itemId, plannedStartOn, plannedEndOn, actorUserId,
          expectedRowVersion]);
        if (!result.rowCount) {
          throw new DevelopmentProjectError('Plan item changed; reload before editing', 409);
        }
        return mapItem(result.rows[0]);
      });
    },

    async linkTopic({ projectId, itemId, topicId, actorUserId }) {
      return transaction(pool, async (client) => {
        await requireOwner(client, projectId, actorUserId);
        await requireTopicMember(client, topicId, actorUserId);
        const item = await client.query(`
          SELECT 1 FROM development_project_items
          WHERE project_id = $1 AND id = $2 AND item_kind = 'subproject'
        `, [projectId, itemId]);
        if (!item.rowCount) throw new DevelopmentProjectError('Subproject not found', 404);
        const first = await client.query(`
          SELECT 1 FROM development_project_topic_links
          WHERE project_id = $1 AND topic_id = $2 AND ended_at IS NULL LIMIT 1
        `, [projectId, topicId]);
        const created = await client.query(`
          INSERT INTO development_project_topic_links (
            project_id, item_id, topic_id, is_primary, linked_by_user_id
          ) VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (item_id, topic_id) WHERE ended_at IS NULL DO NOTHING RETURNING id
        `, [projectId, itemId, topicId, !first.rowCount, actorUserId]);
        if (!created.rowCount) throw new DevelopmentProjectError('Topic already linked here', 409);
        return { projectId, itemId, topicId, isPrimary: !first.rowCount };
      });
    },

    async addDependency({ projectId, actorUserId, dependency }) {
      try {
        return await transaction(pool, async (client) => {
          await requireOwner(client, projectId, actorUserId);
          const endpoints = await client.query(`
            SELECT id FROM development_project_items
            WHERE project_id = $1 AND id = ANY($2::bigint[])
          `, [projectId, [dependency.predecessorItemId, dependency.successorItemId]]);
          if (endpoints.rowCount !== 2) {
            throw new DevelopmentProjectError('Both plan items must belong to this project', 422,
              ['predecessorItemId', 'successorItemId']);
          }
          return insertDependency(client, { projectId, actorUserId, dependency });
        });
      } catch (error) { translateDependencyCycle(error); }
    },

    async endDependency({ projectId, dependencyId, actorUserId }) {
      return transaction(pool, async (client) => {
        await requireOwner(client, projectId, actorUserId);
        const result = await client.query(`
          UPDATE development_project_dependencies
          SET ended_by_user_id = $3, ended_at = now()
          WHERE project_id = $1 AND id = $2 AND ended_at IS NULL RETURNING id
        `, [projectId, dependencyId, actorUserId]);
        if (!result.rowCount) notFound();
        return { projectId, dependencyId };
      });
    }
  };
}
