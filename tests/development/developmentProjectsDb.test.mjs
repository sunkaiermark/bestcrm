import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { migrate } from '../../src/db/migrate.mjs';
import { createDevelopmentRepository } from '../../src/repositories/developmentRepository.mjs';
import { createDevelopmentTopicDraft } from '../../src/services/developmentTopicService.mjs';
import { createDevelopmentProjectRepository } from '../../src/repositories/developmentProjectRepository.mjs';
import { createTaskStatisticsRepository } from '../../src/repositories/taskStatisticsRepository.mjs';
import { createDevelopmentProject } from '../../src/services/developmentProjectService.mjs';

const databaseUrl = process.env.DEVELOPMENT_PROJECT_TEST_DATABASE_URL;

test('NPD projects, membership, topic links, gate and dependency graph stay isolated', {
  skip: !databaseUrl ? 'Set DEVELOPMENT_PROJECT_TEST_DATABASE_URL to an isolated local test database' : false
}, async () => {
  const parsed = new URL(databaseUrl);
  assert.equal(parsed.hostname, '127.0.0.1');
  assert.match(parsed.pathname, /^\/bestcrm_npd_project_test[a-z0-9_]*$/);
  const pool = new pg.Pool({ connectionString: databaseUrl });
  try {
    await migrate(pool);
    await migrate(pool);
    const migration = await pool.query(`
      SELECT count(*)::integer AS n FROM schema_migrations
      WHERE name IN ('094_development_projects.sql',
        '096_development_subproject_responsible.sql',
        '097_development_subproject_summary.sql')
    `);
    assert.equal(migration.rows[0].n, 3);

    const suffix = randomUUID().replaceAll('-', '').slice(0, 10);
    async function addUser(label) {
      const result = await pool.query(`
        INSERT INTO users (username, password_hash, display_name)
        VALUES ($1, 'isolated-test-only', $2) RETURNING id
      `, [`npd_project_${label}_${suffix}`, label]);
      return Number(result.rows[0].id);
    }
    const ownerId = await addUser('Project owner');
    const memberId = await addUser('Project member');
    const reviewerId = await addUser('Technical manager');
    const owner = { id: ownerId, isActive: true };
    const topicRepository = createDevelopmentRepository(pool);
    const topic = await createDevelopmentTopicDraft(topicRepository, owner, {
      title: 'Isolated concept', sourceType: 'internal_research',
      directions: ['key_equipment']
    });
    const projectRepository = createDevelopmentProjectRepository(pool);
    const project = await createDevelopmentProject(projectRepository, owner, {
      title: 'Mixer platform', plannedStartOn: '2026-10-01',
      plannedEndOn: '2026-10-31'
    });
    assert.match(project.projectNo, /^RDP-[1-9][0-9]*$/);
    await assert.rejects(projectRepository.getVisibleProject({ projectId: project.id,
      actorUserId: memberId }), /not found/);
    await projectRepository.addMember({ projectId: project.id, userId: memberId,
      actorUserId: ownerId });
    assert.equal((await projectRepository.getVisibleProject({ projectId: project.id,
      actorUserId: memberId })).id, project.id);
    await assert.rejects(projectRepository.addItem({ projectId: project.id,
      actorUserId: memberId, item: { itemKind: 'subproject', title: 'Unauthorized',
        plannedStartOn: '2026-10-01', plannedEndOn: '2026-10-02', gateTopicId: null,
        responsibleUserId: memberId } }),
    /not found/);

    await assert.rejects(projectRepository.addItem({ projectId: project.id,
      actorUserId: ownerId, item: { itemKind: 'subproject', title: 'Nonmember',
        plannedStartOn: '2026-10-01', plannedEndOn: '2026-10-02', gateTopicId: null,
        responsibleUserId: reviewerId } }), /active project member/);

    const first = await projectRepository.addItem({ projectId: project.id,
      actorUserId: ownerId, item: { itemKind: 'subproject', title: 'Explore',
        summary: 'Investigate the seal configuration',
        plannedStartOn: '2026-10-01', plannedEndOn: '2026-10-05', gateTopicId: null,
        responsibleUserId: memberId } });
    const second = await projectRepository.addItem({ projectId: project.id,
      actorUserId: ownerId, item: { itemKind: 'subproject', title: 'Test seal',
        plannedStartOn: '2026-10-06', plannedEndOn: '2026-10-10', gateTopicId: null,
        responsibleUserId: ownerId } });
    assert.equal(first.code, 'SP-01');
    assert.equal(second.code, 'SP-02');
    assert.equal(first.responsibleUserId, memberId);
    const taskStatistics = createTaskStatisticsRepository(pool);
    const workItem = await pool.query(`
      INSERT INTO work_items (assignee_user_id, source_type, source_key, title,
        description, planned_start_at, due_at, status, actual_completed_at)
      VALUES ($1, 'manual_plan', $2, 'Prepare trial', 'Seal trial summary',
        '2026-10-02 09:00:00+08', '2026-10-08 18:00:00+08',
        'completed', '2026-10-07 16:30:00+08') RETURNING id
    `, [ownerId, `npd_task_stats_${suffix}`]);
    const cancelledItem = await pool.query(`
      INSERT INTO work_items (assignee_user_id, source_type, source_key, title,
        planned_start_at, status, actual_completed_at)
      VALUES ($1, 'manual_plan', $2, 'Cancelled draft',
        '2026-10-03 09:00:00+08', 'cancelled', '2026-10-03 09:30:00+08') RETURNING id
    `, [ownerId, `npd_task_cancelled_${suffix}`]);
    const ownerReport = await taskStatistics.getReport({ startDate: '2026-10-01',
      endDate: '2026-11-01', userId: ownerId, page: 1, pageSize: 50 });
    const completedRow = ownerReport.rows.find((row) => row.sourceType === 'work_item'
      && row.sourceId === Number(workItem.rows[0].id));
    assert.equal(completedRow.actualCompleted, '2026-10-07 16:30');
    assert.equal(completedRow.taskSummary, 'Seal trial summary');
    assert.equal(ownerReport.rows.find((row) => row.sourceId === Number(cancelledItem.rows[0].id)
      && row.sourceType === 'work_item').actualCompleted, null);
    assert.ok(ownerReport.rows.some((row) => row.sourceType === 'development_subproject'
      && row.sourceId === second.id && row.projectNo === project.projectNo));
    const allPeopleReport = await taskStatistics.getReport({ startDate: '2026-10-01',
      endDate: '2026-11-01', userId: null, page: 1, pageSize: 50 });
    assert.ok(allPeopleReport.rows.some((row) => row.sourceType === 'development_subproject'
      && row.sourceId === first.id && row.userId === memberId
      && row.taskSummary === 'Investigate the seal configuration'));
    const editedSummary = await projectRepository.updateItemSummary({ projectId: project.id,
      itemId: second.id, actorUserId: ownerId, expectedRowVersion: second.rowVersion,
      summary: 'Run the thermal trial' });
    assert.equal(editedSummary.summary, 'Run the thermal trial');
    const revisedReport = await taskStatistics.getReport({ startDate: '2026-10-01',
      endDate: '2026-11-01', userId: ownerId, page: 1, pageSize: 50 });
    assert.ok(revisedReport.rows.some((row) => row.sourceType === 'development_subproject'
      && row.sourceId === second.id && row.taskSummary === 'Run the thermal trial'));
    await assert.rejects(projectRepository.updateItemSummary({ projectId: project.id,
      itemId: second.id, actorUserId: reviewerId, expectedRowVersion: editedSummary.rowVersion,
      summary: 'Forbidden edit' }), /not found/);
    await assert.rejects(projectRepository.getVisiblePlan({ projectId: project.id,
      actorUserId: reviewerId }), /not found/);
    const memberReport = await taskStatistics.getReport({ startDate: '2026-10-01',
      endDate: '2026-11-01', userId: memberId, page: 1, pageSize: 50 });
    assert.ok(memberReport.rows.some((row) => row.sourceType === 'development_subproject'
      && row.sourceId === first.id));
    await assert.rejects(projectRepository.endMember({ projectId: project.id,
      userId: memberId, actorUserId: ownerId }), /Reassign subprojects/);
    await assert.rejects(pool.query(`
      UPDATE development_project_memberships
      SET ended_at = now(), ended_by_user_id = $3
      WHERE project_id = $1 AND user_id = $2 AND ended_at IS NULL
    `, [project.id, memberId, ownerId]), /Reassign subprojects/);
    await assert.rejects(pool.query(`
      UPDATE development_project_items
      SET responsible_user_id = $2, updated_by_user_id = $3,
        row_version = row_version + 1 WHERE id = $1
    `, [first.id, reviewerId, ownerId]), /active project member/);
    await assert.rejects(pool.query(`
      INSERT INTO development_project_items (
        project_id, item_kind, ordinal, title, planned_start_on, planned_end_on,
        created_by_user_id, updated_by_user_id
      ) VALUES ($1, 'subproject', 98, 'Missing owner', '2026-10-02', '2026-10-03', $2, $2)
    `, [project.id, ownerId]), /responsible user is required/);
    await assert.rejects(projectRepository.updateProjectDates({ projectId: project.id,
      actorUserId: memberId, expectedRowVersion: 1,
      plannedStartOn: '2026-09-30', plannedEndOn: '2026-11-01' }), /not found/);
    const expanded = await projectRepository.updateProjectDates({ projectId: project.id,
      actorUserId: ownerId, expectedRowVersion: 1,
      plannedStartOn: '2026-09-30', plannedEndOn: '2026-11-01' });
    assert.equal(expanded.rowVersion, 2);
    await assert.rejects(projectRepository.updateProjectDates({ projectId: project.id,
      actorUserId: ownerId, expectedRowVersion: 2,
      plannedStartOn: '2026-10-02', plannedEndOn: '2026-11-01' }),
    /must contain every plan item/);
    await assert.rejects(projectRepository.updateProjectDates({ projectId: project.id,
      actorUserId: ownerId, expectedRowVersion: 1,
      plannedStartOn: '2026-09-30', plannedEndOn: '2026-11-01' }),
    /changed; reload/);
    await assert.rejects(pool.query(`
      INSERT INTO development_project_items (
        project_id, item_kind, ordinal, title, planned_start_on, planned_end_on,
        responsible_user_id, created_by_user_id, updated_by_user_id
      ) VALUES ($1, 'subproject', 99, 'Out of range', '2026-11-02', '2026-11-03', $2, $2, $2)
    `, [project.id, ownerId]), /must fit within project dates/);
    await assert.rejects(pool.query(`
      UPDATE development_projects SET planned_start_on = '2026-10-02',
        updated_by_user_id = $2, row_version = row_version + 1
      WHERE id = $1
    `, [project.id, ownerId]), /must contain every plan item/);
    const firstLink = await projectRepository.linkTopic({ projectId: project.id,
      itemId: first.id, topicId: topic.id, actorUserId: ownerId });
    const secondLink = await projectRepository.linkTopic({ projectId: project.id,
      itemId: second.id, topicId: topic.id, actorUserId: ownerId });
    assert.equal(firstLink.isPrimary, true);
    assert.equal(secondLink.isPrimary, false);
    const gate = await projectRepository.addItem({ projectId: project.id,
      actorUserId: ownerId, item: { itemKind: 'concept_gate', title: 'Concept approval',
        plannedStartOn: '2026-10-11', plannedEndOn: '2026-10-11', gateTopicId: topic.id } });
    assert.equal(gate.code, 'G-01');
    const initial = await projectRepository.getVisiblePlan({ projectId: project.id,
      actorUserId: memberId });
    assert.equal(initial.items.find((item) => item.id === gate.id).gateApproved, false);
    assert.equal(initial.items.find((item) => item.id === gate.id).gateTopicNo, null);
    assert.equal(initial.items.find((item) => item.id === gate.id).gateTopicId, null);
    assert.equal(initial.topicLinks[0].topicNo, null);

    await projectRepository.addDependency({ projectId: project.id,
      actorUserId: ownerId, dependency: { predecessorItemId: first.id,
        successorItemId: second.id, relationCode: 'FS', lagCalendarDays: 0 } });
    await projectRepository.addDependency({ projectId: project.id,
      actorUserId: ownerId, dependency: { predecessorItemId: second.id,
        successorItemId: gate.id, relationCode: 'FS', lagCalendarDays: 0 } });
    const anotherProject = await createDevelopmentProject(projectRepository, owner, {
      title: 'Separate research plan', plannedStartOn: '2026-10-01',
      plannedEndOn: '2026-10-31'
    });
    const foreignItem = await projectRepository.addItem({ projectId: anotherProject.id,
      actorUserId: ownerId, item: { itemKind: 'subproject', title: 'Separate work',
        plannedStartOn: '2026-10-02', plannedEndOn: '2026-10-03', gateTopicId: null,
        responsibleUserId: ownerId } });
    const inlineItem = { itemKind: 'subproject', title: 'Inline seal trial',
      plannedStartOn: '2026-10-07', plannedEndOn: '2026-10-09', gateTopicId: null,
      responsibleUserId: ownerId };
    const withLinks = await projectRepository.addSubprojectWithDependencies({
      projectId: project.id, actorUserId: ownerId, item: inlineItem,
      upstream: { itemId: first.id, relationCode: 'SS', lagCalendarDays: 1 },
      downstream: { itemId: gate.id, relationCode: 'FF', lagCalendarDays: 2 }
    });
    assert.equal(withLinks.code, 'SP-03');
    assert.equal(withLinks.dependencies.length, 2);
    assert.deepEqual(withLinks.dependencies.map((value) => [value.predecessorItemId,
      value.successorItemId]), [[first.id, withLinks.id], [withLinks.id, gate.id]]);
    const itemCountBeforeFailure = await pool.query(`
      SELECT count(*)::integer AS n FROM development_project_items WHERE project_id = $1
    `, [project.id]);
    await assert.rejects(projectRepository.addSubprojectWithDependencies({
      projectId: project.id, actorUserId: ownerId, item: inlineItem,
      upstream: { itemId: foreignItem.id, relationCode: 'FS', lagCalendarDays: 0 },
      downstream: null
    }), /must belong to this project/);
    await assert.rejects(projectRepository.addSubprojectWithDependencies({
      projectId: project.id, actorUserId: ownerId, item: inlineItem,
      upstream: { itemId: first.id, relationCode: 'FS', lagCalendarDays: 0 },
      downstream: { itemId: first.id, relationCode: 'FS', lagCalendarDays: 0 }
    }), /cycle/);
    const itemCountAfterFailure = await pool.query(`
      SELECT count(*)::integer AS n FROM development_project_items WHERE project_id = $1
    `, [project.id]);
    assert.equal(itemCountAfterFailure.rows[0].n, itemCountBeforeFailure.rows[0].n);
    await assert.rejects(projectRepository.addDependency({ projectId: project.id,
      actorUserId: ownerId, dependency: { predecessorItemId: second.id,
        successorItemId: foreignItem.id, relationCode: 'FS', lagCalendarDays: 0 } }),
    /must belong to this project/);
    await assert.rejects(projectRepository.addDependency({ projectId: project.id,
      actorUserId: ownerId, dependency: { predecessorItemId: gate.id,
        successorItemId: first.id, relationCode: 'FS', lagCalendarDays: 0 } }),
    /cycle/);
    await assert.rejects(pool.query(`
      DELETE FROM development_project_dependencies WHERE project_id = $1
    `, [project.id]), /cannot be deleted/);

    const role = await pool.query(`
      INSERT INTO roles (code, name) VALUES ('technical_manager', 'Technical Manager')
      ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name RETURNING id
    `);
    await pool.query(`
      INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)
    `, [reviewerId, role.rows[0].id]);
    await topicRepository.addMember({ topicId: topic.id, userId: reviewerId,
      responsibilityCode: 'contributor', actorUserId: ownerId });
    const revision = await pool.query(`
      INSERT INTO development_concept_revisions (
        topic_id, revision_no, snapshot, snapshot_sha256, authored_by_user_id
      ) VALUES ($1, 1, '{}'::jsonb, $2, $3) RETURNING id
    `, [topic.id, 'a'.repeat(64), ownerId]);
    const submission = await pool.query(`
      INSERT INTO development_concept_submissions (revision_id, submitted_by_user_id)
      VALUES ($1, $2) RETURNING id
    `, [revision.rows[0].id, ownerId]);
    await pool.query(`
      UPDATE development_topics SET phase = 'concept_review', row_version = row_version + 1,
        updated_by_user_id = $2, updated_at = now() WHERE id = $1
    `, [topic.id, ownerId]);
    await pool.query(`
      INSERT INTO development_concept_decisions (
        submission_id, decision_code, reason, decided_by_user_id, idempotency_key
      ) VALUES ($1, 'approved', 'Evidence reviewed', $2, $3)
    `, [submission.rows[0].id, reviewerId, `npd-project-${suffix}`]);
    const approved = await projectRepository.getVisiblePlan({ projectId: project.id,
      actorUserId: memberId });
    assert.equal(approved.items.find((item) => item.id === gate.id).gateApproved, true);
    assert.equal(approved.items.find((item) => item.id === gate.id).gateTopicNo, null);

    const assigned = approved.items.find((item) => item.id === first.id);
    assert.equal(assigned.responsibleUserId, memberId);
    assert.equal(assigned.responsibleName, 'Project member');
    const reassigned = await projectRepository.updateItemResponsible({ projectId: project.id,
      itemId: first.id, actorUserId: ownerId, responsibleUserId: ownerId,
      expectedRowVersion: first.rowVersion });
    assert.equal(reassigned.rowVersion, first.rowVersion + 1);
    assert.equal(reassigned.responsibleUserId, ownerId);
    await assert.rejects(projectRepository.updateItemResponsible({ projectId: project.id,
      itemId: first.id, actorUserId: ownerId, responsibleUserId: memberId,
      expectedRowVersion: first.rowVersion }), /changed; reload/);
    await assert.rejects(projectRepository.updateItemResponsible({ projectId: project.id,
      itemId: gate.id, actorUserId: ownerId, responsibleUserId: ownerId,
      expectedRowVersion: gate.rowVersion }), /changed; reload/);
    await assert.rejects(projectRepository.updateItemResponsible({ projectId: project.id,
      itemId: first.id, actorUserId: memberId, responsibleUserId: memberId,
      expectedRowVersion: reassigned.rowVersion }), /not found/);
    await projectRepository.endMember({ projectId: project.id,
      userId: memberId, actorUserId: ownerId });
    await assert.rejects(projectRepository.getVisiblePlan({ projectId: project.id,
      actorUserId: memberId }), /not found/);

    const audit = await pool.query(`
      SELECT event_type, actor_user_id, metadata FROM development_project_events
      WHERE project_id = $1 ORDER BY id
    `, [project.id]);
    assert.ok(audit.rows.some((row) => row.event_type === 'dependency_added'));
    const assignmentEvent = audit.rows.find((row) => row.event_type === 'subproject_responsible_changed');
    assert.equal(Number(assignmentEvent.actor_user_id), ownerId);
    assert.equal(Number(assignmentEvent.metadata.previousResponsibleUserId), memberId);
    assert.equal(Number(assignmentEvent.metadata.responsibleUserId), ownerId);
    await assert.rejects(pool.query(`
      UPDATE development_project_events SET event_type = 'changed' WHERE project_id = $1
    `, [project.id]), /immutable/);
  } finally {
    await pool.end();
  }
});
