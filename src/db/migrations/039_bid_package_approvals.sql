ALTER TABLE bid_package_events
  ADD COLUMN IF NOT EXISTS quotation_package_id bigint
    REFERENCES quotation_package_versions(id) ON DELETE RESTRICT;

ALTER TABLE bid_package_events
  DROP CONSTRAINT IF EXISTS bid_package_events_package_type_check,
  DROP CONSTRAINT IF EXISTS bid_package_events_event_type_check,
  DROP CONSTRAINT IF EXISTS bid_package_events_source_check,
  ADD CONSTRAINT bid_package_events_package_type_check
    CHECK (package_type IN ('technical', 'commercial', 'complete')),
  ADD CONSTRAINT bid_package_events_event_type_check CHECK (event_type IN (
    'variables_saved', 'section_saved', 'section_added', 'section_omitted',
    'section_restored', 'sections_reordered', 'content_selected',
    'attachment_added', 'attachment_removed', 'library_suggestion_created',
    'assignment_added', 'assignment_removed', 'completeness_checked',
    'submitted', 'approved', 'rejected', 'revision_created', 'complete_draft_created'
  )),
  ADD CONSTRAINT bid_package_events_source_check CHECK (
    (package_type = 'technical' AND technical_draft_id IS NOT NULL
      AND commercial_draft_id IS NULL AND quotation_package_id IS NULL)
    OR (package_type = 'commercial' AND technical_draft_id IS NULL
      AND commercial_draft_id IS NOT NULL AND quotation_package_id IS NULL)
    OR (package_type = 'complete' AND technical_draft_id IS NULL
      AND commercial_draft_id IS NULL AND quotation_package_id IS NOT NULL)
  );

DROP TRIGGER IF EXISTS bid_package_event_source_guard ON bid_package_events;

CREATE OR REPLACE FUNCTION validate_bid_package_event_source()
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
    SELECT opportunity_id, workspace_id INTO source_opportunity_id, source_workspace_id
    FROM quotation_package_versions WHERE id = NEW.quotation_package_id;
  END IF;

  IF workspace_opportunity_id IS NULL
      OR source_opportunity_id IS DISTINCT FROM workspace_opportunity_id
      OR (NEW.package_type IN ('commercial', 'complete')
        AND source_workspace_id IS DISTINCT FROM NEW.workspace_id) THEN
    RAISE EXCEPTION 'Bid package event source does not belong to its workspace';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER bid_package_event_source_guard
BEFORE INSERT ON bid_package_events
FOR EACH ROW EXECUTE FUNCTION validate_bid_package_event_source();

CREATE TABLE IF NOT EXISTS bid_package_completeness_checks (
  id bigserial PRIMARY KEY,
  workspace_id bigint NOT NULL REFERENCES opportunity_bid_workspaces(id) ON DELETE RESTRICT,
  package_type text NOT NULL CHECK (package_type IN ('technical', 'commercial', 'complete')),
  technical_draft_id bigint REFERENCES opportunity_technical_drafts(id) ON DELETE RESTRICT,
  commercial_draft_id bigint REFERENCES opportunity_commercial_drafts(id) ON DELETE RESTRICT,
  quotation_package_id bigint REFERENCES quotation_package_versions(id) ON DELETE RESTRICT,
  passed boolean NOT NULL,
  issues jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(issues) = 'array'),
  snapshot_sha256 char(64) NOT NULL CHECK (snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  checked_by bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  checked_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bid_package_completeness_checks_source_check CHECK (
    (package_type = 'technical' AND technical_draft_id IS NOT NULL
      AND commercial_draft_id IS NULL AND quotation_package_id IS NULL)
    OR (package_type = 'commercial' AND technical_draft_id IS NULL
      AND commercial_draft_id IS NOT NULL AND quotation_package_id IS NULL)
    OR (package_type = 'complete' AND technical_draft_id IS NULL
      AND commercial_draft_id IS NULL AND quotation_package_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS bid_package_completeness_checks_source_idx
  ON bid_package_completeness_checks(
    workspace_id, package_type, technical_draft_id, commercial_draft_id,
    quotation_package_id, checked_at DESC, id DESC
  );

CREATE OR REPLACE FUNCTION validate_bid_package_completeness_source()
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
    SELECT opportunity_id, workspace_id INTO source_opportunity_id, source_workspace_id
    FROM quotation_package_versions WHERE id = NEW.quotation_package_id;
  END IF;

  IF workspace_opportunity_id IS NULL
      OR source_opportunity_id IS DISTINCT FROM workspace_opportunity_id
      OR (NEW.package_type IN ('commercial', 'complete')
        AND source_workspace_id IS DISTINCT FROM NEW.workspace_id) THEN
    RAISE EXCEPTION 'Bid completeness source does not belong to its workspace';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bid_package_completeness_source_guard
  ON bid_package_completeness_checks;
CREATE TRIGGER bid_package_completeness_source_guard
BEFORE INSERT ON bid_package_completeness_checks
FOR EACH ROW EXECUTE FUNCTION validate_bid_package_completeness_source();

CREATE OR REPLACE FUNCTION protect_bid_package_completeness_check()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Bid package completeness checks are append-only';
END;
$$;

DROP TRIGGER IF EXISTS bid_package_completeness_append_only_guard
  ON bid_package_completeness_checks;
CREATE TRIGGER bid_package_completeness_append_only_guard
BEFORE UPDATE OR DELETE ON bid_package_completeness_checks
FOR EACH ROW EXECUTE FUNCTION protect_bid_package_completeness_check();

CREATE OR REPLACE FUNCTION protect_bid_package_attachment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  source_status text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Bid package attachments cannot be deleted';
  END IF;
  IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
      OR NEW.package_type IS DISTINCT FROM OLD.package_type
      OR NEW.technical_draft_id IS DISTINCT FROM OLD.technical_draft_id
      OR NEW.commercial_draft_id IS DISTINCT FROM OLD.commercial_draft_id
      OR NEW.section_key IS DISTINCT FROM OLD.section_key
      OR NEW.original_name IS DISTINCT FROM OLD.original_name
      OR NEW.stored_path IS DISTINCT FROM OLD.stored_path
      OR NEW.mime_type IS DISTINCT FROM OLD.mime_type
      OR NEW.byte_size IS DISTINCT FROM OLD.byte_size
      OR NEW.sha256 IS DISTINCT FROM OLD.sha256
      OR NEW.uploaded_by IS DISTINCT FROM OLD.uploaded_by
      OR NEW.uploaded_at IS DISTINCT FROM OLD.uploaded_at
      OR (OLD.removed_at IS NOT NULL AND (
        NEW.removed_by IS DISTINCT FROM OLD.removed_by
        OR NEW.removed_at IS DISTINCT FROM OLD.removed_at
      )) THEN
    RAISE EXCEPTION 'Bid package attachment records are immutable except for one soft removal';
  END IF;

  IF OLD.removed_at IS NULL AND NEW.removed_at IS NOT NULL THEN
    IF OLD.package_type = 'technical' THEN
      SELECT status INTO source_status FROM opportunity_technical_drafts
      WHERE id = OLD.technical_draft_id;
      IF source_status NOT IN ('draft', 'ready') THEN
        RAISE EXCEPTION 'Submitted technical package attachments are immutable';
      END IF;
    ELSE
      SELECT status INTO source_status FROM opportunity_commercial_drafts
      WHERE id = OLD.commercial_draft_id;
      IF source_status <> 'draft' THEN
        RAISE EXCEPTION 'Submitted commercial package attachments are immutable';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

ALTER TABLE quotation_package_versions
  ADD COLUMN IF NOT EXISTS review_source_package_id bigint
    REFERENCES quotation_package_versions(id) ON DELETE RESTRICT;

ALTER TABLE opportunity_technical_drafts
  DROP CONSTRAINT IF EXISTS opportunity_technical_drafts_reviewer_separation_check,
  ADD CONSTRAINT opportunity_technical_drafts_reviewer_separation_check
    CHECK (reviewed_by IS NULL OR submitted_by IS NULL OR reviewed_by <> submitted_by) NOT VALID;

ALTER TABLE opportunity_commercial_drafts
  DROP CONSTRAINT IF EXISTS opportunity_commercial_drafts_reviewer_separation_check,
  ADD CONSTRAINT opportunity_commercial_drafts_reviewer_separation_check
    CHECK (reviewed_by IS NULL OR submitted_by IS NULL OR reviewed_by <> submitted_by) NOT VALID;

ALTER TABLE quotation_package_versions
  DROP CONSTRAINT IF EXISTS quotation_package_versions_reviewer_separation_check,
  ADD CONSTRAINT quotation_package_versions_reviewer_separation_check
    CHECK (reviewed_by IS NULL OR submitted_by IS NULL OR reviewed_by <> submitted_by) NOT VALID;

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
    SELECT opportunity_id, workspace_id INTO source_opportunity_id, source_workspace_id
    FROM quotation_package_versions WHERE id = NEW.quotation_package_id;
  END IF;
  IF workspace_opportunity_id IS NULL
      OR source_opportunity_id IS DISTINCT FROM workspace_opportunity_id
      OR (NEW.package_type IN ('commercial', 'complete')
        AND source_workspace_id IS DISTINCT FROM NEW.workspace_id) THEN
    RAISE EXCEPTION 'Bid section change source does not belong to its workspace';
  END IF;
  RETURN NEW;
END;
$$;

CREATE INDEX IF NOT EXISTS quotation_package_versions_review_source_idx
  ON quotation_package_versions(review_source_package_id)
  WHERE review_source_package_id IS NOT NULL;

CREATE OR REPLACE FUNCTION validate_bid_center_review_source()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  source_row quotation_package_versions%ROWTYPE;
BEGIN
  IF NEW.review_source_package_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT * INTO source_row FROM quotation_package_versions
  WHERE id = NEW.review_source_package_id;
  IF source_row.id IS NULL
      OR source_row.status IS DISTINCT FROM 'rejected'
      OR source_row.opportunity_id IS DISTINCT FROM NEW.opportunity_id
      OR source_row.workspace_id IS DISTINCT FROM NEW.workspace_id
      OR NEW.workspace_id IS NULL
      OR NEW.status IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'Complete bid review revisions require a rejected source from the same workspace';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS quotation_package_review_source_guard
  ON quotation_package_versions;
CREATE TRIGGER quotation_package_review_source_guard
BEFORE INSERT OR UPDATE OF review_source_package_id, opportunity_id, workspace_id
ON quotation_package_versions
FOR EACH ROW EXECUTE FUNCTION validate_bid_center_review_source();

CREATE OR REPLACE FUNCTION protect_quotation_package_version()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Quotation package versions cannot be deleted';
  END IF;
  IF OLD.status IN ('sent', 'superseded', 'accepted') THEN
    IF NOT (
      OLD.status = 'sent'
      AND NEW.status IN ('superseded', 'accepted')
      AND NEW.opportunity_id IS NOT DISTINCT FROM OLD.opportunity_id
      AND NEW.source_package_id IS NOT DISTINCT FROM OLD.source_package_id
      AND NEW.review_source_package_id IS NOT DISTINCT FROM OLD.review_source_package_id
      AND NEW.draft_revision_no IS NOT DISTINCT FROM OLD.draft_revision_no
      AND NEW.version_no IS NOT DISTINCT FROM OLD.version_no
      AND NEW.technical_solution_version_id IS NOT DISTINCT FROM OLD.technical_solution_version_id
      AND NEW.commercial_quote_id IS NOT DISTINCT FROM OLD.commercial_quote_id
      AND NEW.workspace_id IS NOT DISTINCT FROM OLD.workspace_id
      AND NEW.commercial_draft_id IS NOT DISTINCT FROM OLD.commercial_draft_id
      AND NEW.currency IS NOT DISTINCT FROM OLD.currency
      AND NEW.total_price IS NOT DISTINCT FROM OLD.total_price
      AND NEW.delivery_period IS NOT DISTINCT FROM OLD.delivery_period
      AND NEW.payment_terms IS NOT DISTINCT FROM OLD.payment_terms
      AND NEW.valid_until IS NOT DISTINCT FROM OLD.valid_until
      AND NEW.commercial_line_items IS NOT DISTINCT FROM OLD.commercial_line_items
      AND NEW.inclusions IS NOT DISTINCT FROM OLD.inclusions
      AND NEW.exclusions IS NOT DISTINCT FROM OLD.exclusions
      AND NEW.technical_assumptions IS NOT DISTINCT FROM OLD.technical_assumptions
      AND NEW.revision_reason IS NOT DISTINCT FROM OLD.revision_reason
      AND NEW.change_summary IS NOT DISTINCT FROM OLD.change_summary
      AND NEW.created_by IS NOT DISTINCT FROM OLD.created_by
      AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at
      AND NEW.submitted_by IS NOT DISTINCT FROM OLD.submitted_by
      AND NEW.submitted_at IS NOT DISTINCT FROM OLD.submitted_at
      AND NEW.reviewed_by IS NOT DISTINCT FROM OLD.reviewed_by
      AND NEW.reviewed_at IS NOT DISTINCT FROM OLD.reviewed_at
      AND NEW.review_comment IS NOT DISTINCT FROM OLD.review_comment
      AND NEW.sent_by IS NOT DISTINCT FROM OLD.sent_by
      AND NEW.sent_at IS NOT DISTINCT FROM OLD.sent_at
      AND NEW.sent_email_message_id IS NOT DISTINCT FROM OLD.sent_email_message_id
    ) THEN
      RAISE EXCEPTION 'Sent, superseded, and accepted quotation packages are immutable';
    END IF;
    IF OLD.status = 'sent' AND NEW.status = 'accepted'
        AND (NEW.superseded_at IS DISTINCT FROM OLD.superseded_at
          OR NEW.accepted_by IS NULL OR NEW.accepted_at IS NULL) THEN
      RAISE EXCEPTION 'Accepted quotation package transition metadata is invalid';
    END IF;
    IF OLD.status = 'sent' AND NEW.status = 'superseded'
        AND (NEW.accepted_by IS DISTINCT FROM OLD.accepted_by
          OR NEW.accepted_at IS DISTINCT FROM OLD.accepted_at
          OR NEW.superseded_at IS NULL) THEN
      RAISE EXCEPTION 'Superseded quotation package transition metadata is invalid';
    END IF;
    RETURN NEW;
  END IF;
  IF (OLD.status = 'draft' AND NEW.status NOT IN ('draft', 'pending'))
      OR (OLD.status = 'pending' AND NEW.status NOT IN ('approved', 'rejected'))
      OR (OLD.status = 'approved' AND NEW.status <> 'sent')
      OR OLD.status = 'rejected' THEN
    RAISE EXCEPTION 'Quotation package status transition is invalid';
  END IF;
  IF OLD.status <> 'draft' AND (
      NEW.opportunity_id IS DISTINCT FROM OLD.opportunity_id
      OR NEW.source_package_id IS DISTINCT FROM OLD.source_package_id
      OR NEW.review_source_package_id IS DISTINCT FROM OLD.review_source_package_id
      OR NEW.draft_revision_no IS DISTINCT FROM OLD.draft_revision_no
      OR NEW.technical_solution_version_id IS DISTINCT FROM OLD.technical_solution_version_id
      OR NEW.commercial_quote_id IS DISTINCT FROM OLD.commercial_quote_id
      OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
      OR NEW.commercial_draft_id IS DISTINCT FROM OLD.commercial_draft_id
      OR NEW.currency IS DISTINCT FROM OLD.currency
      OR NEW.total_price IS DISTINCT FROM OLD.total_price
      OR NEW.delivery_period IS DISTINCT FROM OLD.delivery_period
      OR NEW.payment_terms IS DISTINCT FROM OLD.payment_terms
      OR NEW.valid_until IS DISTINCT FROM OLD.valid_until
      OR NEW.commercial_line_items IS DISTINCT FROM OLD.commercial_line_items
      OR NEW.inclusions IS DISTINCT FROM OLD.inclusions
      OR NEW.exclusions IS DISTINCT FROM OLD.exclusions
      OR NEW.technical_assumptions IS DISTINCT FROM OLD.technical_assumptions
      OR NEW.revision_reason IS DISTINCT FROM OLD.revision_reason
      OR NEW.change_summary IS DISTINCT FROM OLD.change_summary
  ) THEN
    RAISE EXCEPTION 'Submitted quotation package content is immutable';
  END IF;
  RETURN NEW;
END;
$$;
