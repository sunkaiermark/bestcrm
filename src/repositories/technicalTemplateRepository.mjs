import { technicalClauseRevisionLabel, technicalTemplateRevisionLabel } from '../domain/technicalTemplates.mjs';

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

function mapTemplateRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    templateCode: row.template_code,
    name: row.name,
    productFamily: row.product_family,
    productModel: row.product_model || '',
    application: row.application || '',
    language: row.language,
    currentPublishedRevisionId: numberOrNull(row.current_published_revision_id),
    currentRevisionNo: numberOrNull(row.current_revision_no),
    currentRevisionLabel: row.current_revision_no ? technicalTemplateRevisionLabel(row.current_revision_no) : '',
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
    revisionLabel: technicalTemplateRevisionLabel(row.revision_no),
    status: row.status,
    changeSummary: row.change_summary,
    contentSchema: jsonValue(row.content_schema, { schemaVersion: 1, sections: [] }),
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

function mapVariableDefinitionRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    variableKey: row.variable_key,
    labelEn: row.label_en,
    labelZh: row.label_zh,
    dataType: row.data_type,
    sourceField: row.source_field,
    isActive: row.is_active,
    createdBy: Number(row.created_by),
    updatedBy: Number(row.updated_by),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapRevisionVariableRow(row) {
  if (!row) return null;
  const validationRules = jsonValue(row.validation_rules, {});
  return {
    id: Number(row.id),
    templateRevisionId: Number(row.template_revision_id),
    variableDefinitionId: Number(row.variable_definition_id),
    variableKey: row.variable_key,
    labelEn: row.label_en,
    labelZh: row.label_zh,
    dataType: row.data_type,
    sourceField: row.source_field,
    sectionKey: row.section_key || 'design_parameters',
    isRequired: row.is_required,
    defaultValue: row.default_value || '',
    validationRules,
    minValue: validationRules.min ?? '',
    maxValue: validationRules.max ?? '',
    allowedValues: Array.isArray(validationRules.allowedValues) ? validationRules.allowedValues : [],
    sortOrder: Number(row.sort_order),
    createdBy: Number(row.created_by),
    updatedBy: Number(row.updated_by),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapClauseRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    clauseCode: row.clause_code,
    revisionNo: Number(row.revision_no),
    revisionLabel: technicalClauseRevisionLabel(row.clause_code, row.revision_no),
    title: row.title,
    language: row.language,
    productFamily: row.product_family || '',
    productModel: row.product_model || '',
    application: row.application || '',
    content: row.content,
    conditionSchema: jsonValue(row.condition_schema, { all: [] }),
    status: row.status,
    changeSummary: row.change_summary,
    createdBy: Number(row.created_by),
    createdByDisplayName: row.created_by_display_name || '',
    submittedBy: numberOrNull(row.submitted_by),
    submittedAt: row.submitted_at,
    publishedBy: numberOrNull(row.published_by),
    publishedAt: row.published_at,
    retiredBy: numberOrNull(row.retired_by),
    retiredAt: row.retired_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapEventRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    templateId: numberOrNull(row.template_id),
    entityType: row.entity_type,
    entityId: Number(row.entity_id),
    eventType: row.event_type,
    fromStatus: row.from_status || '',
    toStatus: row.to_status || '',
    actorUserId: Number(row.actor_user_id),
    actorDisplayName: row.actor_display_name || '',
    details: jsonValue(row.details, {}),
    createdAt: row.created_at
  };
}

const templateSelect = `
  SELECT
    t.*,
    current_revision.revision_no AS current_revision_no,
    current_revision.status AS current_revision_status,
    latest_revision.revision_no AS latest_revision_no,
    latest_revision.status AS latest_revision_status,
    creator.display_name AS created_by_display_name,
    updater.display_name AS updated_by_display_name
  FROM technical_agreement_templates t
  LEFT JOIN technical_agreement_template_revisions current_revision
    ON current_revision.id = t.current_published_revision_id
  LEFT JOIN LATERAL (
    SELECT revision_no, status
    FROM technical_agreement_template_revisions
    WHERE template_id = t.id
    ORDER BY revision_no DESC
    LIMIT 1
  ) latest_revision ON true
  LEFT JOIN users creator ON creator.id = t.created_by
  LEFT JOIN users updater ON updater.id = t.updated_by
`;

const revisionSelect = `
  SELECT
    r.*,
    creator.display_name AS created_by_display_name,
    submitter.display_name AS submitted_by_display_name,
    publisher.display_name AS published_by_display_name,
    retirer.display_name AS retired_by_display_name
  FROM technical_agreement_template_revisions r
  LEFT JOIN users creator ON creator.id = r.created_by
  LEFT JOIN users submitter ON submitter.id = r.submitted_by
  LEFT JOIN users publisher ON publisher.id = r.published_by
  LEFT JOIN users retirer ON retirer.id = r.retired_by
`;

const clauseSelect = `
  SELECT
    c.*,
    creator.display_name AS created_by_display_name
  FROM technical_agreement_clause_blocks c
  LEFT JOIN users creator ON creator.id = c.created_by
`;

export function createTechnicalTemplateRepository(queryTarget) {
  return {
    async listTemplates({ publishedOnly = false } = {}) {
      const result = await queryTarget.query(`
        ${templateSelect}
        ${publishedOnly ? `WHERE t.is_active = true
          AND t.current_published_revision_id IS NOT NULL
          AND current_revision.status = 'published'` : ''}
        ORDER BY t.is_active DESC, t.product_family ASC, t.name ASC, t.template_code ASC
      `);
      return result.rows.map(mapTemplateRow);
    },

    async getTemplateDetail(id) {
      // queryTarget may be a transaction-scoped pg.Client, which executes one query at a time.
      const templateResult = await queryTarget.query(`${templateSelect} WHERE t.id = $1 LIMIT 1`, [id]);
      const revisionsResult = await queryTarget.query(`${revisionSelect} WHERE r.template_id = $1 ORDER BY r.revision_no DESC`, [id]);
      const variablesResult = await queryTarget.query(`
          SELECT rv.*
          FROM technical_agreement_revision_variables rv
          JOIN technical_agreement_template_revisions r ON r.id = rv.template_revision_id
          WHERE r.template_id = $1
          ORDER BY r.revision_no DESC, rv.sort_order ASC, rv.id ASC
        `, [id]);
      const eventsResult = await queryTarget.query(`
          SELECT e.*, actor.display_name AS actor_display_name
          FROM technical_template_events e
          JOIN users actor ON actor.id = e.actor_user_id
          WHERE e.template_id = $1
          ORDER BY e.created_at DESC, e.id DESC
        `, [id]);
      const template = mapTemplateRow(templateResult.rows[0]);
      if (!template) return null;
      const variables = variablesResult.rows.map(mapRevisionVariableRow);
      template.revisions = revisionsResult.rows.map(mapRevisionRow).map((revision) => ({
        ...revision,
        variables: variables.filter((variable) => variable.templateRevisionId === revision.id)
      }));
      template.events = eventsResult.rows.map(mapEventRow);
      return template;
    },

    async findRevisionById(id) {
      const result = await queryTarget.query(`${revisionSelect} WHERE r.id = $1 LIMIT 1`, [id]);
      return mapRevisionRow(result.rows[0]);
    },

    async updateRevisionContent(revisionId, contentSchema, actorUserId) {
      const result = await queryTarget.query(`
        WITH updated AS (
          UPDATE technical_agreement_template_revisions
          SET content_schema = $2::jsonb,
              updated_at = now()
          WHERE id = $1
            AND status = 'draft'
          RETURNING *
        ), inserted_event AS (
          INSERT INTO technical_template_events (
            template_id, entity_type, entity_id, event_type, actor_user_id, details
          )
          SELECT template_id, 'revision', id, 'content_schema_updated', $3,
            jsonb_build_object('sectionCount', jsonb_array_length(content_schema->'sections'))
          FROM updated
        )
        SELECT id, template_id FROM updated
      `, [revisionId, JSON.stringify(contentSchema), actorUserId]);
      return result.rows[0] ? {
        id: Number(result.rows[0].id),
        templateId: Number(result.rows[0].template_id)
      } : null;
    },

    async createTemplate(input, actorUserId) {
      const result = await queryTarget.query(`
        WITH inserted_template AS (
          INSERT INTO technical_agreement_templates (
            template_code, name, product_family, product_model, application,
            language, created_by, updated_by
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
          RETURNING *
        ), inserted_revision AS (
          INSERT INTO technical_agreement_template_revisions (
            template_id, revision_no, status, change_summary, content_schema, created_by
          )
          SELECT id, 1, 'draft', $8, $9::jsonb, $7
          FROM inserted_template
          RETURNING *
        ), inserted_event AS (
          INSERT INTO technical_template_events (
            template_id, entity_type, entity_id, event_type, to_status, actor_user_id, details
          )
          SELECT it.id, 'revision', ir.id, 'created', 'draft', $7,
            jsonb_build_object('revisionNo', ir.revision_no)
          FROM inserted_template it
          CROSS JOIN inserted_revision ir
        )
        SELECT it.id, ir.id AS revision_id
        FROM inserted_template it
        CROSS JOIN inserted_revision ir
      `, [
        input.templateCode,
        input.name,
        input.productFamily,
        input.productModel,
        input.application,
        input.language,
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
        WITH updated AS (
          UPDATE technical_agreement_templates
          SET name = $2,
              product_family = $3,
              product_model = $4,
              application = $5,
              updated_by = $6,
              updated_at = now()
          WHERE id = $1
          RETURNING *
        ), inserted_event AS (
          INSERT INTO technical_template_events (
            template_id, entity_type, entity_id, event_type, actor_user_id, details
          )
          SELECT id, 'template', id, 'metadata_updated', $6,
            jsonb_build_object('name', name, 'productFamily', product_family)
          FROM updated
        )
        SELECT id FROM updated
      `, [id, input.name, input.productFamily, input.productModel, input.application, actorUserId]);
      return result.rows[0] ? { id: Number(result.rows[0].id) } : null;
    },

    async createRevision(templateId, changeSummary, actorUserId) {
      const result = await queryTarget.query(`
        WITH source AS (
          SELECT t.id AS template_id, latest.content_schema,
            COALESCE(latest.revision_no, 0) + 1 AS next_revision_no
          FROM technical_agreement_templates t
          LEFT JOIN LATERAL (
            SELECT revision_no, content_schema
            FROM technical_agreement_template_revisions
            WHERE template_id = t.id
            ORDER BY revision_no DESC
            LIMIT 1
          ) latest ON true
          WHERE t.id = $1
            AND NOT EXISTS (
              SELECT 1 FROM technical_agreement_template_revisions open_revision
              WHERE open_revision.template_id = t.id
                AND open_revision.status IN ('draft', 'review_pending')
            )
        ), inserted AS (
          INSERT INTO technical_agreement_template_revisions (
            template_id, revision_no, status, change_summary, content_schema, created_by
          )
          SELECT template_id, next_revision_no, 'draft', $2, content_schema, $3
          FROM source
          RETURNING *
        ), copied_variables AS (
          INSERT INTO technical_agreement_revision_variables (
            template_revision_id, variable_definition_id, variable_key, label_en, label_zh,
            data_type, source_field, section_key, is_required, default_value, validation_rules,
            sort_order, created_by, updated_by
          )
          SELECT inserted.id, rv.variable_definition_id, rv.variable_key, rv.label_en, rv.label_zh,
            rv.data_type, rv.source_field, rv.section_key, rv.is_required, rv.default_value, rv.validation_rules,
            rv.sort_order, $3, $3
          FROM inserted
          LEFT JOIN LATERAL (
            SELECT previous.id
            FROM technical_agreement_template_revisions previous
            WHERE previous.template_id = inserted.template_id
              AND previous.id <> inserted.id
            ORDER BY previous.revision_no DESC
            LIMIT 1
          ) previous_revision ON true
          JOIN technical_agreement_revision_variables rv
            ON rv.template_revision_id = previous_revision.id
        ), inserted_event AS (
          INSERT INTO technical_template_events (
            template_id, entity_type, entity_id, event_type, to_status, actor_user_id, details
          )
          SELECT template_id, 'revision', id, 'created', 'draft', $3,
            jsonb_build_object('revisionNo', revision_no, 'cloned', true)
          FROM inserted
        )
        SELECT id, template_id, revision_no FROM inserted
      `, [templateId, changeSummary, actorUserId]);
      return result.rows[0] ? {
        id: Number(result.rows[0].id),
        templateId: Number(result.rows[0].template_id),
        revisionNo: Number(result.rows[0].revision_no)
      } : null;
    },

    async submitRevision(revisionId, actorUserId) {
      const result = await queryTarget.query(`
        WITH updated AS (
          UPDATE technical_agreement_template_revisions
          SET status = 'review_pending', submitted_by = $2, submitted_at = now(), updated_at = now()
          WHERE id = $1 AND status = 'draft'
          RETURNING *
        ), inserted_event AS (
          INSERT INTO technical_template_events (
            template_id, entity_type, entity_id, event_type, from_status, to_status, actor_user_id
          )
          SELECT template_id, 'revision', id, 'submitted', 'draft', 'review_pending', $2
          FROM updated
        )
        SELECT id, template_id FROM updated
      `, [revisionId, actorUserId]);
      return result.rows[0] ? { id: Number(result.rows[0].id), templateId: Number(result.rows[0].template_id) } : null;
    },

    async publishRevision(revisionId, actorUserId) {
      const result = await queryTarget.query(`
        WITH target AS (
          SELECT r.id, r.template_id
          FROM technical_agreement_template_revisions r
          WHERE r.id = $1 AND r.status = 'review_pending'
          FOR UPDATE
        ), retired AS (
          UPDATE technical_agreement_template_revisions old_revision
          SET status = 'retired', retired_by = $2, retired_at = now(), updated_at = now()
          WHERE old_revision.template_id IN (SELECT template_id FROM target)
            AND old_revision.status = 'published'
            AND old_revision.id <> $1
          RETURNING old_revision.id
        ), published AS (
          UPDATE technical_agreement_template_revisions revision
          SET status = 'published', published_by = $2, published_at = now(), updated_at = now()
          WHERE revision.id IN (SELECT id FROM target)
            AND (SELECT count(*) FROM retired) >= 0
          RETURNING revision.*
        ), updated_template AS (
          UPDATE technical_agreement_templates template
          SET current_published_revision_id = published.id,
              is_active = true,
              updated_by = $2,
              updated_at = now()
          FROM published
          WHERE template.id = published.template_id
          RETURNING template.id
        ), inserted_event AS (
          INSERT INTO technical_template_events (
            template_id, entity_type, entity_id, event_type, from_status, to_status, actor_user_id
          )
          SELECT template_id, 'revision', id, 'published', 'review_pending', 'published', $2
          FROM published
        )
        SELECT published.id, published.template_id
        FROM published
        JOIN updated_template ON updated_template.id = published.template_id
      `, [revisionId, actorUserId]);
      return result.rows[0] ? { id: Number(result.rows[0].id), templateId: Number(result.rows[0].template_id) } : null;
    },

    async retireRevision(revisionId, actorUserId) {
      const result = await queryTarget.query(`
        WITH retired AS (
          UPDATE technical_agreement_template_revisions revision
          SET status = 'retired', retired_by = $2, retired_at = now(), updated_at = now()
          FROM technical_agreement_templates template
          WHERE revision.id = $1
            AND revision.status = 'published'
            AND template.id = revision.template_id
            AND template.current_published_revision_id = revision.id
          RETURNING revision.*
        ), updated_template AS (
          UPDATE technical_agreement_templates template
          SET current_published_revision_id = NULL,
              is_active = false,
              updated_by = $2,
              updated_at = now()
          FROM retired
          WHERE template.id = retired.template_id
          RETURNING template.id
        ), inserted_event AS (
          INSERT INTO technical_template_events (
            template_id, entity_type, entity_id, event_type, from_status, to_status, actor_user_id
          )
          SELECT template_id, 'revision', id, 'retired', 'published', 'retired', $2
          FROM retired
        )
        SELECT retired.id, retired.template_id
        FROM retired
        JOIN updated_template ON updated_template.id = retired.template_id
      `, [revisionId, actorUserId]);
      return result.rows[0] ? { id: Number(result.rows[0].id), templateId: Number(result.rows[0].template_id) } : null;
    },

    async upsertRevisionVariable(revisionId, input, actorUserId) {
      const result = await queryTarget.query(`
        WITH valid AS (
          SELECT r.id AS revision_id, r.template_id, d.*
          FROM technical_agreement_template_revisions r
          JOIN technical_agreement_variable_definitions d ON d.id = $2 AND d.is_active = true
          WHERE r.id = $1 AND r.status = 'draft'
        ), saved AS (
          INSERT INTO technical_agreement_revision_variables (
            template_revision_id, variable_definition_id, variable_key, label_en, label_zh,
            data_type, source_field, section_key, is_required, default_value, validation_rules,
            sort_order, created_by, updated_by
          )
          SELECT revision_id, id, variable_key, label_en, label_zh, data_type, source_field,
            $3, $4, $5, $6::jsonb, $7, $8, $8
          FROM valid
          ON CONFLICT (template_revision_id, variable_definition_id)
          DO UPDATE SET
            variable_key = EXCLUDED.variable_key,
            label_en = EXCLUDED.label_en,
            label_zh = EXCLUDED.label_zh,
            data_type = EXCLUDED.data_type,
            source_field = EXCLUDED.source_field,
            section_key = EXCLUDED.section_key,
            is_required = EXCLUDED.is_required,
            default_value = EXCLUDED.default_value,
            validation_rules = EXCLUDED.validation_rules,
            sort_order = EXCLUDED.sort_order,
            updated_by = EXCLUDED.updated_by,
            updated_at = now()
          RETURNING *
        ), inserted_event AS (
          INSERT INTO technical_template_events (
            template_id, entity_type, entity_id, event_type, actor_user_id, details
          )
          SELECT valid.template_id, 'revision_variable', saved.id, 'variable_saved', $8,
            jsonb_build_object('variableKey', saved.variable_key, 'revisionId', saved.template_revision_id)
          FROM saved
          JOIN valid ON valid.revision_id = saved.template_revision_id
        )
        SELECT * FROM saved
      `, [
        revisionId,
        input.variableDefinitionId,
        input.sectionKey,
        input.isRequired,
        input.defaultValue,
        JSON.stringify(input.validationRules),
        input.sortOrder,
        actorUserId
      ]);
      return mapRevisionVariableRow(result.rows[0]);
    },

    async removeRevisionVariable(revisionId, variableId, actorUserId) {
      const result = await queryTarget.query(`
        WITH removed AS (
          DELETE FROM technical_agreement_revision_variables variable
          USING technical_agreement_template_revisions revision
          WHERE variable.id = $2
            AND variable.template_revision_id = $1
            AND revision.id = variable.template_revision_id
            AND revision.status = 'draft'
          RETURNING variable.*, revision.template_id
        ), inserted_event AS (
          INSERT INTO technical_template_events (
            template_id, entity_type, entity_id, event_type, actor_user_id, details
          )
          SELECT template_id, 'revision_variable', id, 'variable_removed', $3,
            jsonb_build_object('variableKey', variable_key, 'revisionId', template_revision_id)
          FROM removed
        )
        SELECT id, template_id FROM removed
      `, [revisionId, variableId, actorUserId]);
      return result.rows[0] ? {
        id: Number(result.rows[0].id),
        templateId: Number(result.rows[0].template_id)
      } : null;
    },

    async listVariableDefinitions({ activeOnly = false } = {}) {
      const result = await queryTarget.query(`
        SELECT * FROM technical_agreement_variable_definitions
        ${activeOnly ? 'WHERE is_active = true' : ''}
        ORDER BY is_active DESC, variable_key ASC
      `);
      return result.rows.map(mapVariableDefinitionRow);
    },

    async findVariableDefinitionById(id) {
      const result = await queryTarget.query(`
        SELECT * FROM technical_agreement_variable_definitions WHERE id = $1 LIMIT 1
      `, [id]);
      return mapVariableDefinitionRow(result.rows[0]);
    },

    async createVariableDefinition(input, actorUserId) {
      const result = await queryTarget.query(`
        WITH inserted AS (
          INSERT INTO technical_agreement_variable_definitions (
            variable_key, label_en, label_zh, data_type, source_field,
            is_active, created_by, updated_by
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
          RETURNING *
        ), inserted_event AS (
          INSERT INTO technical_template_events (
            entity_type, entity_id, event_type, actor_user_id, details
          )
          SELECT 'variable_definition', id, 'created', $7,
            jsonb_build_object('variableKey', variable_key)
          FROM inserted
        )
        SELECT * FROM inserted
      `, [input.variableKey, input.labelEn, input.labelZh, input.dataType, input.sourceField, input.isActive, actorUserId]);
      return mapVariableDefinitionRow(result.rows[0]);
    },

    async updateVariableDefinition(id, input, actorUserId) {
      const result = await queryTarget.query(`
        WITH updated AS (
          UPDATE technical_agreement_variable_definitions
          SET variable_key = $2,
              label_en = $3,
              label_zh = $4,
              data_type = $5,
              source_field = $6,
              is_active = $7,
              updated_by = $8,
              updated_at = now()
          WHERE id = $1
          RETURNING *
        ), inserted_event AS (
          INSERT INTO technical_template_events (
            entity_type, entity_id, event_type, actor_user_id, details
          )
          SELECT 'variable_definition', id, 'updated', $8,
            jsonb_build_object('variableKey', variable_key, 'isActive', is_active)
          FROM updated
        )
        SELECT * FROM updated
      `, [id, input.variableKey, input.labelEn, input.labelZh, input.dataType, input.sourceField, input.isActive, actorUserId]);
      return mapVariableDefinitionRow(result.rows[0]);
    },

    async deactivateVariableDefinition(id, actorUserId) {
      const result = await queryTarget.query(`
        WITH updated AS (
          UPDATE technical_agreement_variable_definitions
          SET is_active = false, updated_by = $2, updated_at = now()
          WHERE id = $1 AND is_active = true
          RETURNING *
        ), inserted_event AS (
          INSERT INTO technical_template_events (
            entity_type, entity_id, event_type, actor_user_id, details
          )
          SELECT 'variable_definition', id, 'deactivated', $2,
            jsonb_build_object('variableKey', variable_key)
          FROM updated
        )
        SELECT * FROM updated
      `, [id, actorUserId]);
      return mapVariableDefinitionRow(result.rows[0]);
    },

    async listClauses({ publishedOnly = false } = {}) {
      const result = await queryTarget.query(`
        ${clauseSelect}
        ${publishedOnly ? `WHERE c.status = 'published'` : ''}
        ORDER BY c.clause_code ASC, c.revision_no DESC
      `);
      return result.rows.map(mapClauseRow);
    },

    async findClauseById(id) {
      const result = await queryTarget.query(`${clauseSelect} WHERE c.id = $1 LIMIT 1`, [id]);
      return mapClauseRow(result.rows[0]);
    },

    async createClause(input, actorUserId) {
      const result = await queryTarget.query(`
        WITH inserted AS (
          INSERT INTO technical_agreement_clause_blocks (
            clause_code, revision_no, title, language, product_family, product_model,
            application, content, condition_schema, status, change_summary, created_by
          )
          VALUES ($1, 1, $2, $3, $4, $5, $6, $7, $8::jsonb, 'draft', $9, $10)
          RETURNING *
        ), inserted_event AS (
          INSERT INTO technical_template_events (
            entity_type, entity_id, event_type, to_status, actor_user_id, details
          )
          SELECT 'clause', id, 'created', 'draft', $10,
            jsonb_build_object('clauseCode', clause_code, 'revisionNo', revision_no)
          FROM inserted
        )
        SELECT * FROM inserted
      `, [
        input.clauseCode,
        input.title,
        input.language,
        input.productFamily,
        input.productModel,
        input.application,
        input.content,
        JSON.stringify(input.conditionSchema),
        input.changeSummary,
        actorUserId
      ]);
      return mapClauseRow(result.rows[0]);
    },

    async updateClause(id, input, actorUserId) {
      const result = await queryTarget.query(`
        WITH updated AS (
          UPDATE technical_agreement_clause_blocks
          SET title = $2,
              language = $3,
              product_family = $4,
              product_model = $5,
              application = $6,
              content = $7,
              condition_schema = $8::jsonb,
              change_summary = $9,
              updated_at = now()
          WHERE id = $1 AND status = 'draft'
          RETURNING *
        ), inserted_event AS (
          INSERT INTO technical_template_events (
            entity_type, entity_id, event_type, actor_user_id, details
          )
          SELECT 'clause', id, 'updated', $10,
            jsonb_build_object('clauseCode', clause_code, 'revisionNo', revision_no)
          FROM updated
        )
        SELECT * FROM updated
      `, [
        id,
        input.title,
        input.language,
        input.productFamily,
        input.productModel,
        input.application,
        input.content,
        JSON.stringify(input.conditionSchema),
        input.changeSummary,
        actorUserId
      ]);
      return mapClauseRow(result.rows[0]);
    },

    async createClauseRevision(id, changeSummary, actorUserId) {
      const result = await queryTarget.query(`
        WITH source AS (
          SELECT c.*,
            (SELECT COALESCE(MAX(revision_no), 0) + 1
             FROM technical_agreement_clause_blocks versions
             WHERE versions.clause_code = c.clause_code) AS next_revision_no
          FROM technical_agreement_clause_blocks c
          WHERE c.id = $1
            AND NOT EXISTS (
              SELECT 1 FROM technical_agreement_clause_blocks open_clause
              WHERE open_clause.clause_code = c.clause_code
                AND open_clause.status IN ('draft', 'review_pending')
            )
        ), inserted AS (
          INSERT INTO technical_agreement_clause_blocks (
            clause_code, revision_no, title, language, product_family, product_model,
            application, content, condition_schema, status, change_summary, created_by
          )
          SELECT clause_code, next_revision_no, title, language, product_family, product_model,
            application, content, condition_schema, 'draft', $2, $3
          FROM source
          RETURNING *
        ), inserted_event AS (
          INSERT INTO technical_template_events (
            entity_type, entity_id, event_type, to_status, actor_user_id, details
          )
          SELECT 'clause', id, 'created', 'draft', $3,
            jsonb_build_object('clauseCode', clause_code, 'revisionNo', revision_no, 'cloned', true)
          FROM inserted
        )
        SELECT * FROM inserted
      `, [id, changeSummary, actorUserId]);
      return mapClauseRow(result.rows[0]);
    },

    async submitClause(id, actorUserId) {
      const result = await queryTarget.query(`
        WITH updated AS (
          UPDATE technical_agreement_clause_blocks
          SET status = 'review_pending', submitted_by = $2, submitted_at = now(), updated_at = now()
          WHERE id = $1 AND status = 'draft'
          RETURNING *
        ), inserted_event AS (
          INSERT INTO technical_template_events (
            entity_type, entity_id, event_type, from_status, to_status, actor_user_id, details
          )
          SELECT 'clause', id, 'submitted', 'draft', 'review_pending', $2,
            jsonb_build_object('clauseCode', clause_code, 'revisionNo', revision_no)
          FROM updated
        )
        SELECT * FROM updated
      `, [id, actorUserId]);
      return mapClauseRow(result.rows[0]);
    },

    async publishClause(id, actorUserId) {
      const result = await queryTarget.query(`
        WITH target AS (
          SELECT * FROM technical_agreement_clause_blocks
          WHERE id = $1 AND status = 'review_pending'
          FOR UPDATE
        ), retired AS (
          UPDATE technical_agreement_clause_blocks old_clause
          SET status = 'retired', retired_by = $2, retired_at = now(), updated_at = now()
          WHERE old_clause.clause_code IN (SELECT clause_code FROM target)
            AND old_clause.status = 'published'
            AND old_clause.id <> $1
          RETURNING old_clause.id
        ), published AS (
          UPDATE technical_agreement_clause_blocks clause
          SET status = 'published', published_by = $2, published_at = now(), updated_at = now()
          WHERE clause.id IN (SELECT id FROM target)
            AND (SELECT count(*) FROM retired) >= 0
          RETURNING clause.*
        ), inserted_event AS (
          INSERT INTO technical_template_events (
            entity_type, entity_id, event_type, from_status, to_status, actor_user_id, details
          )
          SELECT 'clause', id, 'published', 'review_pending', 'published', $2,
            jsonb_build_object('clauseCode', clause_code, 'revisionNo', revision_no)
          FROM published
        )
        SELECT * FROM published
      `, [id, actorUserId]);
      return mapClauseRow(result.rows[0]);
    },

    async retireClause(id, actorUserId) {
      const result = await queryTarget.query(`
        WITH retired AS (
          UPDATE technical_agreement_clause_blocks
          SET status = 'retired', retired_by = $2, retired_at = now(), updated_at = now()
          WHERE id = $1 AND status = 'published'
          RETURNING *
        ), inserted_event AS (
          INSERT INTO technical_template_events (
            entity_type, entity_id, event_type, from_status, to_status, actor_user_id, details
          )
          SELECT 'clause', id, 'retired', 'published', 'retired', $2,
            jsonb_build_object('clauseCode', clause_code, 'revisionNo', revision_no)
          FROM retired
        )
        SELECT * FROM retired
      `, [id, actorUserId]);
      return mapClauseRow(result.rows[0]);
    }
  };
}
