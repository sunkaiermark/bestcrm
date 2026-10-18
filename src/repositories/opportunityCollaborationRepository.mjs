function mapWorkPackage(row) {
  return {
    id: Number(row.id),
    opportunityId: Number(row.opportunity_id),
    planKind: row.plan_kind,
    title: row.title,
    assigneeUserId: Number(row.assignee_user_id),
    assigneeDisplayName: row.assignee_display_name || row.assignee_username || '',
    plannedStartDate: row.planned_start_date || null,
    plannedSubmitDate: row.planned_submit_date || null,
    status: row.status,
    createdByUserId: Number(row.created_by_user_id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    latestVersion: null,
    versionHistory: []
  };
}

function mapVersion(row) {
  return {
    id: Number(row.id),
    workPackageId: Number(row.work_package_id),
    versionNo: Number(row.version_no),
    status: row.status,
    submittedByUserId: Number(row.submitted_by_user_id),
    submittedByDisplayName: row.submitted_by_display_name || row.submitted_by_username || '',
    submittedAt: row.submitted_at,
    reviewedByUserId: row.reviewed_by_user_id ? Number(row.reviewed_by_user_id) : null,
    reviewedByDisplayName: row.reviewed_by_display_name || '',
    reviewedAt: row.reviewed_at || null,
    reviewNote: row.review_note || '',
    files: []
  };
}

export function createOpportunityCollaborationRepository(queryTarget) {
  return {
    supportsWorkPackages: true,

    async listByOpportunity(opportunityId) {
      const [packagesResult, versionsResult, filesResult] = await Promise.all([
        queryTarget.query(`
          SELECT wp.*, assignee.display_name AS assignee_display_name, assignee.username AS assignee_username
          FROM opportunity_collaboration_work_packages wp
          JOIN users assignee ON assignee.id = wp.assignee_user_id
          WHERE wp.opportunity_id = $1
          ORDER BY wp.plan_kind, wp.created_at, wp.id
        `, [opportunityId]),
        queryTarget.query(`
          SELECT v.*, submitter.display_name AS submitted_by_display_name, submitter.username AS submitted_by_username,
            reviewer.display_name AS reviewed_by_display_name
          FROM opportunity_collaboration_work_package_versions v
          JOIN opportunity_collaboration_work_packages wp ON wp.id = v.work_package_id
          JOIN users submitter ON submitter.id = v.submitted_by_user_id
          LEFT JOIN users reviewer ON reviewer.id = v.reviewed_by_user_id
          WHERE wp.opportunity_id = $1
          ORDER BY v.work_package_id, v.version_no DESC, v.id DESC
        `, [opportunityId]),
        queryTarget.query(`
          SELECT f.work_package_version_id, a.id AS attachment_id, a.original_name, a.mime_type, a.uploaded_at
          FROM opportunity_collaboration_work_package_files f
          JOIN opportunity_collaboration_work_package_versions v ON v.id = f.work_package_version_id
          JOIN opportunity_collaboration_work_packages wp ON wp.id = v.work_package_id
          JOIN attachments a ON a.id = f.attachment_id
          WHERE wp.opportunity_id = $1 AND a.retired_at IS NULL
          ORDER BY f.work_package_version_id, f.sort_order, f.id
        `, [opportunityId])
      ]);
      const packages = packagesResult.rows.map(mapWorkPackage);
      const packageById = new Map(packages.map((item) => [item.id, item]));
      const versionById = new Map();
      for (const row of versionsResult.rows) {
        const version = mapVersion(row);
        versionById.set(version.id, version);
        const workPackage = packageById.get(version.workPackageId);
        if (!workPackage) continue;
        workPackage.versionHistory.push(version);
        if (!workPackage.latestVersion) workPackage.latestVersion = version;
      }
      for (const row of filesResult.rows) {
        const version = versionById.get(Number(row.work_package_version_id));
        if (!version) continue;
        version.files.push({
          id: Number(row.attachment_id),
          originalName: row.original_name,
          mimeType: row.mime_type,
          uploadedAt: row.uploaded_at
        });
      }
      return packages;
    },

    async createWorkPackage(input) {
      const result = await queryTarget.query(`
        WITH created AS (
          INSERT INTO opportunity_collaboration_work_packages (
            opportunity_id, plan_kind, title, assignee_user_id, planned_start_date, planned_submit_date, created_by_user_id
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING *
        ), logged AS (
          INSERT INTO opportunity_collaboration_work_package_events (work_package_id, event_type, actor_user_id)
          SELECT id, 'created', $7 FROM created
        )
        SELECT id FROM created
      `, [
        input.opportunityId,
        input.planKind,
        input.title,
        input.assigneeUserId,
        input.plannedStartDate || null,
        input.plannedSubmitDate || null,
        input.createdByUserId
      ]);
      return result.rows[0] ? { id: Number(result.rows[0].id) } : null;
    },

    async findWorkPackageById(id) {
      const result = await queryTarget.query(`
        SELECT * FROM opportunity_collaboration_work_packages WHERE id = $1 LIMIT 1
      `, [id]);
      return result.rows[0] ? mapWorkPackage(result.rows[0]) : null;
    },

    async submitVersion(input) {
      const result = await queryTarget.query(`
        WITH next_version AS (
          SELECT COALESCE(MAX(version_no), 0) + 1 AS version_no
          FROM opportunity_collaboration_work_package_versions
          WHERE work_package_id = $1
        ), created AS (
          INSERT INTO opportunity_collaboration_work_package_versions (work_package_id, version_no, submitted_by_user_id)
          SELECT $1, version_no, $2 FROM next_version
          RETURNING id, work_package_id
        ), files AS (
          INSERT INTO opportunity_collaboration_work_package_files (work_package_version_id, attachment_id, sort_order, added_by_user_id)
          SELECT created.id, linked.attachment_id, linked.sort_order, $2
          FROM created
          JOIN unnest($3::bigint[]) WITH ORDINALITY AS linked(attachment_id, sort_order) ON true
        ), updated AS (
          UPDATE opportunity_collaboration_work_packages SET status = 'submitted', updated_at = now()
          WHERE id = $1
        ), logged AS (
          INSERT INTO opportunity_collaboration_work_package_events (work_package_id, work_package_version_id, event_type, actor_user_id)
          SELECT work_package_id, id, 'submitted', $2 FROM created
        )
        SELECT id FROM created
      `, [input.workPackageId, input.submittedByUserId, input.attachmentIds]);
      return result.rows[0] ? { id: Number(result.rows[0].id) } : null;
    },

    async reviewVersion(input) {
      const result = await queryTarget.query(`
        WITH reviewed AS (
          UPDATE opportunity_collaboration_work_package_versions
          SET status = $3, reviewed_by_user_id = $2, reviewed_at = now(), review_note = $4
          WHERE id = $1 AND status = 'submitted'
          RETURNING id, work_package_id
        ), updated AS (
          UPDATE opportunity_collaboration_work_packages wp
          SET status = $3, updated_at = now()
          FROM reviewed
          WHERE wp.id = reviewed.work_package_id
        ), logged AS (
          INSERT INTO opportunity_collaboration_work_package_events (work_package_id, work_package_version_id, event_type, actor_user_id, note)
          SELECT work_package_id, id, $3, $2, $4 FROM reviewed
        )
        SELECT id FROM reviewed
      `, [input.versionId, input.reviewedByUserId, input.status, input.note || '']);
      return result.rows[0] ? { id: Number(result.rows[0].id) } : null;
    },

    async isAttachmentLinked(attachmentId) {
      const result = await queryTarget.query(`
        SELECT 1 FROM opportunity_collaboration_work_package_files WHERE attachment_id = $1 LIMIT 1
      `, [attachmentId]);
      return result.rowCount > 0;
    }
  };
}
