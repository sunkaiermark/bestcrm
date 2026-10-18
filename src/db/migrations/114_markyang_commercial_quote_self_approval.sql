-- MarkYang is the controlled exception for formal commercial-quotation self-review.
-- The account must remain active and be assigned as the opportunity's Commercial Manager.
-- Every other user still needs an active Commercial Manager role and a separate reviewer.

CREATE OR REPLACE FUNCTION bestcrm_guard_sales_commercial_quotation_version()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  source_row record;
  manager_row record;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Formal quotation versions cannot be deleted';
  END IF;

  SELECT
    opportunity.commercial_manager_id,
    manager.username,
    manager.is_active,
    EXISTS (
      SELECT 1
      FROM user_roles assignment
      JOIN roles role ON role.id = assignment.role_id
      WHERE assignment.user_id = opportunity.commercial_manager_id
        AND role.code = 'commercial_manager'
        AND role.is_active = true
    ) AS has_commercial_manager_role
  INTO manager_row
  FROM opportunities opportunity
  LEFT JOIN users manager ON manager.id = opportunity.commercial_manager_id
  WHERE opportunity.id = NEW.opportunity_id;

  IF TG_OP = 'INSERT' THEN
    IF NOT FOUND OR manager_row.commercial_manager_id IS NULL
      OR manager_row.is_active IS DISTINCT FROM true
      OR (
        manager_row.has_commercial_manager_role IS DISTINCT FROM true
        AND manager_row.username IS DISTINCT FROM 'MarkYang'
      ) THEN
      RAISE EXCEPTION 'An active assigned Commercial Manager is required for formal quotation review';
    END IF;
    IF NEW.status <> 'pending' THEN
      RAISE EXCEPTION 'Formal quotation must start as pending review';
    END IF;
    IF manager_row.commercial_manager_id = NEW.submitted_by
      AND manager_row.username IS DISTINCT FROM 'MarkYang' THEN
      RAISE EXCEPTION 'Commercial quotation self-approval is prohibited';
    END IF;
    SELECT draft.opportunity_id, draft.draft_revision_no, draft.source_technical_draft_id,
      draft.source_attachment_id, draft.source_sha256, technical.status AS technical_status,
      technical.draft_revision_no AS technical_revision_no,
      attachment.sha256 AS attachment_sha256, attachment.retired_at
    INTO source_row
    FROM sales_commercial_quotation_drafts draft
    JOIN opportunity_technical_drafts technical ON technical.id = draft.source_technical_draft_id
    JOIN attachments attachment ON attachment.id = draft.source_attachment_id
    WHERE draft.id = NEW.draft_id;
    IF NOT FOUND OR source_row.opportunity_id IS DISTINCT FROM NEW.opportunity_id
      OR source_row.draft_revision_no IS DISTINCT FROM NEW.draft_revision_no
      OR source_row.source_technical_draft_id IS DISTINCT FROM NEW.source_technical_draft_id
      OR source_row.source_attachment_id IS DISTINCT FROM NEW.source_attachment_id
      OR source_row.source_sha256 IS DISTINCT FROM NEW.source_sha256
      OR source_row.technical_status <> 'approved'
      OR source_row.attachment_sha256 IS DISTINCT FROM NEW.source_sha256
      OR source_row.retired_at IS NOT NULL
      OR EXISTS (
        SELECT 1 FROM opportunity_technical_drafts newer
        WHERE newer.opportunity_id = NEW.opportunity_id
          AND newer.source_kind = 'uploaded_file'
          AND newer.status IN ('ready', 'pending', 'approved')
          AND newer.draft_revision_no > source_row.technical_revision_no
      ) THEN
      RAISE EXCEPTION 'Formal quotation requires the exact approved technical source and current draft revision';
    END IF;
    RETURN NEW;
  END IF;

  IF (NEW.opportunity_id, NEW.draft_id, NEW.draft_revision_no, NEW.version_no,
      NEW.quotation_no, NEW.snapshot, NEW.source_technical_draft_id,
      NEW.source_attachment_id, NEW.source_sha256, NEW.submitted_by, NEW.submitted_at)
    IS DISTINCT FROM
     (OLD.opportunity_id, OLD.draft_id, OLD.draft_revision_no, OLD.version_no,
      OLD.quotation_no, OLD.snapshot, OLD.source_technical_draft_id,
      OLD.source_attachment_id, OLD.source_sha256, OLD.submitted_by, OLD.submitted_at) THEN
    RAISE EXCEPTION 'Submitted quotation snapshot is immutable';
  END IF;

  IF OLD.status = 'pending' AND NEW.status IN ('approved', 'rejected') THEN
    IF manager_row.commercial_manager_id IS NULL
      OR manager_row.is_active IS DISTINCT FROM true
      OR (
        manager_row.has_commercial_manager_role IS DISTINCT FROM true
        AND manager_row.username IS DISTINCT FROM 'MarkYang'
      ) THEN
      RAISE EXCEPTION 'An active assigned Commercial Manager is required for formal quotation review';
    END IF;
    IF NEW.reviewed_by IS NULL OR NEW.reviewed_at IS NULL
       OR NEW.signed_by IS NOT NULL OR NEW.pdf_stored_path IS NOT NULL THEN
      RAISE EXCEPTION 'Invalid commercial review';
    END IF;
    IF NEW.reviewed_by IS DISTINCT FROM manager_row.commercial_manager_id THEN
      RAISE EXCEPTION 'The assigned Commercial Manager must review the quotation';
    END IF;
    IF NEW.reviewed_by = OLD.submitted_by
      AND manager_row.username IS DISTINCT FROM 'MarkYang' THEN
      RAISE EXCEPTION 'Commercial quotation self-approval is prohibited';
    END IF;
  ELSIF OLD.status = 'approved' AND NEW.status = 'signed' THEN
    IF (NEW.reviewed_by, NEW.reviewed_at, NEW.review_comment)
       IS DISTINCT FROM (OLD.reviewed_by, OLD.reviewed_at, OLD.review_comment)
       OR NEW.signed_by IS NULL OR NEW.signed_at IS NULL
       OR NEW.pdf_stored_path IS NULL OR NEW.pdf_sha256 IS NULL THEN
      RAISE EXCEPTION 'Invalid personal quotation signing';
    END IF;
    IF (SELECT username FROM users WHERE id = NEW.signed_by) IS DISTINCT FROM 'MarkYang' THEN
      RAISE EXCEPTION 'Only MarkYang may personally issue a formal quotation';
    END IF;
  ELSE
    RAISE EXCEPTION 'Formal quotation status transition is invalid';
  END IF;
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION bestcrm_guard_sales_commercial_quotation_version() IS
  'Guards immutable formal quotations. Active MarkYang may self-review when assigned; all other users require a separate active Commercial Manager.';
