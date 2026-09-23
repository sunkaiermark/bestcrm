ALTER TABLE opportunity_technical_drafts
  ALTER COLUMN template_revision_id DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS source_kind text NOT NULL DEFAULT 'template',
  ADD COLUMN IF NOT EXISTS deliverable_type text NOT NULL DEFAULT 'technical_agreement',
  ADD COLUMN IF NOT EXISTS uploaded_attachment_id bigint REFERENCES attachments(id) ON DELETE RESTRICT;

ALTER TABLE opportunity_technical_drafts
  ADD CONSTRAINT opportunity_technical_drafts_source_kind_check
    CHECK (source_kind IN ('template', 'uploaded_file')),
  ADD CONSTRAINT opportunity_technical_drafts_deliverable_type_check
    CHECK (deliverable_type IN ('datasheet', 'technical_agreement', 'bidding_document')),
  ADD CONSTRAINT opportunity_technical_drafts_source_file_check
    CHECK (
      (source_kind = 'template' AND template_revision_id IS NOT NULL AND uploaded_attachment_id IS NULL)
      OR (source_kind = 'uploaded_file' AND template_revision_id IS NULL
          AND (status = 'draft' OR uploaded_attachment_id IS NOT NULL))
    );

CREATE UNIQUE INDEX opportunity_technical_drafts_uploaded_attachment_idx
  ON opportunity_technical_drafts(uploaded_attachment_id)
  WHERE uploaded_attachment_id IS NOT NULL;

ALTER TABLE technical_solution_documents
  DROP CONSTRAINT IF EXISTS technical_solution_documents_format_check,
  ADD CONSTRAINT technical_solution_documents_format_check
    CHECK (format IN ('docx', 'pdf', 'uploaded'));

ALTER TABLE opportunity_technical_draft_events
  DROP CONSTRAINT IF EXISTS opportunity_technical_draft_events_event_type_check,
  ADD CONSTRAINT opportunity_technical_draft_events_event_type_check
    CHECK (event_type IN (
      'created', 'variables_updated', 'section_updated', 'clauses_updated',
      'assignment_added', 'assignment_removed', 'readiness_checked',
      'submitted', 'withdrawn', 'approved', 'rejected', 'revision_created',
      'documents_generated', 'file_uploaded', 'file_replaced'
    ));

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
        OR source_row.source_kind IS DISTINCT FROM NEW.source_kind
        OR source_row.deliverable_type IS DISTINCT FROM NEW.deliverable_type
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

  IF NEW.source_kind = 'uploaded_file' THEN
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
      OR NEW.source_kind IS DISTINCT FROM OLD.source_kind
      OR NEW.deliverable_type IS DISTINCT FROM OLD.deliverable_type
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
      NEW.uploaded_attachment_id IS DISTINCT FROM OLD.uploaded_attachment_id
      OR NEW.variable_values IS DISTINCT FROM OLD.variable_values
      OR NEW.selected_clauses IS DISTINCT FROM OLD.selected_clauses
      OR NEW.rendered_content IS DISTINCT FROM OLD.rendered_content
      OR NEW.validation_issues IS DISTINCT FROM OLD.validation_issues
  ) THEN
    RAISE EXCEPTION 'Submitted technical solution content is immutable';
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

CREATE OR REPLACE FUNCTION validate_uploaded_technical_draft_file()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  file_opportunity_id bigint;
  file_category text;
  file_retired_at timestamptz;
BEGIN
  IF NEW.uploaded_attachment_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT opportunity_id, category, retired_at
  INTO file_opportunity_id, file_category, file_retired_at
  FROM attachments
  WHERE id = NEW.uploaded_attachment_id;
  IF file_opportunity_id IS DISTINCT FROM NEW.opportunity_id
      OR file_category IS DISTINCT FROM 'technical_solution'
      OR file_retired_at IS NOT NULL THEN
    RAISE EXCEPTION 'Technical draft file must be an active technical solution attachment for this opportunity';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER opportunity_technical_draft_file_guard
BEFORE INSERT OR UPDATE OF uploaded_attachment_id, status ON opportunity_technical_drafts
FOR EACH ROW
EXECUTE FUNCTION validate_uploaded_technical_draft_file();

CREATE OR REPLACE FUNCTION protect_technical_draft_attachment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
      AND NEW.retired_at IS DISTINCT FROM OLD.retired_at
      AND EXISTS (
        SELECT 1 FROM opportunity_technical_drafts
        WHERE uploaded_attachment_id = OLD.id
      ) THEN
    RAISE EXCEPTION 'A technical draft file cannot be retired while linked to the draft';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER attachments_technical_draft_file_guard
BEFORE UPDATE OF retired_at ON attachments
FOR EACH ROW
EXECUTE FUNCTION protect_technical_draft_attachment();
