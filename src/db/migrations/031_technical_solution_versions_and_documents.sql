ALTER TABLE opportunity_technical_drafts
  DROP CONSTRAINT IF EXISTS opportunity_technical_drafts_status_check;

ALTER TABLE opportunity_technical_drafts
  ADD CONSTRAINT opportunity_technical_drafts_status_check
    CHECK (status IN ('draft', 'ready', 'pending', 'approved', 'rejected')),
  ADD COLUMN IF NOT EXISTS source_draft_id bigint,
  ADD COLUMN IF NOT EXISTS formal_version_no integer,
  ADD COLUMN IF NOT EXISTS submitted_by bigint,
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_by bigint,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS review_comment text;

ALTER TABLE opportunity_technical_drafts
  DROP CONSTRAINT IF EXISTS opportunity_technical_drafts_source_draft_fk,
  ADD CONSTRAINT opportunity_technical_drafts_source_draft_fk
    FOREIGN KEY (source_draft_id)
    REFERENCES opportunity_technical_drafts(id) ON DELETE RESTRICT,
  DROP CONSTRAINT IF EXISTS opportunity_technical_drafts_submitted_by_fk,
  ADD CONSTRAINT opportunity_technical_drafts_submitted_by_fk
    FOREIGN KEY (submitted_by)
    REFERENCES users(id),
  DROP CONSTRAINT IF EXISTS opportunity_technical_drafts_reviewed_by_fk,
  ADD CONSTRAINT opportunity_technical_drafts_reviewed_by_fk
    FOREIGN KEY (reviewed_by)
    REFERENCES users(id);

ALTER TABLE opportunity_technical_drafts
  DROP CONSTRAINT IF EXISTS opportunity_technical_drafts_formal_version_check,
  ADD CONSTRAINT opportunity_technical_drafts_formal_version_check
    CHECK (
      (status = 'approved' AND formal_version_no > 0)
      OR (status <> 'approved' AND formal_version_no IS NULL)
    ),
  DROP CONSTRAINT IF EXISTS opportunity_technical_drafts_submission_metadata_check,
  ADD CONSTRAINT opportunity_technical_drafts_submission_metadata_check
    CHECK (status <> 'pending' OR (submitted_by IS NOT NULL AND submitted_at IS NOT NULL)),
  DROP CONSTRAINT IF EXISTS opportunity_technical_drafts_review_metadata_check,
  ADD CONSTRAINT opportunity_technical_drafts_review_metadata_check
    CHECK (
      status NOT IN ('approved', 'rejected')
      OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
    );

CREATE UNIQUE INDEX IF NOT EXISTS opportunity_technical_drafts_formal_version_idx
  ON opportunity_technical_drafts(opportunity_id, formal_version_no)
  WHERE formal_version_no IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS opportunity_technical_drafts_pending_idx
  ON opportunity_technical_drafts(opportunity_id)
  WHERE status = 'pending';

ALTER TABLE technical_solutions
  ADD COLUMN IF NOT EXISTS opportunity_technical_draft_id bigint;

ALTER TABLE technical_solutions
  DROP CONSTRAINT IF EXISTS technical_solutions_technical_draft_fk,
  ADD CONSTRAINT technical_solutions_technical_draft_fk
    FOREIGN KEY (opportunity_technical_draft_id)
    REFERENCES opportunity_technical_drafts(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX IF NOT EXISTS technical_solutions_technical_draft_idx
  ON technical_solutions(opportunity_technical_draft_id)
  WHERE opportunity_technical_draft_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS technical_solution_documents (
  id bigserial PRIMARY KEY,
  technical_draft_id bigint NOT NULL REFERENCES opportunity_technical_drafts(id) ON DELETE RESTRICT,
  document_no text NOT NULL,
  format text NOT NULL CHECK (format IN ('docx', 'pdf')),
  original_name text NOT NULL,
  mime_type text NOT NULL,
  content bytea NOT NULL,
  byte_size bigint NOT NULL CHECK (byte_size > 0),
  sha256 char(64) NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  generated_by bigint NOT NULL REFERENCES users(id),
  generated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (technical_draft_id, format)
);

CREATE INDEX IF NOT EXISTS technical_solution_documents_draft_idx
  ON technical_solution_documents(technical_draft_id, format);

CREATE OR REPLACE FUNCTION require_approved_technical_solution_document()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  draft_status text;
  draft_version integer;
BEGIN
  SELECT status, formal_version_no
  INTO draft_status, draft_version
  FROM opportunity_technical_drafts
  WHERE id = NEW.technical_draft_id;

  IF draft_status IS DISTINCT FROM 'approved'
      OR draft_version IS NULL
      OR NEW.document_no IS DISTINCT FROM ('TS-V' || draft_version::text) THEN
    RAISE EXCEPTION 'Technical solution documents require an approved immutable version';
  END IF;
  IF octet_length(NEW.content) IS DISTINCT FROM NEW.byte_size THEN
    RAISE EXCEPTION 'Technical solution document size does not match its content';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS technical_solution_document_approved_guard
  ON technical_solution_documents;

CREATE TRIGGER technical_solution_document_approved_guard
BEFORE INSERT ON technical_solution_documents
FOR EACH ROW
EXECUTE FUNCTION require_approved_technical_solution_document();

CREATE OR REPLACE FUNCTION protect_technical_solution_document()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Approved technical solution documents are immutable';
END;
$$;

DROP TRIGGER IF EXISTS technical_solution_document_immutable_guard
  ON technical_solution_documents;

CREATE TRIGGER technical_solution_document_immutable_guard
BEFORE UPDATE OR DELETE ON technical_solution_documents
FOR EACH ROW
EXECUTE FUNCTION protect_technical_solution_document();

CREATE OR REPLACE FUNCTION require_current_published_technical_template_revision()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  revision_status text;
  revision_no_value integer;
  current_revision_id bigint;
  template_active boolean;
  source_row opportunity_technical_drafts%ROWTYPE;
BEGIN
  IF NEW.source_draft_id IS NOT NULL THEN
    SELECT * INTO source_row
    FROM opportunity_technical_drafts
    WHERE id = NEW.source_draft_id;

    IF source_row.id IS NULL
        OR source_row.status IS DISTINCT FROM 'rejected'
        OR source_row.opportunity_id IS DISTINCT FROM NEW.opportunity_id
        OR source_row.template_revision_id IS DISTINCT FROM NEW.template_revision_id
        OR source_row.language IS DISTINCT FROM NEW.language
        OR source_row.template_code_snapshot IS DISTINCT FROM NEW.template_code_snapshot
        OR source_row.template_name_snapshot IS DISTINCT FROM NEW.template_name_snapshot
        OR source_row.template_revision_no_snapshot IS DISTINCT FROM NEW.template_revision_no_snapshot
        OR source_row.content_schema_snapshot IS DISTINCT FROM NEW.content_schema_snapshot
        OR source_row.variable_schema_snapshot IS DISTINCT FROM NEW.variable_schema_snapshot
        OR source_row.source_metadata IS DISTINCT FROM NEW.source_metadata THEN
      RAISE EXCEPTION 'Revision drafts must preserve the rejected source snapshot';
    END IF;
    RETURN NEW;
  END IF;

  SELECT r.status, r.revision_no, t.current_published_revision_id, t.is_active
  INTO revision_status, revision_no_value, current_revision_id, template_active
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
      OR NEW.source_draft_id IS DISTINCT FROM OLD.source_draft_id
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
  IF OLD.status NOT IN ('draft', 'ready') AND (
      NEW.variable_values IS DISTINCT FROM OLD.variable_values
      OR NEW.selected_clauses IS DISTINCT FROM OLD.selected_clauses
      OR NEW.rendered_content IS DISTINCT FROM OLD.rendered_content
      OR NEW.validation_issues IS DISTINCT FROM OLD.validation_issues
  ) THEN
    RAISE EXCEPTION 'Submitted and approved technical solution content is immutable';
  END IF;
  IF OLD.status = 'approved' AND (
      NEW.status IS DISTINCT FROM OLD.status
      OR NEW.formal_version_no IS DISTINCT FROM OLD.formal_version_no
      OR NEW.submitted_by IS DISTINCT FROM OLD.submitted_by
      OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at
      OR NEW.reviewed_by IS DISTINCT FROM OLD.reviewed_by
      OR NEW.reviewed_at IS DISTINCT FROM OLD.reviewed_at
      OR NEW.review_comment IS DISTINCT FROM OLD.review_comment
      OR NEW.updated_by IS DISTINCT FROM OLD.updated_by
      OR NEW.updated_at IS DISTINCT FROM OLD.updated_at
  ) THEN
    RAISE EXCEPTION 'Approved technical solution versions are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION protect_submitted_technical_section_assignment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  protected_draft_id bigint;
  draft_status text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    protected_draft_id := OLD.technical_draft_id;
  ELSE
    protected_draft_id := NEW.technical_draft_id;
  END IF;
  SELECT status INTO draft_status
  FROM opportunity_technical_drafts
  WHERE id = protected_draft_id;
  IF draft_status NOT IN ('draft', 'ready') THEN
    RAISE EXCEPTION 'Submitted technical solution assignments are immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS opportunity_technical_assignment_status_guard
  ON opportunity_technical_section_assignments;

CREATE TRIGGER opportunity_technical_assignment_status_guard
BEFORE INSERT OR UPDATE OR DELETE ON opportunity_technical_section_assignments
FOR EACH ROW
EXECUTE FUNCTION protect_submitted_technical_section_assignment();

ALTER TABLE opportunity_technical_draft_events
  DROP CONSTRAINT IF EXISTS opportunity_technical_draft_events_event_type_check;

ALTER TABLE opportunity_technical_draft_events
  ADD CONSTRAINT opportunity_technical_draft_events_event_type_check
    CHECK (event_type IN (
      'created', 'variables_updated', 'section_updated', 'clauses_updated',
      'assignment_added', 'assignment_removed', 'readiness_checked',
      'submitted', 'withdrawn', 'approved', 'rejected', 'revision_created',
      'documents_generated'
    ));
