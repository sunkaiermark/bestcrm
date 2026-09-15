ALTER TABLE technical_agreement_templates
  ADD COLUMN IF NOT EXISTS document_type text;

UPDATE technical_agreement_templates
SET document_type = 'technical_agreement'
WHERE document_type IS NULL;

ALTER TABLE technical_agreement_templates
  ALTER COLUMN document_type SET DEFAULT 'technical_agreement',
  ALTER COLUMN document_type SET NOT NULL;

ALTER TABLE technical_agreement_templates
  ADD COLUMN IF NOT EXISTS product_category_code text;

DO $$
BEGIN
  ALTER TABLE technical_agreement_templates
    ADD CONSTRAINT technical_agreement_templates_document_type_check
    CHECK (document_type IN ('datasheet', 'technical_agreement', 'bidding_document'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

DO $$
BEGIN
  ALTER TABLE technical_agreement_templates
    ADD CONSTRAINT technical_agreement_templates_product_category_check
    CHECK (product_category_code IS NULL OR product_category_code IN (
      'mixer',
      'rubber_cutter',
      'grinding_mill',
      'steam_tube_dryer',
      'tube_bundle_dryer',
      'sk3000e_kneader',
      'sk3000s_kneader',
      'sk3000f_kneader',
      'wiped_film_evaporator',
      'skid_equipment'
    ));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS technical_templates_active_document_category_idx
  ON technical_agreement_templates(document_type, product_category_code)
  WHERE is_active = true AND product_category_code IS NOT NULL;

CREATE OR REPLACE FUNCTION bestcrm_protect_technical_template_classification()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF OLD.product_category_code IS NOT NULL AND (
    NEW.product_category_code IS DISTINCT FROM OLD.product_category_code
    OR NEW.document_type IS DISTINCT FROM OLD.document_type
  ) THEN
    RAISE EXCEPTION 'Technical template document type and product category are immutable after classification'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS technical_templates_classification_immutable_trigger
  ON technical_agreement_templates;
CREATE TRIGGER technical_templates_classification_immutable_trigger
BEFORE UPDATE OF document_type, product_category_code
ON technical_agreement_templates
FOR EACH ROW EXECUTE FUNCTION bestcrm_protect_technical_template_classification();

CREATE TABLE IF NOT EXISTS opportunity_equipment_items (
  id bigserial PRIMARY KEY,
  opportunity_id bigint NOT NULL REFERENCES opportunities(id) ON DELETE RESTRICT,
  item_no integer NOT NULL CHECK (item_no > 0),
  product_category_code text NOT NULL CHECK (product_category_code IN (
    'mixer',
    'rubber_cutter',
    'grinding_mill',
    'steam_tube_dryer',
    'tube_bundle_dryer',
    'sk3000e_kneader',
    'sk3000s_kneader',
    'sk3000f_kneader',
    'wiped_film_evaporator',
    'skid_equipment'
  )),
  equipment_name text NOT NULL CHECK (btrim(equipment_name) <> ''),
  model text,
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  technical_parameters jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(technical_parameters) = 'array'),
  archived_at timestamptz,
  archived_by bigint REFERENCES users(id) ON DELETE RESTRICT,
  created_by bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (opportunity_id, item_no),
  CHECK ((archived_at IS NULL AND archived_by IS NULL) OR (archived_at IS NOT NULL AND archived_by IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS opportunity_equipment_items_opportunity_idx
  ON opportunity_equipment_items(opportunity_id, archived_at, item_no);

CREATE TABLE IF NOT EXISTS opportunity_equipment_item_events (
  id bigserial PRIMARY KEY,
  equipment_item_id bigint NOT NULL REFERENCES opportunity_equipment_items(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN ('created', 'updated', 'archived')),
  actor_user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS opportunity_equipment_item_events_item_idx
  ON opportunity_equipment_item_events(equipment_item_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS opportunity_technical_documents (
  id bigserial PRIMARY KEY,
  opportunity_id bigint NOT NULL REFERENCES opportunities(id) ON DELETE RESTRICT,
  document_type text NOT NULL CHECK (document_type IN ('datasheet', 'technical_agreement', 'bidding_document')),
  primary_equipment_item_id bigint REFERENCES opportunity_equipment_items(id) ON DELETE RESTRICT,
  document_code text NOT NULL UNIQUE CHECK (btrim(document_code) <> ''),
  title text NOT NULL CHECK (btrim(title) <> ''),
  current_version_no integer NOT NULL DEFAULT 0 CHECK (current_version_no >= 0),
  created_by bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (document_type = 'datasheet' AND primary_equipment_item_id IS NOT NULL)
    OR (document_type <> 'datasheet' AND primary_equipment_item_id IS NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS opportunity_technical_documents_composite_type_idx
  ON opportunity_technical_documents(opportunity_id, document_type)
  WHERE document_type IN ('technical_agreement', 'bidding_document');

CREATE UNIQUE INDEX IF NOT EXISTS opportunity_technical_documents_datasheet_item_idx
  ON opportunity_technical_documents(opportunity_id, primary_equipment_item_id)
  WHERE document_type = 'datasheet';

CREATE TABLE IF NOT EXISTS opportunity_technical_document_versions (
  id bigserial PRIMARY KEY,
  document_id bigint NOT NULL REFERENCES opportunity_technical_documents(id) ON DELETE RESTRICT,
  version_no integer NOT NULL CHECK (version_no > 0),
  creation_method text NOT NULL CHECK (creation_method IN ('generated', 'uploaded')),
  based_on_version_id bigint REFERENCES opportunity_technical_document_versions(id) ON DELETE RESTRICT,
  change_summary text NOT NULL CHECK (btrim(change_summary) <> ''),
  source_snapshot jsonb NOT NULL CHECK (jsonb_typeof(source_snapshot) = 'object'),
  created_by bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, version_no)
);

CREATE INDEX IF NOT EXISTS opportunity_technical_document_versions_document_idx
  ON opportunity_technical_document_versions(document_id, version_no DESC);

CREATE TABLE IF NOT EXISTS opportunity_technical_document_version_items (
  id bigserial PRIMARY KEY,
  version_id bigint NOT NULL REFERENCES opportunity_technical_document_versions(id) ON DELETE RESTRICT,
  equipment_item_id bigint NOT NULL REFERENCES opportunity_equipment_items(id) ON DELETE RESTRICT,
  item_no_snapshot integer NOT NULL CHECK (item_no_snapshot > 0),
  product_category_code_snapshot text NOT NULL,
  product_category_name_snapshot text NOT NULL,
  equipment_name_snapshot text NOT NULL,
  model_snapshot text,
  quantity_snapshot integer NOT NULL CHECK (quantity_snapshot > 0),
  technical_parameters_snapshot jsonb NOT NULL CHECK (jsonb_typeof(technical_parameters_snapshot) = 'array'),
  template_id bigint NOT NULL REFERENCES technical_agreement_templates(id) ON DELETE RESTRICT,
  template_revision_id bigint NOT NULL REFERENCES technical_agreement_template_revisions(id) ON DELETE RESTRICT,
  template_code_snapshot text NOT NULL,
  template_name_snapshot text NOT NULL,
  template_revision_no_snapshot integer NOT NULL CHECK (template_revision_no_snapshot > 0),
  rendered_content_snapshot jsonb NOT NULL CHECK (jsonb_typeof(rendered_content_snapshot) = 'object'),
  sort_order integer NOT NULL CHECK (sort_order > 0),
  UNIQUE (version_id, equipment_item_id),
  UNIQUE (version_id, sort_order)
);

CREATE INDEX IF NOT EXISTS opportunity_technical_document_version_items_version_idx
  ON opportunity_technical_document_version_items(version_id, sort_order, id);

CREATE TABLE IF NOT EXISTS opportunity_technical_document_files (
  id bigserial PRIMARY KEY,
  version_id bigint NOT NULL REFERENCES opportunity_technical_document_versions(id) ON DELETE RESTRICT,
  format text NOT NULL CHECK (format IN ('docx', 'pdf')),
  original_name text NOT NULL CHECK (btrim(original_name) <> ''),
  mime_type text NOT NULL CHECK (btrim(mime_type) <> ''),
  content bytea NOT NULL,
  byte_size bigint NOT NULL CHECK (byte_size > 0),
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (version_id, format),
  CHECK (octet_length(content) = byte_size)
);

CREATE INDEX IF NOT EXISTS opportunity_technical_document_files_version_idx
  ON opportunity_technical_document_files(version_id, format);

CREATE TABLE IF NOT EXISTS opportunity_technical_document_events (
  id bigserial PRIMARY KEY,
  document_id bigint NOT NULL REFERENCES opportunity_technical_documents(id) ON DELETE RESTRICT,
  version_id bigint REFERENCES opportunity_technical_document_versions(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN ('created', 'version_created')),
  actor_user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (
    (event_type = 'created' AND version_id IS NULL)
    OR (event_type = 'version_created' AND version_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS opportunity_technical_document_events_document_idx
  ON opportunity_technical_document_events(document_id, created_at DESC, id DESC);

CREATE OR REPLACE FUNCTION bestcrm_validate_technical_document_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.primary_equipment_item_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM opportunity_equipment_items equipment
    WHERE equipment.id = NEW.primary_equipment_item_id
      AND equipment.opportunity_id = NEW.opportunity_id
  ) THEN
    RAISE EXCEPTION 'Primary equipment must belong to the technical document Opportunity' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS opportunity_technical_documents_identity_trigger ON opportunity_technical_documents;
CREATE TRIGGER opportunity_technical_documents_identity_trigger
BEFORE INSERT OR UPDATE OF opportunity_id, primary_equipment_item_id
ON opportunity_technical_documents
FOR EACH ROW EXECUTE FUNCTION bestcrm_validate_technical_document_identity();

CREATE OR REPLACE FUNCTION bestcrm_protect_technical_document_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.opportunity_id IS DISTINCT FROM OLD.opportunity_id
      OR NEW.document_type IS DISTINCT FROM OLD.document_type
      OR NEW.primary_equipment_item_id IS DISTINCT FROM OLD.primary_equipment_item_id
      OR NEW.document_code IS DISTINCT FROM OLD.document_code
      OR NEW.title IS DISTINCT FROM OLD.title
      OR NEW.created_by IS DISTINCT FROM OLD.created_by
      OR NEW.created_at IS DISTINCT FROM OLD.created_at
      OR NEW.current_version_no IS DISTINCT FROM OLD.current_version_no + 1 THEN
    RAISE EXCEPTION 'Technical document identity is immutable and versions must advance one at a time'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS opportunity_technical_documents_identity_immutable_trigger
  ON opportunity_technical_documents;
CREATE TRIGGER opportunity_technical_documents_identity_immutable_trigger
BEFORE UPDATE ON opportunity_technical_documents
FOR EACH ROW EXECUTE FUNCTION bestcrm_protect_technical_document_identity();

CREATE OR REPLACE FUNCTION bestcrm_validate_technical_document_version_item()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  document_opportunity_id bigint;
  document_type_value text;
  document_primary_equipment_id bigint;
  version_creation_method text;
  based_on_version_value bigint;
  equipment_opportunity_id bigint;
  equipment_item_no integer;
  equipment_category text;
  equipment_name_value text;
  equipment_model_value text;
  equipment_quantity_value integer;
  equipment_parameters_value jsonb;
  equipment_archived_at timestamptz;
  template_document_type text;
  template_category text;
  template_code_value text;
  template_name_value text;
  template_current_revision_id bigint;
  template_active boolean;
  template_revision_status text;
  template_revision_no_value integer;
BEGIN
  SELECT document.opportunity_id, document.document_type, document.primary_equipment_item_id,
    version.creation_method, version.based_on_version_id
  INTO document_opportunity_id, document_type_value, document_primary_equipment_id,
    version_creation_method, based_on_version_value
  FROM opportunity_technical_document_versions version
  JOIN opportunity_technical_documents document ON document.id = version.document_id
  WHERE version.id = NEW.version_id;

  SELECT equipment.opportunity_id, equipment.item_no, equipment.product_category_code,
    equipment.equipment_name, equipment.model, equipment.quantity, equipment.technical_parameters,
    equipment.archived_at
  INTO equipment_opportunity_id, equipment_item_no, equipment_category,
    equipment_name_value, equipment_model_value, equipment_quantity_value, equipment_parameters_value,
    equipment_archived_at
  FROM opportunity_equipment_items equipment
  WHERE equipment.id = NEW.equipment_item_id;

  IF document_opportunity_id IS NULL
      OR equipment_opportunity_id IS DISTINCT FROM document_opportunity_id THEN
    RAISE EXCEPTION 'Equipment snapshot does not match the technical document Opportunity' USING ERRCODE = 'P0001';
  END IF;

  IF version_creation_method = 'uploaded' THEN
    IF based_on_version_value IS NULL OR NOT EXISTS (
      SELECT 1
      FROM opportunity_technical_document_version_items source_item
      WHERE source_item.version_id = based_on_version_value
        AND source_item.equipment_item_id = NEW.equipment_item_id
        AND (to_jsonb(source_item) - 'id' - 'version_id')
          = (to_jsonb(NEW) - 'id' - 'version_id')
    ) THEN
      RAISE EXCEPTION 'Uploaded versions must preserve the complete prior equipment and template snapshot'
        USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;

  IF version_creation_method IS DISTINCT FROM 'generated'
      OR (document_type_value = 'datasheet' AND document_primary_equipment_id IS DISTINCT FROM NEW.equipment_item_id)
      OR equipment_item_no IS DISTINCT FROM NEW.item_no_snapshot
      OR equipment_category IS DISTINCT FROM NEW.product_category_code_snapshot
      OR equipment_name_value IS DISTINCT FROM NEW.equipment_name_snapshot
      OR COALESCE(equipment_model_value, '') IS DISTINCT FROM COALESCE(NEW.model_snapshot, '')
      OR equipment_quantity_value IS DISTINCT FROM NEW.quantity_snapshot
      OR equipment_parameters_value IS DISTINCT FROM NEW.technical_parameters_snapshot
      OR equipment_archived_at IS NOT NULL
      OR NEW.product_category_name_snapshot IS DISTINCT FROM (CASE equipment_category
        WHEN 'mixer' THEN '搅拌机'
        WHEN 'rubber_cutter' THEN '切胶机'
        WHEN 'grinding_mill' THEN '研磨机'
        WHEN 'steam_tube_dryer' THEN '蒸汽管式干燥机'
        WHEN 'tube_bundle_dryer' THEN '管束干燥机'
        WHEN 'sk3000e_kneader' THEN 'SK3000E 捏合机'
        WHEN 'sk3000s_kneader' THEN 'SK3000S 捏合机'
        WHEN 'sk3000f_kneader' THEN 'SK3000F 捏合机'
        WHEN 'wiped_film_evaporator' THEN '刮膜蒸发器'
        WHEN 'skid_equipment' THEN '撬装设备'
      END) THEN
    RAISE EXCEPTION 'Generated equipment snapshot does not match the current equipment record' USING ERRCODE = 'P0001';
  END IF;

  SELECT template.document_type, template.product_category_code,
    template.template_code, template.name, template.current_published_revision_id,
    template.is_active, revision.status, revision.revision_no
  INTO template_document_type, template_category,
    template_code_value, template_name_value, template_current_revision_id,
    template_active, template_revision_status, template_revision_no_value
  FROM technical_agreement_template_revisions revision
  JOIN technical_agreement_templates template ON template.id = revision.template_id
  WHERE revision.id = NEW.template_revision_id
    AND revision.template_id = NEW.template_id;

  IF template_document_type IS NULL
      OR template_document_type IS DISTINCT FROM document_type_value
      OR template_category IS DISTINCT FROM NEW.product_category_code_snapshot
      OR template_active IS DISTINCT FROM true
      OR template_revision_status IS DISTINCT FROM 'published'
      OR template_current_revision_id IS DISTINCT FROM NEW.template_revision_id
      OR template_code_value IS DISTINCT FROM NEW.template_code_snapshot
      OR template_name_value IS DISTINCT FROM NEW.template_name_snapshot
      OR template_revision_no_value IS DISTINCT FROM NEW.template_revision_no_snapshot THEN
    RAISE EXCEPTION 'Template snapshot does not match the document type and product category' USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS opportunity_technical_document_version_items_source_trigger
  ON opportunity_technical_document_version_items;
CREATE CONSTRAINT TRIGGER opportunity_technical_document_version_items_source_trigger
AFTER INSERT ON opportunity_technical_document_version_items
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION bestcrm_validate_technical_document_version_item();

CREATE OR REPLACE FUNCTION bestcrm_validate_technical_document_version_completeness()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  document_type_value text;
  document_current_version_no integer;
  latest_version_no integer;
  item_count integer;
  docx_count integer;
  pdf_count integer;
  expected_source_version_id bigint;
BEGIN
  SELECT document.document_type, document.current_version_no
  INTO document_type_value, document_current_version_no
  FROM opportunity_technical_documents document
  WHERE document.id = NEW.document_id;

  SELECT count(*)::integer
  INTO item_count
  FROM opportunity_technical_document_version_items item
  WHERE item.version_id = NEW.id;

  SELECT
    count(*) FILTER (WHERE file.format = 'docx')::integer,
    count(*) FILTER (WHERE file.format = 'pdf')::integer
  INTO docx_count, pdf_count
  FROM opportunity_technical_document_files file
  WHERE file.version_id = NEW.id;

  SELECT max(version.version_no)
  INTO latest_version_no
  FROM opportunity_technical_document_versions version
  WHERE version.document_id = NEW.document_id;

  IF document_type_value IS NULL
      OR document_current_version_no IS DISTINCT FROM latest_version_no THEN
    RAISE EXCEPTION 'Technical document current version is incomplete or inconsistent' USING ERRCODE = 'P0001';
  END IF;

  IF (document_type_value = 'datasheet' AND item_count <> 1)
      OR (document_type_value <> 'datasheet' AND item_count < 1) THEN
    RAISE EXCEPTION 'Technical document version has an invalid equipment snapshot count' USING ERRCODE = 'P0001';
  END IF;

  IF docx_count <> 1 OR pdf_count <> 1 THEN
    RAISE EXCEPTION 'Technical document version requires one DOCX and one PDF file' USING ERRCODE = 'P0001';
  END IF;

  IF NEW.version_no = 1 THEN
    IF NEW.creation_method IS DISTINCT FROM 'generated' OR NEW.based_on_version_id IS NOT NULL THEN
      RAISE EXCEPTION 'Technical document V1 must be generated without a prior version' USING ERRCODE = 'P0001';
    END IF;
  ELSE
    SELECT version.id
    INTO expected_source_version_id
    FROM opportunity_technical_document_versions version
    WHERE version.document_id = NEW.document_id
      AND version.version_no = NEW.version_no - 1;

    IF NEW.creation_method IS DISTINCT FROM 'uploaded'
        OR NEW.based_on_version_id IS DISTINCT FROM expected_source_version_id THEN
      RAISE EXCEPTION 'Uploaded technical document versions must follow the immediately prior version' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS opportunity_technical_document_versions_complete_trigger
  ON opportunity_technical_document_versions;
CREATE CONSTRAINT TRIGGER opportunity_technical_document_versions_complete_trigger
AFTER INSERT ON opportunity_technical_document_versions
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION bestcrm_validate_technical_document_version_completeness();

CREATE OR REPLACE FUNCTION bestcrm_validate_technical_document_event_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.version_id IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM opportunity_technical_document_versions version
    WHERE version.id = NEW.version_id
      AND version.document_id = NEW.document_id
  ) THEN
    RAISE EXCEPTION 'Technical document event version does not belong to its document'
      USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS opportunity_technical_document_events_identity_trigger
  ON opportunity_technical_document_events;
CREATE CONSTRAINT TRIGGER opportunity_technical_document_events_identity_trigger
AFTER INSERT ON opportunity_technical_document_events
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION bestcrm_validate_technical_document_event_identity();

CREATE OR REPLACE FUNCTION bestcrm_reject_technical_document_history_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% history is immutable', TG_TABLE_NAME USING ERRCODE = 'P0001';
END;
$$;

DROP TRIGGER IF EXISTS opportunity_equipment_item_events_immutable_trigger ON opportunity_equipment_item_events;
CREATE TRIGGER opportunity_equipment_item_events_immutable_trigger
BEFORE UPDATE OR DELETE ON opportunity_equipment_item_events
FOR EACH ROW EXECUTE FUNCTION bestcrm_reject_technical_document_history_mutation();

DROP TRIGGER IF EXISTS opportunity_technical_document_versions_immutable_trigger ON opportunity_technical_document_versions;
CREATE TRIGGER opportunity_technical_document_versions_immutable_trigger
BEFORE UPDATE OR DELETE ON opportunity_technical_document_versions
FOR EACH ROW EXECUTE FUNCTION bestcrm_reject_technical_document_history_mutation();

DROP TRIGGER IF EXISTS opportunity_technical_document_version_items_immutable_trigger ON opportunity_technical_document_version_items;
CREATE TRIGGER opportunity_technical_document_version_items_immutable_trigger
BEFORE UPDATE OR DELETE ON opportunity_technical_document_version_items
FOR EACH ROW EXECUTE FUNCTION bestcrm_reject_technical_document_history_mutation();

DROP TRIGGER IF EXISTS opportunity_technical_document_files_immutable_trigger ON opportunity_technical_document_files;
CREATE TRIGGER opportunity_technical_document_files_immutable_trigger
BEFORE UPDATE OR DELETE ON opportunity_technical_document_files
FOR EACH ROW EXECUTE FUNCTION bestcrm_reject_technical_document_history_mutation();

DROP TRIGGER IF EXISTS opportunity_technical_document_events_immutable_trigger ON opportunity_technical_document_events;
CREATE TRIGGER opportunity_technical_document_events_immutable_trigger
BEFORE UPDATE OR DELETE ON opportunity_technical_document_events
FOR EACH ROW EXECUTE FUNCTION bestcrm_reject_technical_document_history_mutation();

CREATE OR REPLACE FUNCTION bestcrm_reject_technical_document_hard_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% records cannot be hard-deleted', TG_TABLE_NAME USING ERRCODE = 'P0001';
END;
$$;

DROP TRIGGER IF EXISTS opportunity_equipment_items_no_delete_trigger ON opportunity_equipment_items;
CREATE TRIGGER opportunity_equipment_items_no_delete_trigger
BEFORE DELETE ON opportunity_equipment_items
FOR EACH ROW EXECUTE FUNCTION bestcrm_reject_technical_document_hard_delete();

DROP TRIGGER IF EXISTS opportunity_technical_documents_no_delete_trigger ON opportunity_technical_documents;
CREATE TRIGGER opportunity_technical_documents_no_delete_trigger
BEFORE DELETE ON opportunity_technical_documents
FOR EACH ROW EXECUTE FUNCTION bestcrm_reject_technical_document_hard_delete();
