ALTER TABLE technical_agreement_revision_variables
  ADD COLUMN IF NOT EXISTS section_key text NOT NULL DEFAULT 'design_parameters'
    CHECK (section_key ~ '^[a-z][a-z0-9_]{0,63}$');

CREATE TABLE IF NOT EXISTS opportunity_technical_drafts (
  id bigserial PRIMARY KEY,
  opportunity_id bigint NOT NULL REFERENCES opportunities(id) ON DELETE RESTRICT,
  template_revision_id bigint NOT NULL REFERENCES technical_agreement_template_revisions(id) ON DELETE RESTRICT,
  draft_revision_no integer NOT NULL CHECK (draft_revision_no > 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'ready')),
  language text NOT NULL CHECK (language IN ('en', 'zh', 'bilingual')),
  template_code_snapshot text NOT NULL,
  template_name_snapshot text NOT NULL,
  template_revision_no_snapshot integer NOT NULL CHECK (template_revision_no_snapshot > 0),
  content_schema_snapshot jsonb NOT NULL CHECK (jsonb_typeof(content_schema_snapshot) = 'object'),
  variable_schema_snapshot jsonb NOT NULL CHECK (jsonb_typeof(variable_schema_snapshot) = 'array'),
  variable_values jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(variable_values) = 'object'),
  selected_clauses jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(selected_clauses) = 'array'),
  rendered_content jsonb NOT NULL CHECK (jsonb_typeof(rendered_content) = 'object'),
  source_metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(source_metadata) = 'object'),
  validation_issues jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(validation_issues) = 'array'),
  created_by bigint NOT NULL REFERENCES users(id),
  updated_by bigint NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (opportunity_id, draft_revision_no)
);

CREATE INDEX IF NOT EXISTS opportunity_technical_drafts_opportunity_idx
  ON opportunity_technical_drafts(opportunity_id, draft_revision_no DESC, id DESC);

CREATE INDEX IF NOT EXISTS opportunity_technical_drafts_template_revision_idx
  ON opportunity_technical_drafts(template_revision_id, created_at DESC);

CREATE TABLE IF NOT EXISTS opportunity_technical_section_assignments (
  id bigserial PRIMARY KEY,
  technical_draft_id bigint NOT NULL REFERENCES opportunity_technical_drafts(id) ON DELETE RESTRICT,
  section_key text NOT NULL CHECK (section_key ~ '^[a-z][a-z0-9_]{0,63}$'),
  assignee_user_id bigint NOT NULL REFERENCES users(id),
  permission text NOT NULL DEFAULT 'edit' CHECK (permission IN ('edit')),
  due_date date,
  is_active boolean NOT NULL DEFAULT true,
  assigned_by bigint NOT NULL REFERENCES users(id),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  removed_by bigint REFERENCES users(id),
  removed_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS opportunity_technical_section_assignment_active_idx
  ON opportunity_technical_section_assignments(technical_draft_id, section_key, assignee_user_id)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS opportunity_technical_section_assignment_user_idx
  ON opportunity_technical_section_assignments(assignee_user_id, is_active, due_date);

CREATE TABLE IF NOT EXISTS opportunity_technical_draft_events (
  id bigserial PRIMARY KEY,
  technical_draft_id bigint NOT NULL REFERENCES opportunity_technical_drafts(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN (
    'created', 'variables_updated', 'section_updated', 'clauses_updated',
    'assignment_added', 'assignment_removed', 'readiness_checked'
  )),
  section_key text,
  actor_user_id bigint NOT NULL REFERENCES users(id),
  details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS opportunity_technical_draft_events_draft_idx
  ON opportunity_technical_draft_events(technical_draft_id, created_at DESC, id DESC);

CREATE OR REPLACE FUNCTION require_current_published_technical_template_revision()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  revision_status text;
  revision_no_value integer;
  revision_template_id bigint;
  current_revision_id bigint;
  template_active boolean;
BEGIN
  SELECT r.status, r.revision_no, r.template_id,
         t.current_published_revision_id, t.is_active
  INTO revision_status, revision_no_value, revision_template_id,
       current_revision_id, template_active
  FROM technical_agreement_template_revisions r
  JOIN technical_agreement_templates t ON t.id = r.template_id
  WHERE r.id = NEW.template_revision_id;

  IF revision_status IS DISTINCT FROM 'published'
      OR current_revision_id IS DISTINCT FROM NEW.template_revision_id
      OR template_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Technical drafts require the active current published template revision';
  END IF;
  IF NEW.template_revision_no_snapshot IS DISTINCT FROM revision_no_value THEN
    RAISE EXCEPTION 'Template revision snapshot does not match the selected revision';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS opportunity_technical_draft_published_revision_guard
  ON opportunity_technical_drafts;

CREATE TRIGGER opportunity_technical_draft_published_revision_guard
BEFORE INSERT ON opportunity_technical_drafts
FOR EACH ROW
EXECUTE FUNCTION require_current_published_technical_template_revision();

CREATE OR REPLACE FUNCTION protect_opportunity_technical_draft_source_snapshot()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Opportunity technical drafts cannot be deleted';
  END IF;
  IF NEW.opportunity_id IS DISTINCT FROM OLD.opportunity_id
      OR NEW.template_revision_id IS DISTINCT FROM OLD.template_revision_id
      OR NEW.draft_revision_no IS DISTINCT FROM OLD.draft_revision_no
      OR NEW.language IS DISTINCT FROM OLD.language
      OR NEW.template_code_snapshot IS DISTINCT FROM OLD.template_code_snapshot
      OR NEW.template_name_snapshot IS DISTINCT FROM OLD.template_name_snapshot
      OR NEW.template_revision_no_snapshot IS DISTINCT FROM OLD.template_revision_no_snapshot
      OR NEW.content_schema_snapshot IS DISTINCT FROM OLD.content_schema_snapshot
      OR NEW.variable_schema_snapshot IS DISTINCT FROM OLD.variable_schema_snapshot
      OR NEW.source_metadata IS DISTINCT FROM OLD.source_metadata
      OR NEW.created_by IS DISTINCT FROM OLD.created_by
      OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Opportunity technical draft source snapshots are immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS opportunity_technical_draft_source_snapshot_guard
  ON opportunity_technical_drafts;

CREATE TRIGGER opportunity_technical_draft_source_snapshot_guard
BEFORE UPDATE OR DELETE ON opportunity_technical_drafts
FOR EACH ROW
EXECUTE FUNCTION protect_opportunity_technical_draft_source_snapshot();

CREATE OR REPLACE FUNCTION protect_opportunity_technical_draft_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Opportunity technical draft events are append-only';
END;
$$;

DROP TRIGGER IF EXISTS opportunity_technical_draft_event_guard
  ON opportunity_technical_draft_events;

CREATE TRIGGER opportunity_technical_draft_event_guard
BEFORE UPDATE OR DELETE ON opportunity_technical_draft_events
FOR EACH ROW
EXECUTE FUNCTION protect_opportunity_technical_draft_event();
