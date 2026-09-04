import { contentRevisionLabel } from '../domain/bidCenterLibrary.mjs';

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

function mapBlockRow(row, { publishedView = false } = {}) {
  if (!row) return null;
  return {
    id: Number(row.id),
    blockCode: row.block_code,
    category: row.category,
    nameEn: row.name_en,
    nameZh: row.name_zh,
    applicableCountries: jsonValue(row.applicable_countries, []),
    applicableIndustries: jsonValue(row.applicable_industries, []),
    applicableProductFamilies: jsonValue(row.applicable_product_families, []),
    applicableCustomerTypes: jsonValue(row.applicable_customer_types, []),
    applicableSections: jsonValue(row.applicable_sections, []),
    ownerRoleCode: row.owner_role_code,
    currentPublishedRevisionId: numberOrNull(row.current_published_revision_id),
    currentRevisionNo: numberOrNull(row.current_revision_no),
    currentRevisionLabel: row.current_revision_no ? contentRevisionLabel(row.block_code, row.current_revision_no) : '',
    currentRevisionStatus: row.current_revision_status || '',
    latestRevisionNo: numberOrNull(publishedView ? row.current_revision_no : row.latest_revision_no),
    latestRevisionLabel: (publishedView ? row.current_revision_no : row.latest_revision_no)
      ? contentRevisionLabel(row.block_code, publishedView ? row.current_revision_no : row.latest_revision_no) : '',
    latestRevisionStatus: (publishedView ? row.current_revision_status : row.latest_revision_status) || '',
    libraryType: (publishedView ? row.current_library_type : row.latest_library_type) || row.current_library_type || '',
    language: (publishedView ? row.current_language : row.latest_language) || row.current_language || '',
    componentType: (publishedView ? row.current_component_type : row.latest_component_type) || row.current_component_type || '',
    titleEn: (publishedView ? row.current_title_en : row.latest_title_en) || row.current_title_en || '',
    titleZh: (publishedView ? row.current_title_zh : row.latest_title_zh) || row.current_title_zh || '',
    sensitivity: (publishedView ? row.current_sensitivity : row.latest_sensitivity) || row.current_sensitivity || '',
    currentSensitivity: row.current_sensitivity || '',
    latestSensitivity: row.latest_sensitivity || '',
    effectiveDate: (publishedView ? row.current_effective_date : row.latest_effective_date) || row.current_effective_date || null,
    expiresAt: (publishedView ? row.current_expires_at : row.latest_expires_at) || row.current_expires_at || null,
    hasAttachment: Boolean((publishedView ? row.current_attachment_sha256 : row.latest_attachment_sha256) || row.current_attachment_sha256),
    isActive: row.is_active,
    createdBy: Number(row.created_by),
    createdByDisplayName: row.created_by_display_name || '',
    updatedBy: Number(row.updated_by),
    updatedByDisplayName: row.updated_by_display_name || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapRevisionRow(row) {
  if (!row) return null;
  const sourceMetadata = jsonValue(row.source_metadata, {});
  const contentSchema = jsonValue(row.content_schema, {});
  return {
    id: Number(row.id),
    contentBlockId: Number(row.content_block_id),
    blockCode: row.block_code,
    revisionNo: Number(row.revision_no),
    revisionLabel: contentRevisionLabel(row.block_code, row.revision_no),
    status: row.status,
    language: row.language,
    componentType: row.component_type,
    titleEn: row.title_en || '',
    titleZh: row.title_zh || '',
    contentSchema,
    bodyEn: contentSchema.bodyEn || '',
    bodyZh: contentSchema.bodyZh || '',
    tableRows: Array.isArray(contentSchema.tableRows) ? contentSchema.tableRows : [],
    conditionSchema: jsonValue(row.condition_schema, { all: [] }),
    allowedVariables: jsonValue(row.allowed_variables, []),
    sourceMetadata,
    libraryType: sourceMetadata.libraryType || '',
    attachmentStoredPath: row.attachment_stored_path || '',
    attachmentOriginalName: row.attachment_original_name || '',
    attachmentMimeType: row.attachment_mime_type || '',
    attachmentByteSize: numberOrNull(row.attachment_byte_size),
    attachmentSha256: row.attachment_sha256 || '',
    effectiveDate: row.effective_date,
    expiresAt: row.expires_at,
    reviewDueAt: row.review_due_at,
    sensitivity: row.sensitivity,
    changeSummary: row.change_summary,
    createdBy: Number(row.created_by),
    createdByDisplayName: row.created_by_display_name || '',
    submittedBy: numberOrNull(row.submitted_by),
    submittedByDisplayName: row.submitted_by_display_name || '',
    submittedAt: row.submitted_at,
    publishedBy: numberOrNull(row.published_by),
    publishedByDisplayName: row.published_by_display_name || '',
    publishedAt: row.published_at,
    retiredBy: numberOrNull(row.retired_by),
    retiredByDisplayName: row.retired_by_display_name || '',
    retiredAt: row.retired_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

const blockSelect = `
  SELECT
    block.*,
    current_revision.revision_no AS current_revision_no,
    current_revision.status AS current_revision_status,
    current_revision.language AS current_language,
    current_revision.component_type AS current_component_type,
    current_revision.title_en AS current_title_en,
    current_revision.title_zh AS current_title_zh,
    current_revision.sensitivity AS current_sensitivity,
    current_revision.effective_date AS current_effective_date,
    current_revision.expires_at AS current_expires_at,
    current_revision.attachment_sha256 AS current_attachment_sha256,
    current_revision.source_metadata->>'libraryType' AS current_library_type,
    latest_revision.revision_no AS latest_revision_no,
    latest_revision.status AS latest_revision_status,
    latest_revision.language AS latest_language,
    latest_revision.component_type AS latest_component_type,
    latest_revision.title_en AS latest_title_en,
    latest_revision.title_zh AS latest_title_zh,
    latest_revision.sensitivity AS latest_sensitivity,
    latest_revision.effective_date AS latest_effective_date,
    latest_revision.expires_at AS latest_expires_at,
    latest_revision.attachment_sha256 AS latest_attachment_sha256,
    latest_revision.source_metadata->>'libraryType' AS latest_library_type,
    creator.display_name AS created_by_display_name,
    updater.display_name AS updated_by_display_name
  FROM bid_content_blocks block
  LEFT JOIN bid_content_block_revisions current_revision
    ON current_revision.id = block.current_published_revision_id
  LEFT JOIN LATERAL (
    SELECT revision_no, status, language, component_type, title_en, title_zh,
      sensitivity, effective_date, expires_at, attachment_sha256, source_metadata
    FROM bid_content_block_revisions
    WHERE content_block_id = block.id
    ORDER BY revision_no DESC
    LIMIT 1
  ) latest_revision ON true
  LEFT JOIN users creator ON creator.id = block.created_by
  LEFT JOIN users updater ON updater.id = block.updated_by
`;

const revisionSelect = `
  SELECT
    revision.*,
    block.block_code,
    creator.display_name AS created_by_display_name,
    submitter.display_name AS submitted_by_display_name,
    publisher.display_name AS published_by_display_name,
    retirer.display_name AS retired_by_display_name
  FROM bid_content_block_revisions revision
  JOIN bid_content_blocks block ON block.id = revision.content_block_id
  LEFT JOIN users creator ON creator.id = revision.created_by
  LEFT JOIN users submitter ON submitter.id = revision.submitted_by
  LEFT JOIN users publisher ON publisher.id = revision.published_by
  LEFT JOIN users retirer ON retirer.id = revision.retired_by
`;

export function createBidContentBlockRepository(queryTarget) {
  return {
    async listBlocks({ categories, libraryType, publishedOnly = false } = {}) {
      const normalizedCategories = Array.isArray(categories) && categories.length
        ? categories
        : ['technical', 'commercial', 'common'];
      const result = await queryTarget.query(`
        ${blockSelect}
        WHERE block.category = ANY($1::text[])
          AND latest_revision.source_metadata->>'libraryType' = $2
          ${publishedOnly ? `AND block.is_active = true
            AND block.current_published_revision_id IS NOT NULL
            AND current_revision.status = 'published'` : ''}
        ORDER BY block.is_active DESC, block.category ASC, block.block_code ASC
      `, [normalizedCategories, libraryType]);
      return result.rows.map((row) => mapBlockRow(row, { publishedView: publishedOnly }));
    },

    async getBlockDetail(id) {
      const [blockResult, revisionsResult] = await Promise.all([
        queryTarget.query(`${blockSelect} WHERE block.id = $1 LIMIT 1`, [id]),
        queryTarget.query(`${revisionSelect} WHERE revision.content_block_id = $1 ORDER BY revision.revision_no DESC`, [id])
      ]);
      const block = mapBlockRow(blockResult.rows[0]);
      if (!block) return null;
      block.revisions = revisionsResult.rows.map(mapRevisionRow);
      return block;
    },

    async findRevisionById(id) {
      const result = await queryTarget.query(`${revisionSelect} WHERE revision.id = $1 LIMIT 1`, [id]);
      return mapRevisionRow(result.rows[0]);
    },

    async createBlock(input, actorUserId) {
      const attachment = input.attachment || {};
      const result = await queryTarget.query(`
        WITH inserted_block AS (
          INSERT INTO bid_content_blocks (
            block_code, category, name_en, name_zh, applicable_countries,
            applicable_industries, applicable_product_families, applicable_customer_types,
            applicable_sections, owner_role_code, created_by, updated_by
          )
          VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8::jsonb,
            $9::jsonb, $10, $11, $11)
          RETURNING *
        ), inserted_revision AS (
          INSERT INTO bid_content_block_revisions (
            content_block_id, revision_no, status, language, component_type,
            title_en, title_zh, content_schema, condition_schema, allowed_variables,
            source_metadata, attachment_stored_path, attachment_original_name,
            attachment_mime_type, attachment_byte_size, attachment_sha256,
            effective_date, expires_at, review_due_at, sensitivity, change_summary, created_by
          )
          SELECT id, 1, 'draft', $12, $13, $14, $15, $16::jsonb, $17::jsonb,
            $18::jsonb, $19::jsonb, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $11
          FROM inserted_block
          RETURNING *
        )
        SELECT inserted_block.id, inserted_revision.id AS revision_id
        FROM inserted_block CROSS JOIN inserted_revision
      `, [
        input.blockCode,
        input.category,
        input.nameEn,
        input.nameZh,
        JSON.stringify(input.applicableCountries),
        JSON.stringify(input.applicableIndustries),
        JSON.stringify(input.applicableProductFamilies),
        JSON.stringify(input.applicableCustomerTypes),
        JSON.stringify(input.applicableSections),
        input.ownerRoleCode,
        actorUserId,
        input.language,
        input.componentType,
        input.titleEn,
        input.titleZh,
        JSON.stringify(input.contentSchema),
        JSON.stringify(input.conditionSchema),
        JSON.stringify(input.allowedVariables),
        JSON.stringify(input.sourceMetadata),
        attachment.storedPath || null,
        attachment.originalName || null,
        attachment.mimeType || null,
        attachment.byteSize || null,
        attachment.sha256 || null,
        input.effectiveDate,
        input.expiresAt,
        input.reviewDueAt,
        input.sensitivity,
        input.changeSummary
      ]);
      return result.rows[0] ? {
        id: Number(result.rows[0].id),
        revisionId: Number(result.rows[0].revision_id)
      } : null;
    },

    async updateBlock(id, input, actorUserId) {
      const result = await queryTarget.query(`
        UPDATE bid_content_blocks
        SET name_en = $2,
            name_zh = $3,
            applicable_countries = $4::jsonb,
            applicable_industries = $5::jsonb,
            applicable_product_families = $6::jsonb,
            applicable_customer_types = $7::jsonb,
            applicable_sections = $8::jsonb,
            updated_by = $9,
            updated_at = now()
        WHERE id = $1
        RETURNING id
      `, [
        id,
        input.nameEn,
        input.nameZh,
        JSON.stringify(input.applicableCountries),
        JSON.stringify(input.applicableIndustries),
        JSON.stringify(input.applicableProductFamilies),
        JSON.stringify(input.applicableCustomerTypes),
        JSON.stringify(input.applicableSections),
        actorUserId
      ]);
      return result.rows[0] ? { id: Number(result.rows[0].id) } : null;
    },

    async updateRevision(revisionId, input) {
      const attachment = input.attachment || {};
      const result = await queryTarget.query(`
        UPDATE bid_content_block_revisions
        SET language = $2,
            component_type = $3,
            title_en = $4,
            title_zh = $5,
            content_schema = $6::jsonb,
            condition_schema = $7::jsonb,
            allowed_variables = $8::jsonb,
            source_metadata = $9::jsonb,
            attachment_stored_path = $10,
            attachment_original_name = $11,
            attachment_mime_type = $12,
            attachment_byte_size = $13,
            attachment_sha256 = $14,
            effective_date = $15,
            expires_at = $16,
            review_due_at = $17,
            sensitivity = $18,
            change_summary = $19,
            updated_at = now()
        WHERE id = $1 AND status = 'draft'
        RETURNING id, content_block_id
      `, [
        revisionId,
        input.language,
        input.componentType,
        input.titleEn,
        input.titleZh,
        JSON.stringify(input.contentSchema),
        JSON.stringify(input.conditionSchema),
        JSON.stringify(input.allowedVariables),
        JSON.stringify(input.sourceMetadata),
        attachment.storedPath || null,
        attachment.originalName || null,
        attachment.mimeType || null,
        attachment.byteSize || null,
        attachment.sha256 || null,
        input.effectiveDate,
        input.expiresAt,
        input.reviewDueAt,
        input.sensitivity,
        input.changeSummary
      ]);
      return result.rows[0] ? {
        id: Number(result.rows[0].id),
        contentBlockId: Number(result.rows[0].content_block_id)
      } : null;
    },

    async updateDraft(blockId, revisionId, metadata, input, actorUserId) {
      const attachment = input.attachment || {};
      const result = await queryTarget.query(`
        WITH updated_block AS (
          UPDATE bid_content_blocks
          SET name_en = $3,
              name_zh = $4,
              applicable_countries = $5::jsonb,
              applicable_industries = $6::jsonb,
              applicable_product_families = $7::jsonb,
              applicable_customer_types = $8::jsonb,
              applicable_sections = $9::jsonb,
              updated_by = $10,
              updated_at = now()
          WHERE id = $1
            AND EXISTS (
              SELECT 1 FROM bid_content_block_revisions revision
              WHERE revision.id = $2
                AND revision.content_block_id = bid_content_blocks.id
                AND revision.status = 'draft'
            )
          RETURNING id
        ), updated_revision AS (
          UPDATE bid_content_block_revisions revision
          SET language = $11,
              component_type = $12,
              title_en = $13,
              title_zh = $14,
              content_schema = $15::jsonb,
              condition_schema = $16::jsonb,
              allowed_variables = $17::jsonb,
              source_metadata = $18::jsonb,
              attachment_stored_path = $19,
              attachment_original_name = $20,
              attachment_mime_type = $21,
              attachment_byte_size = $22,
              attachment_sha256 = $23,
              effective_date = $24,
              expires_at = $25,
              review_due_at = $26,
              sensitivity = $27,
              change_summary = $28,
              updated_at = now()
          WHERE revision.id = $2
            AND revision.content_block_id IN (SELECT id FROM updated_block)
            AND revision.status = 'draft'
          RETURNING revision.id, revision.content_block_id
        )
        SELECT id, content_block_id FROM updated_revision
      `, [
        blockId,
        revisionId,
        metadata.nameEn,
        metadata.nameZh,
        JSON.stringify(metadata.applicableCountries),
        JSON.stringify(metadata.applicableIndustries),
        JSON.stringify(metadata.applicableProductFamilies),
        JSON.stringify(metadata.applicableCustomerTypes),
        JSON.stringify(metadata.applicableSections),
        actorUserId,
        input.language,
        input.componentType,
        input.titleEn,
        input.titleZh,
        JSON.stringify(input.contentSchema),
        JSON.stringify(input.conditionSchema),
        JSON.stringify(input.allowedVariables),
        JSON.stringify(input.sourceMetadata),
        attachment.storedPath || null,
        attachment.originalName || null,
        attachment.mimeType || null,
        attachment.byteSize || null,
        attachment.sha256 || null,
        input.effectiveDate,
        input.expiresAt,
        input.reviewDueAt,
        input.sensitivity,
        input.changeSummary
      ]);
      return result.rows[0] ? {
        id: Number(result.rows[0].id),
        contentBlockId: Number(result.rows[0].content_block_id)
      } : null;
    },

    async createRevision(blockId, changeSummary, actorUserId) {
      const result = await queryTarget.query(`
        WITH source AS (
          SELECT block.id AS content_block_id,
            latest.revision_no + 1 AS next_revision_no,
            latest.language,
            latest.component_type,
            latest.title_en,
            latest.title_zh,
            latest.content_schema,
            latest.condition_schema,
            latest.allowed_variables,
            latest.source_metadata,
            latest.attachment_stored_path,
            latest.attachment_original_name,
            latest.attachment_mime_type,
            latest.attachment_byte_size,
            latest.attachment_sha256,
            latest.effective_date,
            latest.expires_at,
            latest.review_due_at,
            latest.sensitivity
          FROM bid_content_blocks block
          JOIN LATERAL (
            SELECT * FROM bid_content_block_revisions
            WHERE content_block_id = block.id
            ORDER BY revision_no DESC
            LIMIT 1
          ) latest ON true
          WHERE block.id = $1
            AND NOT EXISTS (
              SELECT 1 FROM bid_content_block_revisions open_revision
              WHERE open_revision.content_block_id = block.id
                AND open_revision.status IN ('draft', 'review_pending')
            )
        )
        INSERT INTO bid_content_block_revisions (
          content_block_id, revision_no, status, language, component_type,
          title_en, title_zh, content_schema, condition_schema, allowed_variables,
          source_metadata, attachment_stored_path, attachment_original_name,
          attachment_mime_type, attachment_byte_size, attachment_sha256,
          effective_date, expires_at, review_due_at, sensitivity, change_summary, created_by
        )
        SELECT content_block_id, next_revision_no, 'draft', language, component_type,
          title_en, title_zh, content_schema, condition_schema, allowed_variables,
          source_metadata, attachment_stored_path, attachment_original_name,
          attachment_mime_type, attachment_byte_size, attachment_sha256,
          effective_date, expires_at, review_due_at, sensitivity, $2, $3
        FROM source
        RETURNING id, content_block_id, revision_no
      `, [blockId, changeSummary, actorUserId]);
      return result.rows[0] ? {
        id: Number(result.rows[0].id),
        contentBlockId: Number(result.rows[0].content_block_id),
        revisionNo: Number(result.rows[0].revision_no)
      } : null;
    },

    async submitRevision(revisionId, actorUserId) {
      const result = await queryTarget.query(`
        UPDATE bid_content_block_revisions
        SET status = 'review_pending', submitted_by = $2, submitted_at = now(), updated_at = now()
        WHERE id = $1 AND status = 'draft'
        RETURNING id, content_block_id
      `, [revisionId, actorUserId]);
      return result.rows[0] ? {
        id: Number(result.rows[0].id),
        contentBlockId: Number(result.rows[0].content_block_id)
      } : null;
    },

    async publishRevision(revisionId, actorUserId) {
      const result = await queryTarget.query(`
        WITH target AS (
          SELECT id, content_block_id
          FROM bid_content_block_revisions
          WHERE id = $1 AND status = 'review_pending'
          FOR UPDATE
        ), retired AS (
          UPDATE bid_content_block_revisions old_revision
          SET status = 'retired', retired_by = $2, retired_at = now(), updated_at = now()
          WHERE old_revision.content_block_id IN (SELECT content_block_id FROM target)
            AND old_revision.status = 'published'
            AND old_revision.id <> $1
          RETURNING old_revision.id
        ), published AS (
          UPDATE bid_content_block_revisions revision
          SET status = 'published', published_by = $2, published_at = now(), updated_at = now()
          WHERE revision.id IN (SELECT id FROM target)
            AND (SELECT count(*) FROM retired) >= 0
          RETURNING revision.id, revision.content_block_id
        ), updated_block AS (
          UPDATE bid_content_blocks block
          SET current_published_revision_id = published.id,
              is_active = true,
              updated_by = $2,
              updated_at = now()
          FROM published
          WHERE block.id = published.content_block_id
          RETURNING block.id
        )
        SELECT published.id, published.content_block_id
        FROM published JOIN updated_block ON updated_block.id = published.content_block_id
      `, [revisionId, actorUserId]);
      return result.rows[0] ? {
        id: Number(result.rows[0].id),
        contentBlockId: Number(result.rows[0].content_block_id)
      } : null;
    },

    async retireRevision(revisionId, actorUserId) {
      const result = await queryTarget.query(`
        WITH retired AS (
          UPDATE bid_content_block_revisions revision
          SET status = 'retired', retired_by = $2, retired_at = now(), updated_at = now()
          FROM bid_content_blocks block
          WHERE revision.id = $1
            AND revision.status = 'published'
            AND block.id = revision.content_block_id
            AND block.current_published_revision_id = revision.id
          RETURNING revision.id, revision.content_block_id
        ), updated_block AS (
          UPDATE bid_content_blocks block
          SET current_published_revision_id = NULL,
              is_active = false,
              updated_by = $2,
              updated_at = now()
          FROM retired
          WHERE block.id = retired.content_block_id
          RETURNING block.id
        )
        SELECT retired.id, retired.content_block_id
        FROM retired JOIN updated_block ON updated_block.id = retired.content_block_id
      `, [revisionId, actorUserId]);
      return result.rows[0] ? {
        id: Number(result.rows[0].id),
        contentBlockId: Number(result.rows[0].content_block_id)
      } : null;
    }
  };
}
