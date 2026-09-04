import { opportunityTechnicalDraftLabel } from '../domain/technicalTemplates.mjs';

export function opportunityTechnicalVersionLabel(versionNo) {
  return versionNo ? `TS-V${Number(versionNo)}` : '';
}

function numberOrNull(value) {
  return value === null || value === undefined ? null : Number(value);
}

function jsonValue(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }
  return value;
}

function mapDraftRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    opportunityId: Number(row.opportunity_id),
    templateRevisionId: Number(row.template_revision_id),
    draftRevisionNo: Number(row.draft_revision_no),
    draftLabel: opportunityTechnicalDraftLabel(row.draft_revision_no),
    sourceDraftId: numberOrNull(row.source_draft_id),
    formalVersionNo: numberOrNull(row.formal_version_no),
    formalVersionLabel: opportunityTechnicalVersionLabel(row.formal_version_no),
    status: row.status,
    language: row.language,
    templateCodeSnapshot: row.template_code_snapshot,
    templateNameSnapshot: row.template_name_snapshot,
    templateRevisionNoSnapshot: Number(row.template_revision_no_snapshot),
    contentSchemaSnapshot: jsonValue(row.content_schema_snapshot, { schemaVersion: 1, sections: [] }),
    variableSchemaSnapshot: jsonValue(row.variable_schema_snapshot, []),
    variableValues: jsonValue(row.variable_values, {}),
    selectedClauses: jsonValue(row.selected_clauses, []),
    renderedContent: jsonValue(row.rendered_content, { schemaVersion: 1, sections: [], variables: [] }),
    sourceMetadata: jsonValue(row.source_metadata, {}),
    validationIssues: jsonValue(row.validation_issues, []),
    submittedBy: numberOrNull(row.submitted_by),
    submitterDisplayName: row.submitter_display_name || '',
    submittedAt: row.submitted_at,
    reviewedBy: numberOrNull(row.reviewed_by),
    reviewerDisplayName: row.reviewer_display_name || '',
    reviewedAt: row.reviewed_at,
    reviewComment: row.review_comment,
    createdBy: Number(row.created_by),
    createdByDisplayName: row.created_by_display_name || '',
    updatedBy: Number(row.updated_by),
    updatedByDisplayName: row.updated_by_display_name || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapDocumentRow(row, includeContent = false) {
  if (!row) return null;
  const document = {
    id: Number(row.id),
    technicalDraftId: Number(row.technical_draft_id),
    documentNo: row.document_no,
    format: row.format,
    originalName: row.original_name,
    mimeType: row.mime_type,
    byteSize: Number(row.byte_size),
    sha256: row.sha256,
    generatedBy: Number(row.generated_by),
    generatorDisplayName: row.generator_display_name || '',
    generatedAt: row.generated_at
  };
  if (includeContent) document.content = row.content;
  return document;
}

function mapAssignmentRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    technicalDraftId: Number(row.technical_draft_id),
    sectionKey: row.section_key,
    assigneeUserId: Number(row.assignee_user_id),
    assigneeDisplayName: row.assignee_display_name || '',
    assigneeUsername: row.assignee_username || '',
    permission: row.permission,
    dueDate: row.due_date,
    isActive: row.is_active,
    assignedBy: Number(row.assigned_by),
    assignedByDisplayName: row.assigned_by_display_name || '',
    assignedAt: row.assigned_at,
    removedBy: numberOrNull(row.removed_by),
    removedAt: row.removed_at
  };
}

function mapEventRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    technicalDraftId: Number(row.technical_draft_id),
    eventType: row.event_type,
    sectionKey: row.section_key || '',
    actorUserId: Number(row.actor_user_id),
    actorDisplayName: row.actor_display_name || '',
    details: jsonValue(row.details, {}),
    createdAt: row.created_at
  };
}

const draftSelect = `
  SELECT
    d.*,
    creator.display_name AS created_by_display_name,
    updater.display_name AS updated_by_display_name,
    submitter.display_name AS submitter_display_name,
    reviewer.display_name AS reviewer_display_name
  FROM opportunity_technical_drafts d
  JOIN users creator ON creator.id = d.created_by
  JOIN users updater ON updater.id = d.updated_by
  LEFT JOIN users submitter ON submitter.id = d.submitted_by
  LEFT JOIN users reviewer ON reviewer.id = d.reviewed_by
`;

export function createOpportunityTechnicalDraftRepository(queryTarget) {
  return {
    supportsVersionedTechnicalApproval: true,
    async getGenerationContext(opportunityId) {
      const result = await queryTarget.query(`
        SELECT
          o.id AS opportunity_id,
          o.opportunity_no,
          o.title AS opportunity_title,
          o.requirement AS requirement_summary,
          o.product_interest AS product_name,
          c.id AS customer_id,
          c.name AS customer_name,
          COALESCE(c.address, c.country, c.region, '') AS delivery_destination,
          pc.id AS contact_id,
          pc.name AS contact_name,
          owner.display_name AS opportunity_owner
        FROM opportunities o
        JOIN customers c ON c.id = o.customer_id
        LEFT JOIN contacts pc ON pc.id = o.primary_contact_id
        JOIN users owner ON owner.id = o.salesperson_id
        WHERE o.id = $1
        LIMIT 1
      `, [opportunityId]);
      const row = result.rows[0];
      if (!row) return null;
      return {
        opportunityId: Number(row.opportunity_id),
        opportunityNo: row.opportunity_no,
        opportunityTitle: row.opportunity_title || '',
        requirementSummary: row.requirement_summary || '',
        productName: row.product_name || '',
        customerId: Number(row.customer_id),
        customerName: row.customer_name || '',
        contactId: numberOrNull(row.contact_id),
        contactName: row.contact_name || '',
        deliveryDestination: row.delivery_destination || '',
        opportunityOwner: row.opportunity_owner || '',
        capacity: '',
        medium: '',
        temperature: '',
        pressure: '',
        material: '',
        motor: '',
        voltageFrequency: '',
        hazardousAreaRating: '',
        standards: ''
      };
    },

    async createDraft(input) {
      const result = await queryTarget.query(`
        WITH opportunity_lock AS (
          SELECT pg_advisory_xact_lock($1::bigint)
        ), next_revision AS (
          SELECT COALESCE((
            SELECT MAX(draft_revision_no)
            FROM opportunity_technical_drafts
            WHERE opportunity_id = $1
          ), 0) + 1 AS draft_revision_no
          FROM opportunity_lock
        ), inserted AS (
          INSERT INTO opportunity_technical_drafts (
            opportunity_id, template_revision_id, draft_revision_no, status, language,
            template_code_snapshot, template_name_snapshot, template_revision_no_snapshot,
            content_schema_snapshot, variable_schema_snapshot, variable_values,
            selected_clauses, rendered_content, source_metadata, validation_issues,
            created_by, updated_by
          )
          SELECT $1, $2, next_revision.draft_revision_no, 'draft', $3,
            $4, $5, $6, $7::jsonb, $8::jsonb, $9::jsonb,
            $10::jsonb, $11::jsonb, $12::jsonb, $13::jsonb, $14, $14
          FROM next_revision
          RETURNING *
        ), inserted_event AS (
          INSERT INTO opportunity_technical_draft_events (
            technical_draft_id, event_type, actor_user_id, details
          )
          SELECT id, 'created', $14,
            jsonb_build_object(
              'templateRevisionId', template_revision_id,
              'templateRevisionNo', template_revision_no_snapshot,
              'draftRevisionNo', draft_revision_no
            )
          FROM inserted
        )
        SELECT * FROM inserted
      `, [
        input.opportunityId,
        input.templateRevisionId,
        input.language,
        input.templateCodeSnapshot,
        input.templateNameSnapshot,
        input.templateRevisionNoSnapshot,
        JSON.stringify(input.contentSchemaSnapshot),
        JSON.stringify(input.variableSchemaSnapshot),
        JSON.stringify(input.variableValues),
        JSON.stringify(input.selectedClauses),
        JSON.stringify(input.renderedContent),
        JSON.stringify(input.sourceMetadata),
        JSON.stringify(input.validationIssues),
        input.actorUserId
      ]);
      return mapDraftRow(result.rows[0]);
    },

    async listByOpportunity(opportunityId) {
      const result = await queryTarget.query(`
        ${draftSelect}
        WHERE d.opportunity_id = $1
        ORDER BY d.draft_revision_no DESC, d.id DESC
      `, [opportunityId]);
      return result.rows.map(mapDraftRow);
    },

    async getDraftDetail(draftId) {
      // A repository can be bound to one pg.Client during an editor transaction.
      // Keep these reads sequential because concurrent queries on one client are unsupported.
      const draftResult = await queryTarget.query(`${draftSelect} WHERE d.id = $1 LIMIT 1`, [draftId]);
      const assignmentResult = await queryTarget.query(`
          SELECT
            a.*,
            assignee.display_name AS assignee_display_name,
            assignee.username AS assignee_username,
            assigner.display_name AS assigned_by_display_name
          FROM opportunity_technical_section_assignments a
          JOIN users assignee ON assignee.id = a.assignee_user_id
          JOIN users assigner ON assigner.id = a.assigned_by
          WHERE a.technical_draft_id = $1
          ORDER BY a.is_active DESC, a.section_key ASC, a.assigned_at ASC, a.id ASC
        `, [draftId]);
      const eventResult = await queryTarget.query(`
          SELECT e.*, actor.display_name AS actor_display_name
          FROM opportunity_technical_draft_events e
          JOIN users actor ON actor.id = e.actor_user_id
          WHERE e.technical_draft_id = $1
          ORDER BY e.created_at DESC, e.id DESC
        `, [draftId]);
      const documentResult = await queryTarget.query(`
          SELECT d.*, generator.display_name AS generator_display_name
          FROM technical_solution_documents d
          JOIN users generator ON generator.id = d.generated_by
          WHERE d.technical_draft_id = $1
          ORDER BY d.format ASC, d.id ASC
        `, [draftId]);
      const draft = mapDraftRow(draftResult.rows[0]);
      if (!draft) return null;
      draft.assignments = assignmentResult.rows.map(mapAssignmentRow);
      draft.events = eventResult.rows.map(mapEventRow);
      draft.documents = documentResult.rows.map((row) => mapDocumentRow(row));
      return draft;
    },

    async findSubmissionCandidate(draftId, opportunityId) {
      const result = await queryTarget.query(`
        ${draftSelect}
        WHERE d.id = $1
          AND d.opportunity_id = $2
        LIMIT 1
      `, [draftId, opportunityId]);
      return mapDraftRow(result.rows[0]);
    },

    async updateVariables(input) {
      const result = await queryTarget.query(`
        WITH updated AS (
          UPDATE opportunity_technical_drafts
          SET variable_values = $2::jsonb,
              rendered_content = $3::jsonb,
              validation_issues = $4::jsonb,
              status = 'draft',
              updated_by = $5,
              updated_at = now()
          WHERE id = $1
            AND status IN ('draft', 'ready')
          RETURNING *
        ), inserted_event AS (
          INSERT INTO opportunity_technical_draft_events (
            technical_draft_id, event_type, actor_user_id, details
          )
          SELECT id, 'variables_updated', $5,
            jsonb_build_object(
              'variableCount', (SELECT count(*) FROM jsonb_object_keys(updated.variable_values)),
              'issueCount', jsonb_array_length(validation_issues)
            )
          FROM updated
        )
        SELECT * FROM updated
      `, [
        input.draftId,
        JSON.stringify(input.variableValues),
        JSON.stringify(input.renderedContent),
        JSON.stringify(input.validationIssues),
        input.actorUserId
      ]);
      return mapDraftRow(result.rows[0]);
    },

    async updateSection(input) {
      const result = await queryTarget.query(`
        WITH updated AS (
          UPDATE opportunity_technical_drafts
          SET rendered_content = $3::jsonb,
              status = 'draft',
              updated_by = $4,
              updated_at = now()
          WHERE id = $1
            AND status IN ('draft', 'ready')
          RETURNING *
        ), inserted_event AS (
          INSERT INTO opportunity_technical_draft_events (
            technical_draft_id, event_type, section_key, actor_user_id, details
          )
          SELECT id, 'section_updated', $2, $4,
            jsonb_build_object('standardChanged', $5::boolean)
          FROM updated
        )
        SELECT * FROM updated
      `, [
        input.draftId,
        input.sectionKey,
        JSON.stringify(input.renderedContent),
        input.actorUserId,
        input.standardChanged
      ]);
      return mapDraftRow(result.rows[0]);
    },

    async updateClauses(input) {
      const result = await queryTarget.query(`
        WITH updated AS (
          UPDATE opportunity_technical_drafts
          SET selected_clauses = $2::jsonb,
              rendered_content = $3::jsonb,
              status = 'draft',
              updated_by = $4,
              updated_at = now()
          WHERE id = $1
            AND status IN ('draft', 'ready')
          RETURNING *
        ), inserted_event AS (
          INSERT INTO opportunity_technical_draft_events (
            technical_draft_id, event_type, actor_user_id, details
          )
          SELECT id, 'clauses_updated', $4,
            jsonb_build_object('clauseCount', jsonb_array_length(selected_clauses))
          FROM updated
        )
        SELECT * FROM updated
      `, [input.draftId, JSON.stringify(input.selectedClauses), JSON.stringify(input.renderedContent), input.actorUserId]);
      return mapDraftRow(result.rows[0]);
    },

    async addAssignment(input) {
      const result = await queryTarget.query(`
        WITH saved AS (
          INSERT INTO opportunity_technical_section_assignments (
            technical_draft_id, section_key, assignee_user_id, permission,
            due_date, assigned_by
          )
          SELECT $1, $2, $3, 'edit', $4, $5
          FROM opportunity_technical_drafts
          WHERE id = $1
            AND status IN ('draft', 'ready')
          ON CONFLICT (technical_draft_id, section_key, assignee_user_id)
            WHERE is_active = true
          DO UPDATE SET due_date = EXCLUDED.due_date,
                        assigned_by = EXCLUDED.assigned_by,
                        assigned_at = now()
          RETURNING *
        ), inserted_event AS (
          INSERT INTO opportunity_technical_draft_events (
            technical_draft_id, event_type, section_key, actor_user_id, details
          )
          SELECT technical_draft_id, 'assignment_added', section_key, $5,
            jsonb_build_object('assignmentId', id, 'assigneeUserId', assignee_user_id, 'dueDate', due_date)
          FROM saved
        )
        SELECT * FROM saved
      `, [input.draftId, input.sectionKey, input.assigneeUserId, input.dueDate, input.actorUserId]);
      return mapAssignmentRow(result.rows[0]);
    },

    async removeAssignment(input) {
      const result = await queryTarget.query(`
        WITH removed AS (
          UPDATE opportunity_technical_section_assignments
          SET is_active = false,
              removed_by = $3,
              removed_at = now()
          WHERE id = $2
            AND technical_draft_id = $1
            AND is_active = true
            AND EXISTS (
              SELECT 1 FROM opportunity_technical_drafts
              WHERE id = $1 AND status IN ('draft', 'ready')
            )
          RETURNING *
        ), inserted_event AS (
          INSERT INTO opportunity_technical_draft_events (
            technical_draft_id, event_type, section_key, actor_user_id, details
          )
          SELECT technical_draft_id, 'assignment_removed', section_key, $3,
            jsonb_build_object('assignmentId', id, 'assigneeUserId', assignee_user_id)
          FROM removed
        )
        SELECT * FROM removed
      `, [input.draftId, input.assignmentId, input.actorUserId]);
      return mapAssignmentRow(result.rows[0]);
    },

    async markReady(input) {
      const result = await queryTarget.query(`
        WITH updated AS (
          UPDATE opportunity_technical_drafts
          SET status = 'ready',
              validation_issues = $2::jsonb,
              updated_by = $3,
              updated_at = now()
          WHERE id = $1
            AND status IN ('draft', 'ready')
          RETURNING *
        ), inserted_event AS (
          INSERT INTO opportunity_technical_draft_events (
            technical_draft_id, event_type, actor_user_id, details
          )
          SELECT id, 'readiness_checked', $3,
            jsonb_build_object('ready', true, 'issueCount', jsonb_array_length(validation_issues))
          FROM updated
        )
        SELECT * FROM updated
      `, [input.draftId, JSON.stringify(input.validationIssues), input.actorUserId]);
      return mapDraftRow(result.rows[0]);
    },

    async submitForApproval(input) {
      const result = await queryTarget.query(`
        WITH updated AS (
          UPDATE opportunity_technical_drafts
          SET status = 'pending',
              submitted_by = $2,
              submitted_at = now(),
              reviewed_by = NULL,
              reviewed_at = NULL,
              review_comment = NULL,
              updated_by = $2,
              updated_at = now()
          WHERE id = $1
            AND status = 'ready'
            AND jsonb_array_length(validation_issues) = 0
          RETURNING *
        ), inserted_event AS (
          INSERT INTO opportunity_technical_draft_events (
            technical_draft_id, event_type, actor_user_id, details
          )
          SELECT id, 'submitted', $2,
            jsonb_build_object('draftRevisionNo', draft_revision_no)
          FROM updated
        )
        SELECT * FROM updated
      `, [input.draftId, input.actorUserId]);
      return mapDraftRow(result.rows[0]);
    },

    async withdrawLatestPending(input) {
      const result = await queryTarget.query(`
        WITH updated AS (
          UPDATE opportunity_technical_drafts
          SET status = 'ready',
              reviewed_by = NULL,
              reviewed_at = NULL,
              review_comment = NULL,
              updated_by = $2,
              updated_at = now()
          WHERE id = (
            SELECT id FROM opportunity_technical_drafts
            WHERE opportunity_id = $1 AND status = 'pending'
            ORDER BY submitted_at DESC, id DESC
            LIMIT 1
          )
          RETURNING *
        ), inserted_event AS (
          INSERT INTO opportunity_technical_draft_events (
            technical_draft_id, event_type, actor_user_id, details
          )
          SELECT id, 'withdrawn', $2, '{}'::jsonb FROM updated
        )
        SELECT * FROM updated
      `, [input.opportunityId, input.actorUserId]);
      return mapDraftRow(result.rows[0]);
    },

    async approveLatestPending(input) {
      const result = await queryTarget.query(`
        WITH opportunity_lock AS (
          SELECT pg_advisory_xact_lock($1::bigint)
        ), next_version AS (
          SELECT COALESCE(MAX(formal_version_no), 0) + 1 AS formal_version_no
          FROM opportunity_technical_drafts, opportunity_lock
          WHERE opportunity_id = $1
        ), updated AS (
          UPDATE opportunity_technical_drafts d
          SET status = 'approved',
              formal_version_no = next_version.formal_version_no,
              reviewed_by = $2,
              reviewed_at = now(),
              review_comment = $3,
              updated_by = $2,
              updated_at = now()
          FROM next_version
          WHERE d.id = (
            SELECT id FROM opportunity_technical_drafts
            WHERE opportunity_id = $1 AND status = 'pending'
            ORDER BY submitted_at DESC, id DESC
            LIMIT 1
          )
          RETURNING d.*
        ), inserted_event AS (
          INSERT INTO opportunity_technical_draft_events (
            technical_draft_id, event_type, actor_user_id, details
          )
          SELECT id, 'approved', $2,
            jsonb_build_object('formalVersionNo', formal_version_no, 'comment', $3::text)
          FROM updated
        )
        SELECT * FROM updated
      `, [input.opportunityId, input.actorUserId, input.reviewComment || null]);
      return mapDraftRow(result.rows[0]);
    },

    async rejectLatestPending(input) {
      const result = await queryTarget.query(`
        WITH updated AS (
          UPDATE opportunity_technical_drafts
          SET status = 'rejected',
              reviewed_by = $2,
              reviewed_at = now(),
              review_comment = $3,
              updated_by = $2,
              updated_at = now()
          WHERE id = (
            SELECT id FROM opportunity_technical_drafts
            WHERE opportunity_id = $1 AND status = 'pending'
            ORDER BY submitted_at DESC, id DESC
            LIMIT 1
          )
          RETURNING *
        ), inserted_event AS (
          INSERT INTO opportunity_technical_draft_events (
            technical_draft_id, event_type, actor_user_id, details
          )
          SELECT id, 'rejected', $2,
            jsonb_build_object('comment', $3::text)
          FROM updated
        )
        SELECT * FROM updated
      `, [input.opportunityId, input.actorUserId, input.reviewComment || null]);
      return mapDraftRow(result.rows[0]);
    },

    async cloneRejectedDraft(input) {
      const result = await queryTarget.query(`
        WITH opportunity_lock AS (
          SELECT pg_advisory_xact_lock(source.opportunity_id)
          FROM opportunity_technical_drafts source
          WHERE source.id = $1 AND source.status = 'rejected'
        ), next_revision AS (
          SELECT source.*,
                 COALESCE((
                   SELECT MAX(candidate.draft_revision_no)
                   FROM opportunity_technical_drafts candidate
                   WHERE candidate.opportunity_id = source.opportunity_id
                 ), 0) + 1 AS next_draft_revision_no
          FROM opportunity_technical_drafts source, opportunity_lock
          WHERE source.id = $1 AND source.status = 'rejected'
        ), inserted AS (
          INSERT INTO opportunity_technical_drafts (
            opportunity_id, template_revision_id, draft_revision_no, source_draft_id,
            status, language, template_code_snapshot, template_name_snapshot,
            template_revision_no_snapshot, content_schema_snapshot,
            variable_schema_snapshot, variable_values, selected_clauses,
            rendered_content, source_metadata, validation_issues, created_by, updated_by
          )
          SELECT opportunity_id, template_revision_id, next_draft_revision_no, id,
            'draft', language, template_code_snapshot, template_name_snapshot,
            template_revision_no_snapshot, content_schema_snapshot,
            variable_schema_snapshot, variable_values, selected_clauses,
            rendered_content, source_metadata, validation_issues, $2, $2
          FROM next_revision
          RETURNING *
        ), copied_assignments AS (
          INSERT INTO opportunity_technical_section_assignments (
            technical_draft_id, section_key, assignee_user_id, permission,
            due_date, assigned_by
          )
          SELECT inserted.id, a.section_key, a.assignee_user_id, a.permission,
            a.due_date, $2
          FROM inserted
          JOIN opportunity_technical_section_assignments a ON a.technical_draft_id = $1
          WHERE a.is_active = true
        ), source_event AS (
          INSERT INTO opportunity_technical_draft_events (
            technical_draft_id, event_type, actor_user_id, details
          )
          SELECT $1, 'revision_created', $2,
            jsonb_build_object('newDraftId', id, 'newDraftRevisionNo', draft_revision_no)
          FROM inserted
        ), new_event AS (
          INSERT INTO opportunity_technical_draft_events (
            technical_draft_id, event_type, actor_user_id, details
          )
          SELECT id, 'created', $2,
            jsonb_build_object('sourceDraftId', $1, 'draftRevisionNo', draft_revision_no)
          FROM inserted
        )
        SELECT * FROM inserted
      `, [input.sourceDraftId, input.actorUserId]);
      return mapDraftRow(result.rows[0]);
    },

    async saveApprovedDocuments(input) {
      const saved = [];
      for (const document of input.documents) {
        const result = await queryTarget.query(`
          INSERT INTO technical_solution_documents (
            technical_draft_id, document_no, format, original_name,
            mime_type, content, byte_size, sha256, generated_by
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          ON CONFLICT (technical_draft_id, format) DO NOTHING
          RETURNING *
        `, [
          input.draftId,
          document.documentNo,
          document.format,
          document.originalName,
          document.mimeType,
          document.content,
          document.byteSize,
          document.sha256,
          input.actorUserId
        ]);
        if (result.rows[0]) saved.push(mapDocumentRow(result.rows[0]));
      }
      if (saved.length) {
        await queryTarget.query(`
          INSERT INTO opportunity_technical_draft_events (
            technical_draft_id, event_type, actor_user_id, details
          )
          VALUES ($1, 'documents_generated', $2, $3::jsonb)
        `, [
          input.draftId,
          input.actorUserId,
          JSON.stringify({ formats: saved.map((item) => item.format), sha256: Object.fromEntries(saved.map((item) => [item.format, item.sha256])) })
        ]);
      }
      return saved;
    },

    async findDocument(draftId, documentId) {
      const result = await queryTarget.query(`
        SELECT d.*, generator.display_name AS generator_display_name
        FROM technical_solution_documents d
        JOIN users generator ON generator.id = d.generated_by
        WHERE d.id = $2 AND d.technical_draft_id = $1
        LIMIT 1
      `, [draftId, documentId]);
      return mapDocumentRow(result.rows[0], true);
    }
  };
}
