import { commercialDraftLabel } from '../domain/bidWorkspace.mjs';

function numberOrNull(value) {
  return value === null || value === undefined ? null : Number(value);
}

function jsonValue(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return fallback; }
  }
  return value;
}

function mapDraftRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    workspaceId: Number(row.workspace_id),
    opportunityId: Number(row.opportunity_id),
    templateRevisionId: Number(row.template_revision_id),
    sourceDraftId: numberOrNull(row.source_draft_id),
    draftRevisionNo: Number(row.draft_revision_no),
    draftLabel: commercialDraftLabel(row.draft_revision_no),
    formalVersionNo: numberOrNull(row.formal_version_no),
    formalVersionLabel: row.formal_version_no ? `CP-V${Number(row.formal_version_no)}` : '',
    status: row.status,
    language: row.language,
    templateCodeSnapshot: row.template_code_snapshot,
    templateNameSnapshot: row.template_name_snapshot,
    templateRevisionNoSnapshot: Number(row.template_revision_no_snapshot),
    contentSchemaSnapshot: jsonValue(row.content_schema_snapshot, { schemaVersion: 1, sections: [] }),
    variableSchemaSnapshot: jsonValue(row.variable_schema_snapshot, []),
    validationRulesSnapshot: jsonValue(row.validation_rules_snapshot, {}),
    variableValues: jsonValue(row.variable_values, {}),
    renderedContent: jsonValue(row.rendered_content, { schemaVersion: 1, sections: [], variables: [] }),
    sourceMetadata: jsonValue(row.source_metadata, {}),
    validationIssues: jsonValue(row.validation_issues, []),
    revisionReason: row.revision_reason || '',
    changeSummary: row.change_summary || '',
    createdBy: Number(row.created_by),
    createdByDisplayName: row.created_by_display_name || '',
    updatedBy: Number(row.updated_by),
    updatedByDisplayName: row.updated_by_display_name || '',
    submittedBy: numberOrNull(row.submitted_by),
    submitterDisplayName: row.submitter_display_name || '',
    submittedAt: row.submitted_at,
    reviewedBy: numberOrNull(row.reviewed_by),
    reviewerDisplayName: row.reviewer_display_name || '',
    reviewedAt: row.reviewed_at,
    reviewComment: row.review_comment || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

const draftSelect = `
  SELECT draft.*,
    creator.display_name AS created_by_display_name,
    updater.display_name AS updated_by_display_name,
    submitter.display_name AS submitter_display_name,
    reviewer.display_name AS reviewer_display_name
  FROM opportunity_commercial_drafts draft
  JOIN users creator ON creator.id = draft.created_by
  JOIN users updater ON updater.id = draft.updated_by
  LEFT JOIN users submitter ON submitter.id = draft.submitted_by
  LEFT JOIN users reviewer ON reviewer.id = draft.reviewed_by
`;

export function createOpportunityCommercialDraftRepository(queryTarget) {
  return {
    async createDraft(input) {
      const result = await queryTarget.query(`
        WITH opportunity_lock AS (
          SELECT pg_advisory_xact_lock($2::bigint)
        ), next_revision AS (
          SELECT COALESCE((
            SELECT MAX(draft_revision_no)
            FROM opportunity_commercial_drafts
            WHERE opportunity_id = $2
          ), 0) + 1 AS draft_revision_no
          FROM opportunity_lock
        ), inserted AS (
          INSERT INTO opportunity_commercial_drafts (
            workspace_id, opportunity_id, template_revision_id, draft_revision_no,
            status, language, template_code_snapshot, template_name_snapshot,
            template_revision_no_snapshot, content_schema_snapshot,
            variable_schema_snapshot, validation_rules_snapshot, variable_values,
            rendered_content, source_metadata, validation_issues,
            created_by, updated_by
          )
          SELECT $1, $2, $3, next_revision.draft_revision_no,
            'draft', $4, $5, $6, $7, $8::jsonb,
            $9::jsonb, $10::jsonb, $11::jsonb,
            $12::jsonb, $13::jsonb, $14::jsonb, $15, $15
          FROM next_revision
          RETURNING *
        )
        SELECT * FROM inserted
      `, [
        input.workspaceId,
        input.opportunityId,
        input.templateRevisionId,
        input.language,
        input.templateCodeSnapshot,
        input.templateNameSnapshot,
        input.templateRevisionNoSnapshot,
        JSON.stringify(input.contentSchemaSnapshot),
        JSON.stringify(input.variableSchemaSnapshot),
        JSON.stringify(input.validationRulesSnapshot),
        JSON.stringify(input.variableValues),
        JSON.stringify(input.renderedContent),
        JSON.stringify(input.sourceMetadata),
        JSON.stringify(input.validationIssues),
        input.actorUserId
      ]);
      return mapDraftRow(result.rows[0]);
    },

    async listByWorkspace(workspaceId) {
      const result = await queryTarget.query(`
        ${draftSelect}
        WHERE draft.workspace_id = $1
        ORDER BY draft.draft_revision_no DESC, draft.id DESC
      `, [workspaceId]);
      return result.rows.map(mapDraftRow);
    },

    async getDraftDetail(id) {
      const result = await queryTarget.query(`
        ${draftSelect}
        WHERE draft.id = $1
        LIMIT 1
      `, [id]);
      return mapDraftRow(result.rows[0]);
    }
  };
}
