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

function mapChange(row) {
  return {
    id: Number(row.id),
    workspaceId: Number(row.workspace_id),
    packageType: row.package_type,
    technicalDraftId: numberOrNull(row.technical_draft_id),
    commercialDraftId: numberOrNull(row.commercial_draft_id),
    sectionKey: row.section_key,
    modificationStatus: row.modification_status,
    changeType: row.change_type,
    beforeSummary: row.before_summary || '',
    afterSummary: row.after_summary || '',
    reason: row.reason,
    actorUserId: Number(row.actor_user_id),
    actorDisplayName: row.actor_display_name || '',
    createdAt: row.created_at
  };
}

function mapEvent(row) {
  return {
    id: Number(row.id),
    workspaceId: Number(row.workspace_id),
    packageType: row.package_type,
    sectionKey: row.section_key || '',
    eventType: row.event_type,
    actorUserId: Number(row.actor_user_id),
    actorDisplayName: row.actor_display_name || '',
    details: jsonValue(row.details, {}),
    createdAt: row.created_at
  };
}

function mapAttachment(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    workspaceId: Number(row.workspace_id),
    packageType: row.package_type,
    technicalDraftId: numberOrNull(row.technical_draft_id),
    commercialDraftId: numberOrNull(row.commercial_draft_id),
    sectionKey: row.section_key,
    originalName: row.original_name,
    storedPath: row.stored_path,
    mimeType: row.mime_type,
    byteSize: Number(row.byte_size),
    sha256: row.sha256,
    uploadedBy: Number(row.uploaded_by),
    uploadedByDisplayName: row.uploaded_by_display_name || '',
    uploadedAt: row.uploaded_at,
    removedBy: numberOrNull(row.removed_by),
    removedAt: row.removed_at
  };
}

function mapSuggestion(row) {
  return {
    id: Number(row.id),
    workspaceId: Number(row.workspace_id),
    packageType: row.package_type,
    sectionKey: row.section_key,
    targetKind: row.target_kind,
    title: row.title,
    reason: row.reason,
    contentSnapshot: jsonValue(row.content_snapshot, {}),
    status: row.status,
    createdBy: Number(row.created_by),
    createdByDisplayName: row.created_by_display_name || '',
    createdAt: row.created_at
  };
}

function sourceValues(input) {
  return input.packageType === 'technical'
    ? [input.technicalDraftId, null]
    : [null, input.commercialDraftId];
}

export function createBidPackageEditorRepository(queryTarget) {
  async function insertChange(input) {
    const [technicalDraftId, commercialDraftId] = sourceValues(input);
    const result = await queryTarget.query(`
      INSERT INTO bid_section_changes (
        workspace_id, package_type, technical_draft_id, commercial_draft_id,
        section_key, modification_status, change_type, before_summary,
        after_summary, reason, actor_user_id
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *
    `, [
      input.workspaceId,
      input.packageType,
      technicalDraftId,
      commercialDraftId,
      input.sectionKey,
      input.modificationStatus,
      input.changeType,
      input.beforeSummary || '',
      input.afterSummary || '',
      input.reason,
      input.actorUserId
    ]);
    return mapChange(result.rows[0]);
  }

  async function insertEvent(input) {
    const [technicalDraftId, commercialDraftId] = sourceValues(input);
    const result = await queryTarget.query(`
      INSERT INTO bid_package_events (
        workspace_id, package_type, technical_draft_id, commercial_draft_id,
        event_type, section_key, actor_user_id, details
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
      RETURNING *
    `, [
      input.workspaceId,
      input.packageType,
      technicalDraftId,
      commercialDraftId,
      input.eventType,
      input.sectionKey || null,
      input.actorUserId,
      JSON.stringify(input.details || {})
    ]);
    return mapEvent(result.rows[0]);
  }

  async function touchWorkspace(workspaceId, actorUserId) {
    await queryTarget.query(`
      UPDATE opportunity_bid_workspaces
      SET updated_by = $2, updated_at = now()
      WHERE id = $1
    `, [workspaceId, actorUserId]);
  }

  return {
    async listChanges(input) {
      const result = await queryTarget.query(`
        SELECT change.*, actor.display_name AS actor_display_name
        FROM bid_section_changes change
        JOIN users actor ON actor.id = change.actor_user_id
        WHERE change.workspace_id = $1
          AND change.package_type = $2
          AND (($2 = 'technical' AND change.technical_draft_id = $3)
            OR ($2 = 'commercial' AND change.commercial_draft_id = $4))
        ORDER BY change.created_at DESC, change.id DESC
      `, [input.workspaceId, input.packageType, input.technicalDraftId || null, input.commercialDraftId || null]);
      return result.rows.map(mapChange);
    },

    async listEvents(input) {
      const result = await queryTarget.query(`
        SELECT event.*, actor.display_name AS actor_display_name
        FROM bid_package_events event
        JOIN users actor ON actor.id = event.actor_user_id
        WHERE event.workspace_id = $1
          AND event.package_type = $2
          AND (($2 = 'technical' AND event.technical_draft_id = $3)
            OR ($2 = 'commercial' AND event.commercial_draft_id = $4))
        ORDER BY event.created_at DESC, event.id DESC
      `, [input.workspaceId, input.packageType, input.technicalDraftId || null, input.commercialDraftId || null]);
      return result.rows.map(mapEvent);
    },

    async listAttachments(input) {
      const result = await queryTarget.query(`
        SELECT attachment.*, uploader.display_name AS uploaded_by_display_name
        FROM bid_package_attachments attachment
        JOIN users uploader ON uploader.id = attachment.uploaded_by
        WHERE attachment.workspace_id = $1
          AND attachment.package_type = $2
          AND (($2 = 'technical' AND attachment.technical_draft_id = $3)
            OR ($2 = 'commercial' AND attachment.commercial_draft_id = $4))
        ORDER BY attachment.removed_at NULLS FIRST, attachment.uploaded_at DESC, attachment.id DESC
      `, [input.workspaceId, input.packageType, input.technicalDraftId || null, input.commercialDraftId || null]);
      return result.rows.map(mapAttachment);
    },

    async findAttachment(id) {
      const result = await queryTarget.query(`
        SELECT attachment.*, uploader.display_name AS uploaded_by_display_name
        FROM bid_package_attachments attachment
        JOIN users uploader ON uploader.id = attachment.uploaded_by
        WHERE attachment.id = $1
        LIMIT 1
      `, [id]);
      return mapAttachment(result.rows[0]);
    },

    async listSuggestions(input) {
      const result = await queryTarget.query(`
        SELECT suggestion.*, creator.display_name AS created_by_display_name
        FROM bid_library_suggestions suggestion
        JOIN users creator ON creator.id = suggestion.created_by
        WHERE suggestion.workspace_id = $1
          AND suggestion.package_type = $2
          AND (($2 = 'technical' AND suggestion.technical_draft_id = $3)
            OR ($2 = 'commercial' AND suggestion.commercial_draft_id = $4))
        ORDER BY suggestion.created_at DESC, suggestion.id DESC
      `, [input.workspaceId, input.packageType, input.technicalDraftId || null, input.commercialDraftId || null]);
      return result.rows.map(mapSuggestion);
    },

    async updateTechnicalDraft(input) {
      const result = await queryTarget.query(`
        UPDATE opportunity_technical_drafts
        SET variable_values = $2::jsonb,
            selected_clauses = $3::jsonb,
            rendered_content = $4::jsonb,
            validation_issues = $5::jsonb,
            status = 'draft', updated_by = $6, updated_at = now()
        WHERE id = $1 AND status IN ('draft', 'ready')
        RETURNING id
      `, [
        input.technicalDraftId,
        JSON.stringify(input.variableValues || {}),
        JSON.stringify(input.selectedClauses || []),
        JSON.stringify(input.renderedContent || {}),
        JSON.stringify(input.validationIssues || []),
        input.actorUserId
      ]);
      return Boolean(result.rows[0]);
    },

    async updateCommercialDraft(input) {
      const result = await queryTarget.query(`
        UPDATE opportunity_commercial_drafts
        SET variable_values = $2::jsonb,
            rendered_content = $3::jsonb,
            validation_issues = $4::jsonb,
            updated_by = $5, updated_at = now()
        WHERE id = $1 AND status = 'draft'
        RETURNING id
      `, [
        input.commercialDraftId,
        JSON.stringify(input.variableValues || {}),
        JSON.stringify(input.renderedContent || {}),
        JSON.stringify(input.validationIssues || []),
        input.actorUserId
      ]);
      return Boolean(result.rows[0]);
    },

    insertChange,
    insertEvent,
    touchWorkspace,

    async createAttachment(input) {
      const [technicalDraftId, commercialDraftId] = sourceValues(input);
      const result = await queryTarget.query(`
        INSERT INTO bid_package_attachments (
          workspace_id, package_type, technical_draft_id, commercial_draft_id,
          section_key, original_name, stored_path, mime_type, byte_size, sha256, uploaded_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING *
      `, [
        input.workspaceId, input.packageType, technicalDraftId, commercialDraftId,
        input.sectionKey, input.originalName, input.storedPath, input.mimeType,
        input.byteSize, input.sha256, input.actorUserId
      ]);
      return mapAttachment(result.rows[0]);
    },

    async removeAttachment(input) {
      const result = await queryTarget.query(`
        UPDATE bid_package_attachments
        SET removed_by = $3, removed_at = now()
        WHERE id = $1 AND workspace_id = $2 AND removed_at IS NULL
        RETURNING *
      `, [input.attachmentId, input.workspaceId, input.actorUserId]);
      return mapAttachment(result.rows[0]);
    },

    async createSuggestion(input) {
      const [technicalDraftId, commercialDraftId] = sourceValues(input);
      const result = await queryTarget.query(`
        INSERT INTO bid_library_suggestions (
          workspace_id, package_type, technical_draft_id, commercial_draft_id,
          section_key, target_kind, title, reason, content_snapshot, created_by
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10)
        RETURNING *
      `, [
        input.workspaceId, input.packageType, technicalDraftId, commercialDraftId,
        input.sectionKey, input.targetKind, input.title, input.reason,
        JSON.stringify(input.contentSnapshot || {}), input.actorUserId
      ]);
      return mapSuggestion(result.rows[0]);
    }
  };
}
