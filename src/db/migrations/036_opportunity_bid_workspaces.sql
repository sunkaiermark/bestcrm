CREATE UNIQUE INDEX IF NOT EXISTS opportunity_technical_drafts_open_idx
  ON opportunity_technical_drafts(opportunity_id)
  WHERE status IN ('draft', 'ready', 'pending');

CREATE UNIQUE INDEX IF NOT EXISTS quotation_package_versions_combined_open_idx
  ON quotation_package_versions(opportunity_id)
  WHERE status IN ('draft', 'pending');

CREATE TABLE IF NOT EXISTS opportunity_bid_workspaces (
  id bigserial PRIMARY KEY,
  opportunity_id bigint NOT NULL UNIQUE REFERENCES opportunities(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'in_progress' CHECK (status IN (
    'draft', 'in_progress', 'review_pending', 'rejected',
    'approved', 'sent', 'superseded', 'accepted'
  )),
  language text NOT NULL CHECK (language IN ('en', 'zh', 'bilingual')),
  technical_template_revision_id bigint NOT NULL
    REFERENCES technical_agreement_template_revisions(id) ON DELETE RESTRICT,
  commercial_template_revision_id bigint NOT NULL
    REFERENCES commercial_package_template_revisions(id) ON DELETE RESTRICT,
  output_profile_id bigint NOT NULL REFERENCES bid_output_profiles(id) ON DELETE RESTRICT,
  source_metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(source_metadata) = 'object'),
  created_by bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS opportunity_bid_workspaces_identity_idx
  ON opportunity_bid_workspaces(id, opportunity_id);

CREATE INDEX IF NOT EXISTS opportunity_bid_workspaces_status_idx
  ON opportunity_bid_workspaces(status, updated_at DESC, id DESC);

CREATE OR REPLACE FUNCTION validate_opportunity_bid_workspace_sources()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  technical_status text;
  technical_language text;
  technical_current_revision_id bigint;
  technical_active boolean;
  commercial_status text;
  commercial_language text;
  commercial_current_revision_id bigint;
  commercial_active boolean;
  output_status text;
  output_language text;
BEGIN
  SELECT revision.status, template.language, template.current_published_revision_id, template.is_active
  INTO technical_status, technical_language, technical_current_revision_id, technical_active
  FROM technical_agreement_template_revisions revision
  JOIN technical_agreement_templates template ON template.id = revision.template_id
  WHERE revision.id = NEW.technical_template_revision_id;

  SELECT revision.status, template.language, template.current_published_revision_id, template.is_active
  INTO commercial_status, commercial_language, commercial_current_revision_id, commercial_active
  FROM commercial_package_template_revisions revision
  JOIN commercial_package_templates template ON template.id = revision.template_id
  WHERE revision.id = NEW.commercial_template_revision_id;

  SELECT status, language_mode
  INTO output_status, output_language
  FROM bid_output_profiles
  WHERE id = NEW.output_profile_id;

  IF technical_status IS DISTINCT FROM 'published'
      OR technical_current_revision_id IS DISTINCT FROM NEW.technical_template_revision_id
      OR technical_active IS DISTINCT FROM true
      OR technical_language NOT IN (NEW.language, 'bilingual') THEN
    RAISE EXCEPTION 'Bid workspace requires an active current published technical template revision';
  END IF;
  IF commercial_status IS DISTINCT FROM 'published'
      OR commercial_current_revision_id IS DISTINCT FROM NEW.commercial_template_revision_id
      OR commercial_active IS DISTINCT FROM true
      OR commercial_language NOT IN (NEW.language, 'bilingual') THEN
    RAISE EXCEPTION 'Bid workspace requires an active current published commercial template revision';
  END IF;
  IF output_status IS DISTINCT FROM 'published'
      OR output_language NOT IN (NEW.language, 'bilingual') THEN
    RAISE EXCEPTION 'Bid workspace requires a compatible published output profile';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS opportunity_bid_workspace_source_guard ON opportunity_bid_workspaces;
CREATE TRIGGER opportunity_bid_workspace_source_guard
BEFORE INSERT ON opportunity_bid_workspaces
FOR EACH ROW EXECUTE FUNCTION validate_opportunity_bid_workspace_sources();

CREATE OR REPLACE FUNCTION protect_opportunity_bid_workspace_sources()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Opportunity bid workspaces cannot be deleted';
  END IF;
  IF NEW.opportunity_id IS DISTINCT FROM OLD.opportunity_id
      OR NEW.language IS DISTINCT FROM OLD.language
      OR NEW.technical_template_revision_id IS DISTINCT FROM OLD.technical_template_revision_id
      OR NEW.commercial_template_revision_id IS DISTINCT FROM OLD.commercial_template_revision_id
      OR NEW.output_profile_id IS DISTINCT FROM OLD.output_profile_id
      OR NEW.source_metadata IS DISTINCT FROM OLD.source_metadata
      OR NEW.created_by IS DISTINCT FROM OLD.created_by
      OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Opportunity bid workspace source snapshots are immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS opportunity_bid_workspace_immutable_guard ON opportunity_bid_workspaces;
CREATE TRIGGER opportunity_bid_workspace_immutable_guard
BEFORE UPDATE OR DELETE ON opportunity_bid_workspaces
FOR EACH ROW EXECUTE FUNCTION protect_opportunity_bid_workspace_sources();

CREATE TABLE IF NOT EXISTS opportunity_commercial_drafts (
  id bigserial PRIMARY KEY,
  workspace_id bigint NOT NULL,
  opportunity_id bigint NOT NULL,
  template_revision_id bigint NOT NULL REFERENCES commercial_package_template_revisions(id) ON DELETE RESTRICT,
  source_draft_id bigint REFERENCES opportunity_commercial_drafts(id) ON DELETE RESTRICT,
  draft_revision_no integer NOT NULL CHECK (draft_revision_no > 0),
  formal_version_no integer,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'review_pending', 'rejected', 'approved')),
  language text NOT NULL CHECK (language IN ('en', 'zh', 'bilingual')),
  template_code_snapshot text NOT NULL CHECK (btrim(template_code_snapshot) <> ''),
  template_name_snapshot text NOT NULL CHECK (btrim(template_name_snapshot) <> ''),
  template_revision_no_snapshot integer NOT NULL CHECK (template_revision_no_snapshot > 0),
  content_schema_snapshot jsonb NOT NULL CHECK (jsonb_typeof(content_schema_snapshot) = 'object'),
  variable_schema_snapshot jsonb NOT NULL CHECK (jsonb_typeof(variable_schema_snapshot) = 'array'),
  validation_rules_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(validation_rules_snapshot) = 'object'),
  variable_values jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(variable_values) = 'object'),
  rendered_content jsonb NOT NULL CHECK (jsonb_typeof(rendered_content) = 'object'),
  source_metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(source_metadata) = 'object'),
  validation_issues jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(validation_issues) = 'array'),
  revision_reason text,
  change_summary text,
  created_by bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  submitted_by bigint REFERENCES users(id) ON DELETE RESTRICT,
  submitted_at timestamptz,
  reviewed_by bigint REFERENCES users(id) ON DELETE RESTRICT,
  reviewed_at timestamptz,
  review_comment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (opportunity_id, draft_revision_no),
  CONSTRAINT opportunity_commercial_drafts_workspace_fk
    FOREIGN KEY (workspace_id, opportunity_id)
    REFERENCES opportunity_bid_workspaces(id, opportunity_id) ON DELETE RESTRICT,
  CONSTRAINT opportunity_commercial_drafts_formal_version_check CHECK (
    (status = 'approved' AND formal_version_no > 0)
    OR (status <> 'approved' AND formal_version_no IS NULL)
  ),
  CONSTRAINT opportunity_commercial_drafts_revision_check CHECK (
    source_draft_id IS NULL
    OR (
      revision_reason IS NOT NULL AND btrim(revision_reason) <> ''
      AND change_summary IS NOT NULL AND btrim(change_summary) <> ''
    )
  ),
  CONSTRAINT opportunity_commercial_drafts_submission_check CHECK (
    status = 'draft' OR (submitted_by IS NOT NULL AND submitted_at IS NOT NULL)
  ),
  CONSTRAINT opportunity_commercial_drafts_review_check CHECK (
    status NOT IN ('approved', 'rejected')
    OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS opportunity_commercial_drafts_open_idx
  ON opportunity_commercial_drafts(opportunity_id)
  WHERE status IN ('draft', 'review_pending');

CREATE UNIQUE INDEX IF NOT EXISTS opportunity_commercial_drafts_formal_version_idx
  ON opportunity_commercial_drafts(opportunity_id, formal_version_no)
  WHERE formal_version_no IS NOT NULL;

CREATE INDEX IF NOT EXISTS opportunity_commercial_drafts_workspace_idx
  ON opportunity_commercial_drafts(workspace_id, draft_revision_no DESC, id DESC);

CREATE OR REPLACE FUNCTION validate_opportunity_commercial_draft_sources()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  workspace_row opportunity_bid_workspaces%ROWTYPE;
  template_code text;
  template_name text;
  template_language text;
  template_revision_no integer;
  template_content_schema jsonb;
  template_variable_schema jsonb;
  template_validation_rules jsonb;
  source_row opportunity_commercial_drafts%ROWTYPE;
BEGIN
  SELECT * INTO workspace_row FROM opportunity_bid_workspaces WHERE id = NEW.workspace_id;
  SELECT template.template_code,
         CASE WHEN NEW.language = 'zh' THEN template.name_zh ELSE template.name_en END,
         template.language,
         revision.revision_no,
         revision.content_schema,
         revision.variable_schema,
         revision.validation_rules
  INTO template_code, template_name, template_language, template_revision_no,
       template_content_schema, template_variable_schema, template_validation_rules
  FROM commercial_package_template_revisions revision
  JOIN commercial_package_templates template ON template.id = revision.template_id
  WHERE revision.id = NEW.template_revision_id;

  IF workspace_row.id IS NULL
      OR workspace_row.opportunity_id IS DISTINCT FROM NEW.opportunity_id
      OR workspace_row.commercial_template_revision_id IS DISTINCT FROM NEW.template_revision_id
      OR workspace_row.language IS DISTINCT FROM NEW.language
      OR template_language NOT IN (NEW.language, 'bilingual')
      OR template_code IS DISTINCT FROM NEW.template_code_snapshot
      OR template_name IS DISTINCT FROM NEW.template_name_snapshot
      OR template_revision_no IS DISTINCT FROM NEW.template_revision_no_snapshot
      OR template_content_schema IS DISTINCT FROM NEW.content_schema_snapshot
      OR template_variable_schema IS DISTINCT FROM NEW.variable_schema_snapshot
      OR template_validation_rules IS DISTINCT FROM NEW.validation_rules_snapshot THEN
    RAISE EXCEPTION 'Commercial draft source snapshot does not match its bid workspace';
  END IF;

  IF NEW.status <> 'draft' THEN
    RAISE EXCEPTION 'Commercial draft versions must be created as drafts';
  END IF;

  IF NEW.source_draft_id IS NOT NULL THEN
    SELECT * INTO source_row FROM opportunity_commercial_drafts WHERE id = NEW.source_draft_id;
    IF source_row.id IS NULL
        OR source_row.workspace_id IS DISTINCT FROM NEW.workspace_id
        OR source_row.opportunity_id IS DISTINCT FROM NEW.opportunity_id
        OR source_row.status IS DISTINCT FROM 'rejected' THEN
      RAISE EXCEPTION 'Commercial draft revisions require a rejected source from the same workspace';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS opportunity_commercial_draft_source_guard
  ON opportunity_commercial_drafts;
CREATE TRIGGER opportunity_commercial_draft_source_guard
BEFORE INSERT ON opportunity_commercial_drafts
FOR EACH ROW EXECUTE FUNCTION validate_opportunity_commercial_draft_sources();

CREATE OR REPLACE FUNCTION protect_opportunity_commercial_draft()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Opportunity commercial drafts cannot be deleted';
  END IF;
  IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
      OR NEW.opportunity_id IS DISTINCT FROM OLD.opportunity_id
      OR NEW.template_revision_id IS DISTINCT FROM OLD.template_revision_id
      OR NEW.source_draft_id IS DISTINCT FROM OLD.source_draft_id
      OR NEW.draft_revision_no IS DISTINCT FROM OLD.draft_revision_no
      OR NEW.language IS DISTINCT FROM OLD.language
      OR NEW.template_code_snapshot IS DISTINCT FROM OLD.template_code_snapshot
      OR NEW.template_name_snapshot IS DISTINCT FROM OLD.template_name_snapshot
      OR NEW.template_revision_no_snapshot IS DISTINCT FROM OLD.template_revision_no_snapshot
      OR NEW.content_schema_snapshot IS DISTINCT FROM OLD.content_schema_snapshot
      OR NEW.variable_schema_snapshot IS DISTINCT FROM OLD.variable_schema_snapshot
      OR NEW.validation_rules_snapshot IS DISTINCT FROM OLD.validation_rules_snapshot
      OR NEW.source_metadata IS DISTINCT FROM OLD.source_metadata
      OR NEW.created_by IS DISTINCT FROM OLD.created_by
      OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Opportunity commercial draft source snapshots are immutable';
  END IF;

  IF OLD.status <> 'draft' AND (
    NEW.variable_values IS DISTINCT FROM OLD.variable_values
    OR NEW.rendered_content IS DISTINCT FROM OLD.rendered_content
    OR NEW.validation_issues IS DISTINCT FROM OLD.validation_issues
    OR NEW.revision_reason IS DISTINCT FROM OLD.revision_reason
    OR NEW.change_summary IS DISTINCT FROM OLD.change_summary
  ) THEN
    RAISE EXCEPTION 'Submitted and approved commercial draft content is immutable';
  END IF;

  IF OLD.status IN ('approved', 'rejected') AND (
    NEW.formal_version_no IS DISTINCT FROM OLD.formal_version_no
    OR NEW.submitted_by IS DISTINCT FROM OLD.submitted_by
    OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at
    OR NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by
    OR NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at
    OR NEW.review_comment IS DISTINCT FROM OLD.review_comment
    OR NEW.updated_by IS DISTINCT FROM OLD.updated_by
    OR NEW.updated_at IS DISTINCT FROM OLD.updated_at
  ) THEN
    RAISE EXCEPTION 'Approved and rejected commercial draft versions are immutable';
  END IF;

  IF (OLD.status = 'draft' AND NEW.status NOT IN ('draft', 'review_pending'))
      OR (OLD.status = 'review_pending' AND NEW.status NOT IN ('approved', 'rejected'))
      OR (OLD.status IN ('approved', 'rejected') AND NEW.status IS DISTINCT FROM OLD.status) THEN
    RAISE EXCEPTION 'Commercial draft status transition is invalid';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS opportunity_commercial_draft_immutable_guard
  ON opportunity_commercial_drafts;
CREATE TRIGGER opportunity_commercial_draft_immutable_guard
BEFORE UPDATE OR DELETE ON opportunity_commercial_drafts
FOR EACH ROW EXECUTE FUNCTION protect_opportunity_commercial_draft();

CREATE TABLE IF NOT EXISTS bid_section_changes (
  id bigserial PRIMARY KEY,
  workspace_id bigint NOT NULL REFERENCES opportunity_bid_workspaces(id) ON DELETE RESTRICT,
  package_type text NOT NULL CHECK (package_type IN ('technical', 'commercial', 'complete')),
  technical_draft_id bigint REFERENCES opportunity_technical_drafts(id) ON DELETE RESTRICT,
  commercial_draft_id bigint REFERENCES opportunity_commercial_drafts(id) ON DELETE RESTRICT,
  quotation_package_id bigint REFERENCES quotation_package_versions(id) ON DELETE RESTRICT,
  section_key text NOT NULL CHECK (section_key ~ '^[a-z][a-z0-9_]{0,63}$'),
  modification_status text NOT NULL CHECK (modification_status IN (
    'standard', 'customized', 'project_added', 'omitted', 'needs_review'
  )),
  change_type text NOT NULL CHECK (change_type IN (
    'content_changed', 'added', 'omitted', 'restored', 'reordered', 'source_changed'
  )),
  before_summary text NOT NULL DEFAULT '',
  after_summary text NOT NULL DEFAULT '',
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  actor_user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bid_section_changes_source_check CHECK (
    (package_type = 'technical' AND technical_draft_id IS NOT NULL AND commercial_draft_id IS NULL AND quotation_package_id IS NULL)
    OR (package_type = 'commercial' AND technical_draft_id IS NULL AND commercial_draft_id IS NOT NULL AND quotation_package_id IS NULL)
    OR (package_type = 'complete' AND technical_draft_id IS NULL AND commercial_draft_id IS NULL AND quotation_package_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS bid_section_changes_workspace_idx
  ON bid_section_changes(workspace_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS bid_section_changes_section_idx
  ON bid_section_changes(package_type, section_key, created_at DESC, id DESC);

CREATE OR REPLACE FUNCTION validate_bid_section_change_source()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  workspace_opportunity_id bigint;
  source_opportunity_id bigint;
  source_workspace_id bigint;
BEGIN
  SELECT opportunity_id INTO workspace_opportunity_id
  FROM opportunity_bid_workspaces WHERE id = NEW.workspace_id;

  IF NEW.package_type = 'technical' THEN
    SELECT opportunity_id INTO source_opportunity_id
    FROM opportunity_technical_drafts WHERE id = NEW.technical_draft_id;
  ELSIF NEW.package_type = 'commercial' THEN
    SELECT opportunity_id, workspace_id INTO source_opportunity_id, source_workspace_id
    FROM opportunity_commercial_drafts WHERE id = NEW.commercial_draft_id;
  ELSE
    SELECT opportunity_id INTO source_opportunity_id
    FROM quotation_package_versions WHERE id = NEW.quotation_package_id;
  END IF;

  IF workspace_opportunity_id IS NULL
      OR source_opportunity_id IS DISTINCT FROM workspace_opportunity_id
      OR (NEW.package_type = 'commercial' AND source_workspace_id IS DISTINCT FROM NEW.workspace_id) THEN
    RAISE EXCEPTION 'Bid section change source does not belong to its workspace';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bid_section_change_source_guard ON bid_section_changes;
CREATE TRIGGER bid_section_change_source_guard
BEFORE INSERT ON bid_section_changes
FOR EACH ROW EXECUTE FUNCTION validate_bid_section_change_source();

CREATE OR REPLACE FUNCTION protect_bid_section_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Bid section changes are append-only';
END;
$$;

DROP TRIGGER IF EXISTS bid_section_change_append_only_guard ON bid_section_changes;
CREATE TRIGGER bid_section_change_append_only_guard
BEFORE UPDATE OR DELETE ON bid_section_changes
FOR EACH ROW EXECUTE FUNCTION protect_bid_section_change();
