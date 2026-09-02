CREATE TABLE IF NOT EXISTS technical_agreement_templates (
  id bigserial PRIMARY KEY,
  template_code text NOT NULL UNIQUE CHECK (template_code ~ '^[A-Z][A-Z0-9-]{0,31}$'),
  name text NOT NULL CHECK (btrim(name) <> ''),
  product_family text NOT NULL CHECK (btrim(product_family) <> ''),
  product_model text,
  application text,
  language text NOT NULL CHECK (language IN ('en', 'zh', 'bilingual')),
  current_published_revision_id bigint,
  is_active boolean NOT NULL DEFAULT true,
  created_by bigint NOT NULL REFERENCES users(id),
  updated_by bigint NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS technical_agreement_template_revisions (
  id bigserial PRIMARY KEY,
  template_id bigint NOT NULL REFERENCES technical_agreement_templates(id) ON DELETE RESTRICT,
  revision_no integer NOT NULL CHECK (revision_no > 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'review_pending', 'published', 'retired')),
  change_summary text NOT NULL CHECK (btrim(change_summary) <> ''),
  content_schema jsonb NOT NULL DEFAULT '{"schemaVersion":1,"sections":[]}'::jsonb
    CHECK (jsonb_typeof(content_schema) = 'object'),
  created_by bigint NOT NULL REFERENCES users(id),
  submitted_by bigint REFERENCES users(id),
  submitted_at timestamptz,
  published_by bigint REFERENCES users(id),
  published_at timestamptz,
  retired_by bigint REFERENCES users(id),
  retired_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (template_id, revision_no)
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'technical_agreement_templates_current_revision_fk'
  ) THEN
    ALTER TABLE technical_agreement_templates
      ADD CONSTRAINT technical_agreement_templates_current_revision_fk
      FOREIGN KEY (current_published_revision_id)
      REFERENCES technical_agreement_template_revisions(id)
      ON DELETE RESTRICT;
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS technical_agreement_template_open_revision_idx
  ON technical_agreement_template_revisions(template_id)
  WHERE status IN ('draft', 'review_pending');

CREATE UNIQUE INDEX IF NOT EXISTS technical_agreement_template_published_revision_idx
  ON technical_agreement_template_revisions(template_id)
  WHERE status = 'published';

CREATE INDEX IF NOT EXISTS technical_agreement_templates_lookup_idx
  ON technical_agreement_templates(is_active, product_family, product_model, application, language);

CREATE INDEX IF NOT EXISTS technical_agreement_template_revisions_template_idx
  ON technical_agreement_template_revisions(template_id, revision_no DESC);

CREATE UNIQUE INDEX IF NOT EXISTS technical_agreement_template_revisions_identity_idx
  ON technical_agreement_template_revisions(id, template_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'technical_agreement_templates_current_revision_owner_fk'
  ) THEN
    ALTER TABLE technical_agreement_templates
      ADD CONSTRAINT technical_agreement_templates_current_revision_owner_fk
      FOREIGN KEY (current_published_revision_id, id)
      REFERENCES technical_agreement_template_revisions(id, template_id)
      ON DELETE RESTRICT;
  END IF;
END;
$$;

CREATE TABLE IF NOT EXISTS technical_agreement_variable_definitions (
  id bigserial PRIMARY KEY,
  variable_key text NOT NULL UNIQUE CHECK (variable_key ~ '^[a-z][a-z0-9_]{0,63}$'),
  label_en text NOT NULL CHECK (btrim(label_en) <> ''),
  label_zh text NOT NULL CHECK (btrim(label_zh) <> ''),
  data_type text NOT NULL CHECK (data_type IN ('text', 'number', 'integer', 'boolean', 'date')),
  source_field text NOT NULL DEFAULT 'manual' CHECK (source_field IN (
    'manual', 'customer_name', 'contact_name', 'opportunity_title',
    'requirement_summary', 'product_name', 'product_model', 'capacity',
    'medium', 'temperature', 'pressure', 'material', 'motor',
    'voltage_frequency', 'hazardous_area_rating', 'standards',
    'delivery_destination', 'opportunity_owner'
  )),
  is_active boolean NOT NULL DEFAULT true,
  created_by bigint NOT NULL REFERENCES users(id),
  updated_by bigint NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS technical_agreement_revision_variables (
  id bigserial PRIMARY KEY,
  template_revision_id bigint NOT NULL REFERENCES technical_agreement_template_revisions(id) ON DELETE RESTRICT,
  variable_definition_id bigint NOT NULL REFERENCES technical_agreement_variable_definitions(id) ON DELETE RESTRICT,
  variable_key text NOT NULL CHECK (variable_key ~ '^[a-z][a-z0-9_]{0,63}$'),
  label_en text NOT NULL CHECK (btrim(label_en) <> ''),
  label_zh text NOT NULL CHECK (btrim(label_zh) <> ''),
  data_type text NOT NULL CHECK (data_type IN ('text', 'number', 'integer', 'boolean', 'date')),
  source_field text NOT NULL CHECK (source_field IN (
    'manual', 'customer_name', 'contact_name', 'opportunity_title',
    'requirement_summary', 'product_name', 'product_model', 'capacity',
    'medium', 'temperature', 'pressure', 'material', 'motor',
    'voltage_frequency', 'hazardous_area_rating', 'standards',
    'delivery_destination', 'opportunity_owner'
  )),
  is_required boolean NOT NULL DEFAULT false,
  default_value text,
  validation_rules jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(validation_rules) = 'object'),
  sort_order integer NOT NULL DEFAULT 1 CHECK (sort_order > 0),
  created_by bigint NOT NULL REFERENCES users(id),
  updated_by bigint NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (template_revision_id, variable_definition_id)
);

CREATE INDEX IF NOT EXISTS technical_agreement_revision_variables_revision_idx
  ON technical_agreement_revision_variables(template_revision_id, sort_order, id);

CREATE TABLE IF NOT EXISTS technical_agreement_clause_blocks (
  id bigserial PRIMARY KEY,
  clause_code text NOT NULL CHECK (clause_code ~ '^[A-Z][A-Z0-9-]{0,31}$'),
  revision_no integer NOT NULL CHECK (revision_no > 0),
  title text NOT NULL CHECK (btrim(title) <> ''),
  language text NOT NULL CHECK (language IN ('en', 'zh', 'bilingual')),
  product_family text,
  product_model text,
  application text,
  content text NOT NULL CHECK (btrim(content) <> ''),
  condition_schema jsonb NOT NULL DEFAULT '{"all":[]}'::jsonb CHECK (jsonb_typeof(condition_schema) = 'object'),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'review_pending', 'published', 'retired')),
  change_summary text NOT NULL CHECK (btrim(change_summary) <> ''),
  created_by bigint NOT NULL REFERENCES users(id),
  submitted_by bigint REFERENCES users(id),
  submitted_at timestamptz,
  published_by bigint REFERENCES users(id),
  published_at timestamptz,
  retired_by bigint REFERENCES users(id),
  retired_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clause_code, revision_no)
);

CREATE UNIQUE INDEX IF NOT EXISTS technical_agreement_clause_open_revision_idx
  ON technical_agreement_clause_blocks(clause_code)
  WHERE status IN ('draft', 'review_pending');

CREATE UNIQUE INDEX IF NOT EXISTS technical_agreement_clause_published_revision_idx
  ON technical_agreement_clause_blocks(clause_code)
  WHERE status = 'published';

CREATE INDEX IF NOT EXISTS technical_agreement_clause_lookup_idx
  ON technical_agreement_clause_blocks(status, product_family, product_model, application, language, clause_code);

CREATE TABLE IF NOT EXISTS technical_template_events (
  id bigserial PRIMARY KEY,
  template_id bigint REFERENCES technical_agreement_templates(id) ON DELETE RESTRICT,
  entity_type text NOT NULL CHECK (entity_type IN ('template', 'revision', 'variable_definition', 'revision_variable', 'clause')),
  entity_id bigint NOT NULL,
  event_type text NOT NULL,
  from_status text,
  to_status text,
  actor_user_id bigint NOT NULL REFERENCES users(id),
  details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS technical_template_events_template_idx
  ON technical_template_events(template_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS technical_template_events_entity_idx
  ON technical_template_events(entity_type, entity_id, created_at DESC, id DESC);

CREATE OR REPLACE FUNCTION protect_technical_template_revision_content()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.status IN ('review_pending', 'published', 'retired') THEN
    RAISE EXCEPTION 'Submitted or published template revisions cannot be deleted';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IN ('review_pending', 'published', 'retired') AND (
    NEW.template_id IS DISTINCT FROM OLD.template_id OR
    NEW.revision_no IS DISTINCT FROM OLD.revision_no OR
    NEW.change_summary IS DISTINCT FROM OLD.change_summary OR
    NEW.content_schema IS DISTINCT FROM OLD.content_schema OR
    NEW.created_by IS DISTINCT FROM OLD.created_by
  ) THEN
    RAISE EXCEPTION 'Submitted or published template revision content is immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS technical_template_revision_content_guard
  ON technical_agreement_template_revisions;

CREATE TRIGGER technical_template_revision_content_guard
BEFORE UPDATE OR DELETE ON technical_agreement_template_revisions
FOR EACH ROW
EXECUTE FUNCTION protect_technical_template_revision_content();

CREATE OR REPLACE FUNCTION require_draft_technical_template_revision()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  revision_id bigint;
  revision_status text;
BEGIN
  revision_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.template_revision_id ELSE NEW.template_revision_id END;
  SELECT status INTO revision_status
  FROM technical_agreement_template_revisions
  WHERE id = revision_id;
  IF revision_status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'Template variables can only be changed on draft revisions';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS technical_template_revision_variable_guard
  ON technical_agreement_revision_variables;

CREATE TRIGGER technical_template_revision_variable_guard
BEFORE INSERT OR UPDATE OR DELETE ON technical_agreement_revision_variables
FOR EACH ROW
EXECUTE FUNCTION require_draft_technical_template_revision();

CREATE OR REPLACE FUNCTION protect_technical_clause_content()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND OLD.status IN ('review_pending', 'published', 'retired') THEN
    RAISE EXCEPTION 'Submitted or published clauses cannot be deleted';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IN ('review_pending', 'published', 'retired') AND (
    NEW.clause_code IS DISTINCT FROM OLD.clause_code OR
    NEW.revision_no IS DISTINCT FROM OLD.revision_no OR
    NEW.title IS DISTINCT FROM OLD.title OR
    NEW.language IS DISTINCT FROM OLD.language OR
    NEW.product_family IS DISTINCT FROM OLD.product_family OR
    NEW.product_model IS DISTINCT FROM OLD.product_model OR
    NEW.application IS DISTINCT FROM OLD.application OR
    NEW.content IS DISTINCT FROM OLD.content OR
    NEW.condition_schema IS DISTINCT FROM OLD.condition_schema OR
    NEW.change_summary IS DISTINCT FROM OLD.change_summary OR
    NEW.created_by IS DISTINCT FROM OLD.created_by
  ) THEN
    RAISE EXCEPTION 'Submitted or published clause content is immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS technical_clause_content_guard
  ON technical_agreement_clause_blocks;

CREATE TRIGGER technical_clause_content_guard
BEFORE UPDATE OR DELETE ON technical_agreement_clause_blocks
FOR EACH ROW
EXECUTE FUNCTION protect_technical_clause_content();
