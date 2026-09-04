import { commercialTemplateRevisionLabel } from '../domain/bidCenter.mjs';

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

function mapTemplateRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    templateCode: row.template_code,
    nameEn: row.name_en,
    nameZh: row.name_zh,
    language: row.language,
    applicableCountries: jsonValue(row.applicable_countries, []),
    applicableIndustries: jsonValue(row.applicable_industries, []),
    applicableCustomerTypes: jsonValue(row.applicable_customer_types, []),
    currentPublishedRevisionId: numberOrNull(row.current_published_revision_id),
    currentRevisionNo: numberOrNull(row.current_revision_no),
    currentRevisionLabel: row.current_revision_no ? commercialTemplateRevisionLabel(row.current_revision_no) : '',
    currentRevisionStatus: row.current_revision_status || '',
    latestRevisionNo: numberOrNull(row.latest_revision_no),
    latestRevisionStatus: row.latest_revision_status || '',
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
  return {
    id: Number(row.id),
    templateId: Number(row.template_id),
    revisionNo: Number(row.revision_no),
    revisionLabel: commercialTemplateRevisionLabel(row.revision_no),
    status: row.status,
    changeSummary: row.change_summary,
    contentSchema: jsonValue(row.content_schema, { schemaVersion: 1, sections: [] }),
    variableSchema: jsonValue(row.variable_schema, []),
    validationRules: jsonValue(row.validation_rules, {}),
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

const templateSelect = `
  SELECT
    template.*,
    current_revision.revision_no AS current_revision_no,
    current_revision.status AS current_revision_status,
    latest_revision.revision_no AS latest_revision_no,
    latest_revision.status AS latest_revision_status,
    creator.display_name AS created_by_display_name,
    updater.display_name AS updated_by_display_name
  FROM commercial_package_templates template
  LEFT JOIN commercial_package_template_revisions current_revision
    ON current_revision.id = template.current_published_revision_id
  LEFT JOIN LATERAL (
    SELECT revision_no, status
    FROM commercial_package_template_revisions
    WHERE template_id = template.id
    ORDER BY revision_no DESC
    LIMIT 1
  ) latest_revision ON true
  LEFT JOIN users creator ON creator.id = template.created_by
  LEFT JOIN users updater ON updater.id = template.updated_by
`;

const revisionSelect = `
  SELECT
    revision.*,
    creator.display_name AS created_by_display_name,
    submitter.display_name AS submitted_by_display_name,
    publisher.display_name AS published_by_display_name,
    retirer.display_name AS retired_by_display_name
  FROM commercial_package_template_revisions revision
  LEFT JOIN users creator ON creator.id = revision.created_by
  LEFT JOIN users submitter ON submitter.id = revision.submitted_by
  LEFT JOIN users publisher ON publisher.id = revision.published_by
  LEFT JOIN users retirer ON retirer.id = revision.retired_by
`;

export function createCommercialPackageTemplateRepository(queryTarget) {
  return {
    async listTemplates({ publishedOnly = false } = {}) {
      const result = await queryTarget.query(`
        ${templateSelect}
        ${publishedOnly ? `WHERE template.is_active = true
          AND template.current_published_revision_id IS NOT NULL
          AND current_revision.status = 'published'` : ''}
        ORDER BY template.is_active DESC, template.template_code ASC
      `);
      return result.rows.map(mapTemplateRow);
    },

    async getTemplateDetail(id) {
      // queryTarget may be a transaction-scoped pg.Client, which executes one query at a time.
      const templateResult = await queryTarget.query(`${templateSelect} WHERE template.id = $1 LIMIT 1`, [id]);
      const revisionsResult = await queryTarget.query(
        `${revisionSelect} WHERE revision.template_id = $1 ORDER BY revision.revision_no DESC`,
        [id]
      );
      const template = mapTemplateRow(templateResult.rows[0]);
      if (!template) return null;
      template.revisions = revisionsResult.rows.map(mapRevisionRow);
      return template;
    },

    async findRevisionById(id) {
      const result = await queryTarget.query(`${revisionSelect} WHERE revision.id = $1 LIMIT 1`, [id]);
      return mapRevisionRow(result.rows[0]);
    },

    async createTemplate(input, actorUserId) {
      const result = await queryTarget.query(`
        WITH inserted_template AS (
          INSERT INTO commercial_package_templates (
            template_code, name_en, name_zh, language, applicable_countries,
            applicable_industries, applicable_customer_types, created_by, updated_by
          )
          VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8, $8)
          RETURNING *
        ), inserted_revision AS (
          INSERT INTO commercial_package_template_revisions (
            template_id, revision_no, status, change_summary, content_schema,
            variable_schema, validation_rules, created_by
          )
          SELECT id, 1, 'draft', $9, $10::jsonb, '[]'::jsonb, '{}'::jsonb, $8
          FROM inserted_template
          RETURNING *
        )
        SELECT inserted_template.id, inserted_revision.id AS revision_id
        FROM inserted_template CROSS JOIN inserted_revision
      `, [
        input.templateCode,
        input.nameEn,
        input.nameZh,
        input.language,
        JSON.stringify(input.applicableCountries),
        JSON.stringify(input.applicableIndustries),
        JSON.stringify(input.applicableCustomerTypes),
        actorUserId,
        input.changeSummary,
        JSON.stringify(input.contentSchema)
      ]);
      return result.rows[0] ? {
        id: Number(result.rows[0].id),
        revisionId: Number(result.rows[0].revision_id)
      } : null;
    },

    async updateTemplate(id, input, actorUserId) {
      const result = await queryTarget.query(`
        UPDATE commercial_package_templates
        SET name_en = $2,
            name_zh = $3,
            language = $4,
            applicable_countries = $5::jsonb,
            applicable_industries = $6::jsonb,
            applicable_customer_types = $7::jsonb,
            updated_by = $8,
            updated_at = now()
        WHERE id = $1
        RETURNING id
      `, [
        id,
        input.nameEn,
        input.nameZh,
        input.language,
        JSON.stringify(input.applicableCountries),
        JSON.stringify(input.applicableIndustries),
        JSON.stringify(input.applicableCustomerTypes),
        actorUserId
      ]);
      return result.rows[0] ? { id: Number(result.rows[0].id) } : null;
    },

    async createRevision(templateId, changeSummary, actorUserId) {
      const result = await queryTarget.query(`
        WITH source AS (
          SELECT template.id AS template_id,
            latest.content_schema,
            latest.variable_schema,
            latest.validation_rules,
            COALESCE(latest.revision_no, 0) + 1 AS next_revision_no
          FROM commercial_package_templates template
          LEFT JOIN LATERAL (
            SELECT * FROM commercial_package_template_revisions
            WHERE template_id = template.id
            ORDER BY revision_no DESC
            LIMIT 1
          ) latest ON true
          WHERE template.id = $1
            AND NOT EXISTS (
              SELECT 1 FROM commercial_package_template_revisions open_revision
              WHERE open_revision.template_id = template.id
                AND open_revision.status IN ('draft', 'review_pending')
            )
        )
        INSERT INTO commercial_package_template_revisions (
          template_id, revision_no, status, change_summary, content_schema,
          variable_schema, validation_rules, created_by
        )
        SELECT template_id, next_revision_no, 'draft', $2, content_schema,
          variable_schema, validation_rules, $3
        FROM source
        RETURNING id, template_id, revision_no
      `, [templateId, changeSummary, actorUserId]);
      return result.rows[0] ? {
        id: Number(result.rows[0].id),
        templateId: Number(result.rows[0].template_id),
        revisionNo: Number(result.rows[0].revision_no)
      } : null;
    },

    async updateRevisionContent(revisionId, contentSchema, actorUserId) {
      const result = await queryTarget.query(`
        UPDATE commercial_package_template_revisions
        SET content_schema = $2::jsonb, updated_at = now()
        WHERE id = $1 AND status = 'draft'
        RETURNING id, template_id
      `, [revisionId, JSON.stringify(contentSchema)]);
      return result.rows[0] ? {
        id: Number(result.rows[0].id),
        templateId: Number(result.rows[0].template_id)
      } : null;
    },

    async submitRevision(revisionId, actorUserId) {
      const result = await queryTarget.query(`
        UPDATE commercial_package_template_revisions
        SET status = 'review_pending', submitted_by = $2, submitted_at = now(), updated_at = now()
        WHERE id = $1 AND status = 'draft'
        RETURNING id, template_id
      `, [revisionId, actorUserId]);
      return result.rows[0] ? {
        id: Number(result.rows[0].id),
        templateId: Number(result.rows[0].template_id)
      } : null;
    },

    async publishRevision(revisionId, actorUserId) {
      const result = await queryTarget.query(`
        WITH target AS (
          SELECT id, template_id
          FROM commercial_package_template_revisions
          WHERE id = $1 AND status = 'review_pending'
          FOR UPDATE
        ), retired AS (
          UPDATE commercial_package_template_revisions old_revision
          SET status = 'retired', retired_by = $2, retired_at = now(), updated_at = now()
          WHERE old_revision.template_id IN (SELECT template_id FROM target)
            AND old_revision.status = 'published'
            AND old_revision.id <> $1
          RETURNING old_revision.id
        ), published AS (
          UPDATE commercial_package_template_revisions revision
          SET status = 'published', published_by = $2, published_at = now(), updated_at = now()
          WHERE revision.id IN (SELECT id FROM target)
            AND (SELECT count(*) FROM retired) >= 0
          RETURNING revision.id, revision.template_id
        ), updated_template AS (
          UPDATE commercial_package_templates template
          SET current_published_revision_id = published.id,
              is_active = true,
              updated_by = $2,
              updated_at = now()
          FROM published
          WHERE template.id = published.template_id
          RETURNING template.id
        )
        SELECT published.id, published.template_id
        FROM published JOIN updated_template ON updated_template.id = published.template_id
      `, [revisionId, actorUserId]);
      return result.rows[0] ? {
        id: Number(result.rows[0].id),
        templateId: Number(result.rows[0].template_id)
      } : null;
    },

    async retireRevision(revisionId, actorUserId) {
      const result = await queryTarget.query(`
        WITH retired AS (
          UPDATE commercial_package_template_revisions revision
          SET status = 'retired', retired_by = $2, retired_at = now(), updated_at = now()
          FROM commercial_package_templates template
          WHERE revision.id = $1
            AND revision.status = 'published'
            AND template.id = revision.template_id
            AND template.current_published_revision_id = revision.id
          RETURNING revision.id, revision.template_id
        ), updated_template AS (
          UPDATE commercial_package_templates template
          SET current_published_revision_id = NULL,
              is_active = false,
              updated_by = $2,
              updated_at = now()
          FROM retired
          WHERE template.id = retired.template_id
          RETURNING template.id
        )
        SELECT retired.id, retired.template_id
        FROM retired JOIN updated_template ON updated_template.id = retired.template_id
      `, [revisionId, actorUserId]);
      return result.rows[0] ? {
        id: Number(result.rows[0].id),
        templateId: Number(result.rows[0].template_id)
      } : null;
    }
  };
}
