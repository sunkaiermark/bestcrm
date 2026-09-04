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

function sourceValues(input) {
  if (input.packageType === 'technical') return [input.technicalDraftId, null, null];
  if (input.packageType === 'commercial') return [null, input.commercialDraftId, null];
  return [null, null, input.quotationPackageId];
}

function mapCheck(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    workspaceId: Number(row.workspace_id),
    packageType: row.package_type,
    technicalDraftId: numberOrNull(row.technical_draft_id),
    commercialDraftId: numberOrNull(row.commercial_draft_id),
    quotationPackageId: numberOrNull(row.quotation_package_id),
    passed: Boolean(row.passed),
    issues: jsonValue(row.issues, []),
    snapshotSha256: row.snapshot_sha256,
    checkedBy: Number(row.checked_by),
    checkedByDisplayName: row.checked_by_display_name || '',
    checkedAt: row.checked_at
  };
}

export function createBidPackageApprovalRepository(queryTarget) {
  return {
    async createCompletenessCheck(input) {
      const [technicalDraftId, commercialDraftId, quotationPackageId] = sourceValues(input);
      const result = await queryTarget.query(`
        INSERT INTO bid_package_completeness_checks (
          workspace_id, package_type, technical_draft_id, commercial_draft_id,
          quotation_package_id, passed, issues, snapshot_sha256, checked_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9)
        RETURNING *
      `, [
        input.workspaceId, input.packageType, technicalDraftId, commercialDraftId,
        quotationPackageId, input.passed, JSON.stringify(input.issues || []),
        input.snapshotSha256, input.actorUserId
      ]);
      return mapCheck(result.rows[0]);
    },

    async listCompletenessChecks(input) {
      const [technicalDraftId, commercialDraftId, quotationPackageId] = sourceValues(input);
      const result = await queryTarget.query(`
        SELECT check_record.*, checker.display_name AS checked_by_display_name
        FROM bid_package_completeness_checks check_record
        JOIN users checker ON checker.id = check_record.checked_by
        WHERE check_record.workspace_id = $1
          AND check_record.package_type = $2
          AND (($2 = 'technical' AND check_record.technical_draft_id = $3)
            OR ($2 = 'commercial' AND check_record.commercial_draft_id = $4)
            OR ($2 = 'complete' AND check_record.quotation_package_id = $5))
        ORDER BY check_record.checked_at DESC, check_record.id DESC
      `, [input.workspaceId, input.packageType, technicalDraftId, commercialDraftId, quotationPackageId]);
      return result.rows.map(mapCheck);
    },

    async setWorkspaceStatus({ workspaceId, status, actorUserId }) {
      const result = await queryTarget.query(`
        UPDATE opportunity_bid_workspaces
        SET status = $2, updated_by = $3, updated_at = now()
        WHERE id = $1
        RETURNING id, status
      `, [workspaceId, status, actorUserId]);
      return result.rows[0] ? { id: Number(result.rows[0].id), status: result.rows[0].status } : null;
    },

    async copyDraftArtifacts({ workspaceId, packageType, sourceDraftId, targetDraftId }) {
      const technical = packageType === 'technical';
      await queryTarget.query(`
        INSERT INTO bid_section_changes (
          workspace_id, package_type, technical_draft_id, commercial_draft_id,
          section_key, modification_status, change_type, before_summary,
          after_summary, reason, actor_user_id
        )
        SELECT workspace_id, package_type,
          CASE WHEN $2 = 'technical' THEN $4::bigint ELSE NULL END,
          CASE WHEN $2 = 'commercial' THEN $4::bigint ELSE NULL END,
          section_key, modification_status, change_type, before_summary,
          after_summary, reason, actor_user_id
        FROM bid_section_changes
        WHERE workspace_id = $1 AND package_type = $2
          AND (($2 = 'technical' AND technical_draft_id = $3)
            OR ($2 = 'commercial' AND commercial_draft_id = $3))
      `, [workspaceId, packageType, sourceDraftId, targetDraftId]);
      await queryTarget.query(`
        INSERT INTO bid_package_attachments (
          workspace_id, package_type, technical_draft_id, commercial_draft_id,
          section_key, original_name, stored_path, mime_type, byte_size, sha256, uploaded_by
        )
        SELECT workspace_id, package_type,
          CASE WHEN $2 = 'technical' THEN $4::bigint ELSE NULL END,
          CASE WHEN $2 = 'commercial' THEN $4::bigint ELSE NULL END,
          section_key, original_name, stored_path, mime_type, byte_size, sha256, uploaded_by
        FROM bid_package_attachments
        WHERE workspace_id = $1 AND package_type = $2 AND removed_at IS NULL
          AND (($2 = 'technical' AND technical_draft_id = $3)
            OR ($2 = 'commercial' AND commercial_draft_id = $3))
      `, [workspaceId, packageType, sourceDraftId, targetDraftId]);
      return { packageType, technical, sourceDraftId, targetDraftId };
    },

    async submitCommercial({ workspaceId, commercialDraftId, actorUserId }) {
      const result = await queryTarget.query(`
        UPDATE opportunity_commercial_drafts
        SET status = 'review_pending', submitted_by = $3, submitted_at = now(),
            reviewed_by = NULL, reviewed_at = NULL, review_comment = NULL,
            updated_by = $3, updated_at = now()
        WHERE id = $2 AND workspace_id = $1 AND status = 'draft'
          AND jsonb_array_length(validation_issues) = 0
        RETURNING id
      `, [workspaceId, commercialDraftId, actorUserId]);
      return result.rows[0] ? Number(result.rows[0].id) : null;
    },

    async approveCommercial({ workspaceId, commercialDraftId, actorUserId, reviewComment }) {
      const result = await queryTarget.query(`
        WITH target AS (
          SELECT id, opportunity_id
          FROM opportunity_commercial_drafts
          WHERE id = $2 AND workspace_id = $1 AND status = 'review_pending'
            AND submitted_by <> $3
        ), opportunity_lock AS (
          SELECT pg_advisory_xact_lock(opportunity_id) FROM target
        ), next_version AS (
          SELECT COALESCE(MAX(draft.formal_version_no), 0) + 1 AS formal_version_no
          FROM opportunity_commercial_drafts draft, target, opportunity_lock
          WHERE draft.opportunity_id = target.opportunity_id
        )
        UPDATE opportunity_commercial_drafts draft
        SET status = 'approved', formal_version_no = next_version.formal_version_no,
            reviewed_by = $3, reviewed_at = now(), review_comment = $4,
            updated_by = $3, updated_at = now()
        FROM next_version
        WHERE draft.id = $2 AND draft.status = 'review_pending'
        RETURNING draft.id, draft.formal_version_no
      `, [workspaceId, commercialDraftId, actorUserId, reviewComment || null]);
      return result.rows[0] ? {
        id: Number(result.rows[0].id),
        formalVersionNo: Number(result.rows[0].formal_version_no)
      } : null;
    },

    async rejectCommercial({ workspaceId, commercialDraftId, actorUserId, reviewComment }) {
      const result = await queryTarget.query(`
        UPDATE opportunity_commercial_drafts
        SET status = 'rejected', reviewed_by = $3, reviewed_at = now(),
            review_comment = $4, updated_by = $3, updated_at = now()
        WHERE id = $2 AND workspace_id = $1 AND status = 'review_pending'
          AND submitted_by <> $3
        RETURNING id
      `, [workspaceId, commercialDraftId, actorUserId, reviewComment]);
      return result.rows[0] ? Number(result.rows[0].id) : null;
    },

    async cloneRejectedCommercial({ workspaceId, commercialDraftId, actorUserId, reviewComment }) {
      const result = await queryTarget.query(`
        WITH source AS (
          SELECT * FROM opportunity_commercial_drafts
          WHERE id = $2 AND workspace_id = $1 AND status = 'rejected'
        ), opportunity_lock AS (
          SELECT pg_advisory_xact_lock(opportunity_id) FROM source
        ), next_revision AS (
          SELECT COALESCE(MAX(draft.draft_revision_no), 0) + 1 AS draft_revision_no
          FROM opportunity_commercial_drafts draft, source, opportunity_lock
          WHERE draft.opportunity_id = source.opportunity_id
        ), inserted AS (
          INSERT INTO opportunity_commercial_drafts (
            workspace_id, opportunity_id, template_revision_id, source_draft_id,
            draft_revision_no, status, language, template_code_snapshot,
            template_name_snapshot, template_revision_no_snapshot,
            content_schema_snapshot, variable_schema_snapshot, validation_rules_snapshot,
            variable_values, rendered_content, source_metadata, validation_issues,
            revision_reason, change_summary, created_by, updated_by
          )
          SELECT source.workspace_id, source.opportunity_id, source.template_revision_id, source.id,
            next_revision.draft_revision_no, 'draft', source.language,
            source.template_code_snapshot, source.template_name_snapshot,
            source.template_revision_no_snapshot, source.content_schema_snapshot,
            source.variable_schema_snapshot, source.validation_rules_snapshot,
            source.variable_values, source.rendered_content, source.source_metadata,
            source.validation_issues, $4,
            'Review return from CP-D' || source.draft_revision_no::text,
            $3, $3
          FROM source, next_revision
          RETURNING id, draft_revision_no
        )
        SELECT * FROM inserted
      `, [workspaceId, commercialDraftId, actorUserId, reviewComment]);
      return result.rows[0] ? {
        id: Number(result.rows[0].id),
        draftRevisionNo: Number(result.rows[0].draft_revision_no)
      } : null;
    },

    async createCompleteDraft(input) {
      const result = await queryTarget.query(`
        WITH opportunity_lock AS (
          SELECT pg_advisory_xact_lock($2::bigint)
        ), next_revision AS (
          SELECT COALESCE(MAX(package.draft_revision_no), 0) + 1 AS draft_revision_no
          FROM quotation_package_versions package, opportunity_lock
          WHERE package.opportunity_id = $2
        ), inserted AS (
          INSERT INTO quotation_package_versions (
            opportunity_id, source_package_id, review_source_package_id,
            draft_revision_no, status, technical_solution_version_id,
            commercial_quote_id, workspace_id, commercial_draft_id,
            currency, total_price, delivery_period, payment_terms, valid_until,
            commercial_line_items, inclusions, exclusions, technical_assumptions,
            revision_reason, change_summary, created_by, updated_by
          )
          SELECT $2, $6, NULL, next_revision.draft_revision_no, 'draft', $3,
            $4, $1, $5, $7, $8, $9, $10, $11, $12::jsonb,
            $13, $14, $15, $16, $17, $18, $18
          FROM next_revision
          RETURNING *
        ), package_event AS (
          INSERT INTO quotation_package_events (
            quotation_package_id, event_type, actor_user_id, details
          )
          SELECT id, CASE WHEN source_package_id IS NULL THEN 'created' ELSE 'revision_created' END,
            $18, jsonb_build_object('workspaceId', $1, 'draftRevisionNo', draft_revision_no)
          FROM inserted
        )
        SELECT id, draft_revision_no FROM inserted
      `, [
        input.workspaceId, input.opportunityId, input.technicalDraftId,
        input.commercialQuoteId, input.commercialDraftId, input.sourcePackageId || null,
        input.currency, input.totalPrice, input.deliveryPeriod, input.paymentTerms,
        input.validUntil, JSON.stringify(input.commercialLineItems || []),
        input.inclusions || '', input.exclusions || '', input.technicalAssumptions || '',
        input.revisionReason || null, input.changeSummary || null, input.actorUserId
      ]);
      return result.rows[0] ? {
        id: Number(result.rows[0].id),
        draftRevisionNo: Number(result.rows[0].draft_revision_no)
      } : null;
    },

    async submitComplete({ workspaceId, quotationPackageId, actorUserId, comment }) {
      const result = await queryTarget.query(`
        WITH updated AS (
          UPDATE quotation_package_versions
          SET status = 'pending', submitted_by = $3, submitted_at = now(),
              updated_by = $3, updated_at = now()
          WHERE id = $2 AND workspace_id = $1 AND status = 'draft'
          RETURNING *
        ), package_event AS (
          INSERT INTO quotation_package_events (
            quotation_package_id, event_type, actor_user_id, comment
          )
          SELECT id, 'submitted', $3, $4 FROM updated
        )
        SELECT id FROM updated
      `, [workspaceId, quotationPackageId, actorUserId, comment || null]);
      return result.rows[0] ? Number(result.rows[0].id) : null;
    },

    async cloneRejectedComplete({ workspaceId, quotationPackageId, actorUserId, reviewComment }) {
      const result = await queryTarget.query(`
        WITH source AS (
          SELECT * FROM quotation_package_versions
          WHERE id = $2 AND workspace_id = $1 AND status = 'rejected'
        ), opportunity_lock AS (
          SELECT pg_advisory_xact_lock(opportunity_id) FROM source
        ), next_revision AS (
          SELECT COALESCE(MAX(package.draft_revision_no), 0) + 1 AS draft_revision_no
          FROM quotation_package_versions package, source, opportunity_lock
          WHERE package.opportunity_id = source.opportunity_id
        ), inserted AS (
          INSERT INTO quotation_package_versions (
            opportunity_id, source_package_id, review_source_package_id,
            draft_revision_no, status, technical_solution_version_id,
            commercial_quote_id, workspace_id, commercial_draft_id,
            currency, total_price, delivery_period, payment_terms, valid_until,
            commercial_line_items, inclusions, exclusions, technical_assumptions,
            revision_reason, change_summary, created_by, updated_by
          )
          SELECT source.opportunity_id, source.source_package_id, source.id,
            next_revision.draft_revision_no, 'draft', source.technical_solution_version_id,
            source.commercial_quote_id, source.workspace_id, source.commercial_draft_id,
            source.currency, source.total_price, source.delivery_period,
            source.payment_terms, source.valid_until, source.commercial_line_items,
            source.inclusions, source.exclusions, source.technical_assumptions,
            source.revision_reason, source.change_summary, $3, $3
          FROM source, next_revision
          RETURNING id, draft_revision_no
        ), package_event AS (
          INSERT INTO quotation_package_events (
            quotation_package_id, event_type, actor_user_id, comment, details
          )
          SELECT id, 'revision_created', $3, $4,
            jsonb_build_object('reviewSourcePackageId', $2, 'draftRevisionNo', draft_revision_no)
          FROM inserted
        )
        SELECT id, draft_revision_no FROM inserted
      `, [workspaceId, quotationPackageId, actorUserId, reviewComment]);
      return result.rows[0] ? {
        id: Number(result.rows[0].id),
        draftRevisionNo: Number(result.rows[0].draft_revision_no)
      } : null;
    }
  };
}
