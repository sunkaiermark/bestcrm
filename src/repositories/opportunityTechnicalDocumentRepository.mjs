import { opportunityTechnicalDocumentVersionLabel } from '../domain/technicalTemplates.mjs';

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

function mapEquipmentRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    opportunityId: Number(row.opportunity_id),
    itemNo: Number(row.item_no),
    productCategoryCode: row.product_category_code,
    equipmentName: row.equipment_name,
    model: row.model || '',
    quantity: Number(row.quantity),
    technicalParameters: jsonValue(row.technical_parameters, []),
    archivedAt: row.archived_at,
    archivedBy: numberOrNull(row.archived_by),
    createdBy: Number(row.created_by),
    updatedBy: Number(row.updated_by),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapDocumentRow(row) {
  if (!row) return null;
  const currentVersionNo = Number(row.current_version_no || 0);
  return {
    id: Number(row.id),
    opportunityId: Number(row.opportunity_id),
    documentType: row.document_type,
    primaryEquipmentItemId: numberOrNull(row.primary_equipment_item_id),
    documentCode: row.document_code,
    title: row.title,
    currentVersionNo,
    currentVersionLabel: currentVersionNo > 0
      ? opportunityTechnicalDocumentVersionLabel(row.document_code, currentVersionNo)
      : '',
    currentVersionId: numberOrNull(row.current_version_id),
    currentVersionCreatedAt: row.current_version_created_at || null,
    itemCount: Number(row.item_count || 0),
    createdBy: Number(row.created_by),
    createdByDisplayName: row.created_by_display_name || '',
    updatedBy: Number(row.updated_by),
    updatedByDisplayName: row.updated_by_display_name || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapVersionRow(row, documentCode = '') {
  if (!row) return null;
  return {
    id: Number(row.id),
    documentId: Number(row.document_id),
    versionNo: Number(row.version_no),
    versionLabel: opportunityTechnicalDocumentVersionLabel(documentCode, row.version_no),
    creationMethod: row.creation_method,
    basedOnVersionId: numberOrNull(row.based_on_version_id),
    changeSummary: row.change_summary,
    sourceSnapshot: jsonValue(row.source_snapshot, {}),
    createdBy: Number(row.created_by),
    createdByDisplayName: row.created_by_display_name || '',
    createdAt: row.created_at,
    items: [],
    files: []
  };
}

function mapVersionItemRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    versionId: Number(row.version_id),
    equipmentItemId: Number(row.equipment_item_id),
    itemNo: Number(row.item_no_snapshot),
    productCategoryCode: row.product_category_code_snapshot,
    productCategoryName: row.product_category_name_snapshot,
    equipmentName: row.equipment_name_snapshot,
    model: row.model_snapshot || '',
    quantity: Number(row.quantity_snapshot),
    technicalParameters: jsonValue(row.technical_parameters_snapshot, []),
    templateId: Number(row.template_id),
    templateRevisionId: Number(row.template_revision_id),
    templateCode: row.template_code_snapshot,
    templateName: row.template_name_snapshot,
    templateRevisionNo: Number(row.template_revision_no_snapshot),
    renderedContent: jsonValue(row.rendered_content_snapshot, {}),
    sortOrder: Number(row.sort_order)
  };
}

function mapFileRow(row) {
  if (!row) return null;
  const mapped = {
    id: Number(row.id),
    versionId: Number(row.version_id),
    format: row.format,
    originalName: row.original_name,
    mimeType: row.mime_type,
    byteSize: Number(row.byte_size),
    sha256: row.sha256,
    createdAt: row.created_at
  };
  if (row.content !== undefined) mapped.content = row.content;
  return mapped;
}

function mapEventRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    documentId: Number(row.document_id),
    versionId: numberOrNull(row.version_id),
    eventType: row.event_type,
    actorUserId: Number(row.actor_user_id),
    actorDisplayName: row.actor_display_name || '',
    details: jsonValue(row.details, {}),
    createdAt: row.created_at
  };
}

const documentSelect = `
  SELECT
    document.*,
    current_version.id AS current_version_id,
    current_version.created_at AS current_version_created_at,
    creator.display_name AS created_by_display_name,
    updater.display_name AS updated_by_display_name,
    COALESCE(current_items.item_count, 0) AS item_count
  FROM opportunity_technical_documents document
  LEFT JOIN opportunity_technical_document_versions current_version
    ON current_version.document_id = document.id
   AND current_version.version_no = document.current_version_no
  LEFT JOIN LATERAL (
    SELECT count(*)::integer AS item_count
    FROM opportunity_technical_document_version_items item
    WHERE item.version_id = current_version.id
  ) current_items ON true
  LEFT JOIN users creator ON creator.id = document.created_by
  LEFT JOIN users updater ON updater.id = document.updated_by
`;

function serializeFiles(files) {
  return JSON.stringify(files.map((file) => ({
    format: file.format,
    originalName: file.originalName,
    mimeType: file.mimeType,
    contentBase64: file.content.toString('base64'),
    byteSize: file.byteSize,
    sha256: file.sha256
  })));
}

export function createOpportunityTechnicalDocumentRepository(queryTarget) {
  return {
    async listEquipmentByOpportunity(opportunityId, { includeArchived = true } = {}) {
      const result = await queryTarget.query(`
        SELECT *
        FROM opportunity_equipment_items
        WHERE opportunity_id = $1
          ${includeArchived ? '' : 'AND archived_at IS NULL'}
        ORDER BY item_no ASC, id ASC
      `, [opportunityId]);
      return result.rows.map(mapEquipmentRow);
    },

    async findEquipmentItem(opportunityId, equipmentItemId) {
      const result = await queryTarget.query(`
        SELECT *
        FROM opportunity_equipment_items
        WHERE opportunity_id = $1 AND id = $2
        LIMIT 1
      `, [opportunityId, equipmentItemId]);
      return mapEquipmentRow(result.rows[0]);
    },

    async createEquipment(input) {
      const result = await queryTarget.query(`
        WITH lock_guard AS (
          SELECT pg_advisory_xact_lock(610610000000000000::bigint + $1::bigint)
        ), next_item AS (
          SELECT COALESCE(MAX(item_no), 0) + 1 AS item_no
          FROM opportunity_equipment_items, lock_guard
          WHERE opportunity_id = $1
        ), inserted AS (
          INSERT INTO opportunity_equipment_items (
            opportunity_id, item_no, product_category_code, equipment_name, model,
            quantity, technical_parameters, created_by, updated_by
          )
          SELECT $1, next_item.item_no, $2, $3, $4, $5, $6::jsonb, $7, $7
          FROM next_item
          RETURNING *
        ), inserted_event AS (
          INSERT INTO opportunity_equipment_item_events (
            equipment_item_id, event_type, actor_user_id, snapshot
          )
          SELECT id, 'created', $7, to_jsonb(inserted)
          FROM inserted
        )
        SELECT * FROM inserted
      `, [
        input.opportunityId,
        input.productCategoryCode,
        input.equipmentName,
        input.model,
        input.quantity,
        JSON.stringify(input.technicalParameters),
        input.actorUserId
      ]);
      return mapEquipmentRow(result.rows[0]);
    },

    async updateEquipment(input) {
      const result = await queryTarget.query(`
        WITH updated AS (
          UPDATE opportunity_equipment_items
          SET product_category_code = $3,
              equipment_name = $4,
              model = $5,
              quantity = $6,
              technical_parameters = $7::jsonb,
              updated_by = $8,
              updated_at = now()
          WHERE opportunity_id = $1
            AND id = $2
            AND archived_at IS NULL
          RETURNING *
        ), inserted_event AS (
          INSERT INTO opportunity_equipment_item_events (
            equipment_item_id, event_type, actor_user_id, snapshot
          )
          SELECT id, 'updated', $8, to_jsonb(updated)
          FROM updated
        )
        SELECT * FROM updated
      `, [
        input.opportunityId,
        input.equipmentItemId,
        input.productCategoryCode,
        input.equipmentName,
        input.model,
        input.quantity,
        JSON.stringify(input.technicalParameters),
        input.actorUserId
      ]);
      return mapEquipmentRow(result.rows[0]);
    },

    async archiveEquipment({ opportunityId, equipmentItemId, actorUserId }) {
      const result = await queryTarget.query(`
        WITH archived AS (
          UPDATE opportunity_equipment_items
          SET archived_at = now(),
              archived_by = $3,
              updated_by = $3,
              updated_at = now()
          WHERE opportunity_id = $1
            AND id = $2
            AND archived_at IS NULL
          RETURNING *
        ), inserted_event AS (
          INSERT INTO opportunity_equipment_item_events (
            equipment_item_id, event_type, actor_user_id, snapshot
          )
          SELECT id, 'archived', $3, to_jsonb(archived)
          FROM archived
        )
        SELECT * FROM archived
      `, [opportunityId, equipmentItemId, actorUserId]);
      return mapEquipmentRow(result.rows[0]);
    },

    async listDocumentsByOpportunity(opportunityId) {
      const result = await queryTarget.query(`
        ${documentSelect}
        WHERE document.opportunity_id = $1
        ORDER BY document.document_type ASC, document.document_code ASC
      `, [opportunityId]);
      return result.rows.map(mapDocumentRow);
    },

    async findDocumentByIdentity(opportunityId, documentType, primaryEquipmentItemId = null) {
      const result = await queryTarget.query(`
        ${documentSelect}
        WHERE document.opportunity_id = $1
          AND document.document_type = $2
          AND (
            ($2 = 'datasheet' AND document.primary_equipment_item_id = $3)
            OR ($2 <> 'datasheet' AND document.primary_equipment_item_id IS NULL)
          )
        LIMIT 1
      `, [opportunityId, documentType, primaryEquipmentItemId]);
      return mapDocumentRow(result.rows[0]);
    },

    async getDocumentDetail(opportunityId, documentId) {
      const documentResult = await queryTarget.query(`
        ${documentSelect}
        WHERE document.opportunity_id = $1 AND document.id = $2
        LIMIT 1
      `, [opportunityId, documentId]);
      const document = mapDocumentRow(documentResult.rows[0]);
      if (!document) return null;

      const versionsResult = await queryTarget.query(`
        SELECT version.*, creator.display_name AS created_by_display_name
        FROM opportunity_technical_document_versions version
        LEFT JOIN users creator ON creator.id = version.created_by
        WHERE version.document_id = $1
        ORDER BY version.version_no DESC
      `, [documentId]);
      const versionIds = versionsResult.rows.map((row) => Number(row.id));
      const itemsResult = versionIds.length
        ? await queryTarget.query(`
          SELECT *
          FROM opportunity_technical_document_version_items
          WHERE version_id = ANY($1::bigint[])
          ORDER BY version_id DESC, sort_order ASC, id ASC
        `, [versionIds])
        : { rows: [] };
      const filesResult = versionIds.length
        ? await queryTarget.query(`
          SELECT id, version_id, format, original_name, mime_type, byte_size, sha256, created_at
          FROM opportunity_technical_document_files
          WHERE version_id = ANY($1::bigint[])
          ORDER BY version_id DESC, format ASC
        `, [versionIds])
        : { rows: [] };
      const eventsResult = await queryTarget.query(`
        SELECT event.*, actor.display_name AS actor_display_name
        FROM opportunity_technical_document_events event
        LEFT JOIN users actor ON actor.id = event.actor_user_id
        WHERE event.document_id = $1
        ORDER BY event.created_at DESC, event.id DESC
      `, [documentId]);

      const items = itemsResult.rows.map(mapVersionItemRow);
      const files = filesResult.rows.map(mapFileRow);
      document.versions = versionsResult.rows.map((row) => {
        const version = mapVersionRow(row, document.documentCode);
        version.items = items.filter((item) => item.versionId === version.id);
        version.files = files.filter((file) => file.versionId === version.id);
        return version;
      });
      document.events = eventsResult.rows.map(mapEventRow);
      return document;
    },

    async createDocumentVersionOne(input) {
      const result = await queryTarget.query(`
        WITH payload_guard AS (
          SELECT true AS valid
          WHERE jsonb_array_length($9::jsonb) > 0
            AND jsonb_array_length($10::jsonb) = 2
            AND (
              SELECT array_agg(file.format ORDER BY file.format)
              FROM jsonb_to_recordset($10::jsonb) AS file(format text)
            ) = ARRAY['docx', 'pdf']::text[]
        ), lock_guard AS (
          SELECT pg_advisory_xact_lock(610620000000000000::bigint + $1::bigint)
        ), inserted_document AS (
          INSERT INTO opportunity_technical_documents (
            opportunity_id, document_type, primary_equipment_item_id, document_code,
            title, current_version_no, created_by, updated_by
          )
          SELECT $1, $2, $3, $4, $5, 1, $6, $6
          FROM lock_guard
          CROSS JOIN payload_guard
          RETURNING *
        ), inserted_version AS (
          INSERT INTO opportunity_technical_document_versions (
            document_id, version_no, creation_method, change_summary,
            source_snapshot, created_by
          )
          SELECT id, 1, 'generated', $7, $8::jsonb, $6
          FROM inserted_document
          RETURNING *
        ), inserted_items AS (
          INSERT INTO opportunity_technical_document_version_items (
            version_id, equipment_item_id, item_no_snapshot,
            product_category_code_snapshot, product_category_name_snapshot,
            equipment_name_snapshot, model_snapshot, quantity_snapshot,
            technical_parameters_snapshot, template_id, template_revision_id,
            template_code_snapshot, template_name_snapshot,
            template_revision_no_snapshot, rendered_content_snapshot, sort_order
          )
          SELECT inserted_version.id, item."equipmentItemId", item."itemNo",
            item."productCategoryCode", item."productCategoryName",
            item."equipmentName", item.model, item.quantity,
            item."technicalParameters", item."templateId", item."templateRevisionId",
            item."templateCode", item."templateName", item."templateRevisionNo",
            item."renderedContent", item."sortOrder"
          FROM inserted_version
          CROSS JOIN jsonb_to_recordset($9::jsonb) AS item(
            "equipmentItemId" bigint,
            "itemNo" integer,
            "productCategoryCode" text,
            "productCategoryName" text,
            "equipmentName" text,
            model text,
            quantity integer,
            "technicalParameters" jsonb,
            "templateId" bigint,
            "templateRevisionId" bigint,
            "templateCode" text,
            "templateName" text,
            "templateRevisionNo" integer,
            "renderedContent" jsonb,
            "sortOrder" integer
          )
          RETURNING id
        ), inserted_files AS (
          INSERT INTO opportunity_technical_document_files (
            version_id, format, original_name, mime_type, content, byte_size, sha256
          )
          SELECT inserted_version.id, file.format, file."originalName", file."mimeType",
            decode(file."contentBase64", 'base64'), file."byteSize", file.sha256
          FROM inserted_version
          CROSS JOIN jsonb_to_recordset($10::jsonb) AS file(
            format text,
            "originalName" text,
            "mimeType" text,
            "contentBase64" text,
            "byteSize" bigint,
            sha256 text
          )
          RETURNING id
        ), inserted_events AS (
          INSERT INTO opportunity_technical_document_events (
            document_id, version_id, event_type, actor_user_id, details
          )
          SELECT inserted_document.id, NULL, 'created', $6,
            jsonb_build_object('documentCode', inserted_document.document_code)
          FROM inserted_document
          UNION ALL
          SELECT inserted_document.id, inserted_version.id, 'version_created', $6,
            jsonb_build_object('versionNo', 1, 'creationMethod', 'generated')
          FROM inserted_document, inserted_version
        )
        SELECT inserted_document.id AS document_id,
          inserted_version.id AS version_id,
          inserted_version.version_no,
          inserted_document.document_code
        FROM inserted_document, inserted_version
        WHERE (SELECT count(*) FROM inserted_items) > 0
          AND (SELECT count(*) FROM inserted_files) = 2
      `, [
        input.opportunityId,
        input.documentType,
        input.primaryEquipmentItemId,
        input.documentCode,
        input.title,
        input.actorUserId,
        input.changeSummary,
        JSON.stringify(input.sourceSnapshot),
        JSON.stringify(input.versionItems),
        serializeFiles(input.files)
      ]);
      if (!result.rows[0]) return null;
      return {
        documentId: Number(result.rows[0].document_id),
        versionId: Number(result.rows[0].version_id),
        versionNo: Number(result.rows[0].version_no),
        versionLabel: opportunityTechnicalDocumentVersionLabel(result.rows[0].document_code, result.rows[0].version_no)
      };
    },

    async addUploadedVersion(input) {
      const result = await queryTarget.query(`
        WITH payload_guard AS (
          SELECT true AS valid
          WHERE jsonb_array_length($5::jsonb) = 2
            AND (
              SELECT array_agg(file.format ORDER BY file.format)
              FROM jsonb_to_recordset($5::jsonb) AS file(format text)
            ) = ARRAY['docx', 'pdf']::text[]
        ), locked_document AS (
          SELECT document.*, current_version.id AS current_version_id,
            current_version.source_snapshot
          FROM opportunity_technical_documents document
          JOIN opportunity_technical_document_versions current_version
            ON current_version.document_id = document.id
           AND current_version.version_no = document.current_version_no
          WHERE document.opportunity_id = $1
            AND document.id = $2
            AND document.current_version_no = $6
            AND EXISTS (SELECT 1 FROM payload_guard)
          FOR UPDATE OF document
        ), inserted_version AS (
          INSERT INTO opportunity_technical_document_versions (
            document_id, version_no, creation_method, based_on_version_id,
            change_summary, source_snapshot, created_by
          )
          SELECT id, current_version_no + 1, 'uploaded', current_version_id,
            $4, source_snapshot || jsonb_build_object(
              'latestVersionCreation', jsonb_build_object(
                'method', 'uploaded',
                'basedOnVersionId', current_version_id
              )
            ), $3
          FROM locked_document
          RETURNING *
        ), copied_items AS (
          INSERT INTO opportunity_technical_document_version_items (
            version_id, equipment_item_id, item_no_snapshot,
            product_category_code_snapshot, product_category_name_snapshot,
            equipment_name_snapshot, model_snapshot, quantity_snapshot,
            technical_parameters_snapshot, template_id, template_revision_id,
            template_code_snapshot, template_name_snapshot,
            template_revision_no_snapshot, rendered_content_snapshot, sort_order
          )
          SELECT inserted_version.id, source_item.equipment_item_id, source_item.item_no_snapshot,
            source_item.product_category_code_snapshot, source_item.product_category_name_snapshot,
            source_item.equipment_name_snapshot, source_item.model_snapshot, source_item.quantity_snapshot,
            source_item.technical_parameters_snapshot, source_item.template_id, source_item.template_revision_id,
            source_item.template_code_snapshot, source_item.template_name_snapshot,
            source_item.template_revision_no_snapshot, source_item.rendered_content_snapshot, source_item.sort_order
          FROM inserted_version
          JOIN locked_document ON locked_document.id = inserted_version.document_id
          JOIN opportunity_technical_document_version_items source_item
            ON source_item.version_id = locked_document.current_version_id
          RETURNING id
        ), inserted_files AS (
          INSERT INTO opportunity_technical_document_files (
            version_id, format, original_name, mime_type, content, byte_size, sha256
          )
          SELECT inserted_version.id, file.format, file."originalName", file."mimeType",
            decode(file."contentBase64", 'base64'), file."byteSize", file.sha256
          FROM inserted_version
          CROSS JOIN jsonb_to_recordset($5::jsonb) AS file(
            format text,
            "originalName" text,
            "mimeType" text,
            "contentBase64" text,
            "byteSize" bigint,
            sha256 text
          )
          RETURNING id
        ), updated_document AS (
          UPDATE opportunity_technical_documents document
          SET current_version_no = inserted_version.version_no,
              updated_by = $3,
              updated_at = now()
          FROM inserted_version
          WHERE document.id = inserted_version.document_id
            AND (SELECT count(*) FROM copied_items) > 0
            AND (SELECT count(*) FROM inserted_files) = 2
          RETURNING document.*
        ), inserted_event AS (
          INSERT INTO opportunity_technical_document_events (
            document_id, version_id, event_type, actor_user_id, details
          )
          SELECT updated_document.id, inserted_version.id, 'version_created', $3,
            jsonb_build_object(
              'versionNo', inserted_version.version_no,
              'creationMethod', 'uploaded',
              'basedOnVersionId', inserted_version.based_on_version_id
            )
          FROM updated_document, inserted_version
        )
        SELECT updated_document.id AS document_id,
          inserted_version.id AS version_id,
          inserted_version.version_no,
          updated_document.document_code
        FROM updated_document, inserted_version
      `, [
        input.opportunityId,
        input.documentId,
        input.actorUserId,
        input.changeSummary,
        serializeFiles(input.files),
        input.expectedCurrentVersionNo
      ]);
      if (!result.rows[0]) return null;
      return {
        documentId: Number(result.rows[0].document_id),
        versionId: Number(result.rows[0].version_id),
        versionNo: Number(result.rows[0].version_no),
        versionLabel: opportunityTechnicalDocumentVersionLabel(result.rows[0].document_code, result.rows[0].version_no)
      };
    },

    async findFile(opportunityId, documentId, fileId) {
      const result = await queryTarget.query(`
        SELECT file.*
        FROM opportunity_technical_document_files file
        JOIN opportunity_technical_document_versions version ON version.id = file.version_id
        JOIN opportunity_technical_documents document ON document.id = version.document_id
        WHERE document.opportunity_id = $1
          AND document.id = $2
          AND file.id = $3
        LIMIT 1
      `, [opportunityId, documentId, fileId]);
      return mapFileRow(result.rows[0]);
    }
  };
}
