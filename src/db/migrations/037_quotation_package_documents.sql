ALTER TABLE quotation_package_versions
  ADD COLUMN IF NOT EXISTS workspace_id bigint,
  ADD COLUMN IF NOT EXISTS commercial_draft_id bigint;

ALTER TABLE quotation_package_versions
  DROP CONSTRAINT IF EXISTS quotation_package_versions_workspace_fk,
  ADD CONSTRAINT quotation_package_versions_workspace_fk
    FOREIGN KEY (workspace_id) REFERENCES opportunity_bid_workspaces(id) ON DELETE RESTRICT,
  DROP CONSTRAINT IF EXISTS quotation_package_versions_commercial_draft_fk,
  ADD CONSTRAINT quotation_package_versions_commercial_draft_fk
    FOREIGN KEY (commercial_draft_id) REFERENCES opportunity_commercial_drafts(id) ON DELETE RESTRICT,
  DROP CONSTRAINT IF EXISTS quotation_package_versions_bid_center_binding_check,
  ADD CONSTRAINT quotation_package_versions_bid_center_binding_check CHECK (
    (workspace_id IS NULL AND commercial_draft_id IS NULL)
    OR (workspace_id IS NOT NULL AND commercial_draft_id IS NOT NULL)
  );

CREATE INDEX IF NOT EXISTS quotation_package_versions_workspace_idx
  ON quotation_package_versions(workspace_id, draft_revision_no DESC, id DESC)
  WHERE workspace_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS quotation_package_versions_commercial_draft_idx
  ON quotation_package_versions(commercial_draft_id)
  WHERE commercial_draft_id IS NOT NULL;

CREATE OR REPLACE FUNCTION validate_bid_center_quotation_package_binding()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  workspace_opportunity_id bigint;
  commercial_workspace_id bigint;
  commercial_opportunity_id bigint;
  commercial_status text;
  commercial_version integer;
BEGIN
  IF NEW.workspace_id IS NULL AND NEW.commercial_draft_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.workspace_id IS NULL OR NEW.commercial_draft_id IS NULL THEN
    RAISE EXCEPTION 'Bid center quotation packages require both workspace and commercial version';
  END IF;

  SELECT opportunity_id INTO workspace_opportunity_id
  FROM opportunity_bid_workspaces WHERE id = NEW.workspace_id;
  SELECT workspace_id, opportunity_id, status, formal_version_no
  INTO commercial_workspace_id, commercial_opportunity_id, commercial_status, commercial_version
  FROM opportunity_commercial_drafts WHERE id = NEW.commercial_draft_id;

  IF workspace_opportunity_id IS DISTINCT FROM NEW.opportunity_id
      OR commercial_workspace_id IS DISTINCT FROM NEW.workspace_id
      OR commercial_opportunity_id IS DISTINCT FROM NEW.opportunity_id
      OR commercial_status IS DISTINCT FROM 'approved'
      OR commercial_version IS NULL THEN
    RAISE EXCEPTION 'Bid center quotation package requires an approved commercial version from the same workspace';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS quotation_package_bid_center_binding_guard ON quotation_package_versions;
CREATE TRIGGER quotation_package_bid_center_binding_guard
BEFORE INSERT OR UPDATE OF opportunity_id, workspace_id, commercial_draft_id ON quotation_package_versions
FOR EACH ROW EXECUTE FUNCTION validate_bid_center_quotation_package_binding();

CREATE TABLE IF NOT EXISTS quotation_package_documents (
  id bigserial PRIMARY KEY,
  quotation_package_version_id bigint NOT NULL
    REFERENCES quotation_package_versions(id) ON DELETE RESTRICT,
  workspace_id bigint NOT NULL REFERENCES opportunity_bid_workspaces(id) ON DELETE RESTRICT,
  technical_solution_version_id bigint NOT NULL
    REFERENCES opportunity_technical_drafts(id) ON DELETE RESTRICT,
  commercial_draft_id bigint NOT NULL
    REFERENCES opportunity_commercial_drafts(id) ON DELETE RESTRICT,
  output_profile_id bigint NOT NULL REFERENCES bid_output_profiles(id) ON DELETE RESTRICT,
  document_type text NOT NULL CHECK (document_type IN (
    'technical_docx', 'technical_pdf', 'commercial_docx', 'commercial_pdf',
    'complete_docx', 'complete_pdf', 'attachments_zip', 'manifest_json'
  )),
  document_no text NOT NULL CHECK (btrim(document_no) <> ''),
  original_name text NOT NULL CHECK (btrim(original_name) <> ''),
  mime_type text NOT NULL,
  content bytea NOT NULL,
  byte_size bigint NOT NULL CHECK (byte_size > 0),
  sha256 char(64) NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  generator_version text NOT NULL CHECK (btrim(generator_version) <> ''),
  generated_by bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  generated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (quotation_package_version_id, document_type),
  CONSTRAINT quotation_package_documents_mime_check CHECK (
    (document_type LIKE '%_docx' AND mime_type = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
    OR (document_type LIKE '%_pdf' AND mime_type = 'application/pdf')
    OR (document_type = 'attachments_zip' AND mime_type = 'application/zip')
    OR (document_type = 'manifest_json' AND mime_type = 'application/json')
  )
);

CREATE INDEX IF NOT EXISTS quotation_package_documents_package_idx
  ON quotation_package_documents(quotation_package_version_id, document_type, id);

CREATE INDEX IF NOT EXISTS quotation_package_documents_workspace_idx
  ON quotation_package_documents(workspace_id, generated_at DESC, id DESC);

CREATE OR REPLACE FUNCTION validate_quotation_package_document()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  package_row quotation_package_versions%ROWTYPE;
  workspace_profile_id bigint;
  technical_version integer;
  commercial_version integer;
BEGIN
  SELECT * INTO package_row
  FROM quotation_package_versions
  WHERE id = NEW.quotation_package_version_id;
  SELECT output_profile_id INTO workspace_profile_id
  FROM opportunity_bid_workspaces
  WHERE id = NEW.workspace_id;
  SELECT formal_version_no INTO technical_version
  FROM opportunity_technical_drafts
  WHERE id = NEW.technical_solution_version_id AND status = 'approved';
  SELECT formal_version_no INTO commercial_version
  FROM opportunity_commercial_drafts
  WHERE id = NEW.commercial_draft_id AND status = 'approved';

  IF package_row.id IS NULL
      OR package_row.status NOT IN ('approved', 'sent', 'superseded', 'accepted')
      OR package_row.version_no IS NULL
      OR package_row.workspace_id IS DISTINCT FROM NEW.workspace_id
      OR package_row.technical_solution_version_id IS DISTINCT FROM NEW.technical_solution_version_id
      OR package_row.commercial_draft_id IS DISTINCT FROM NEW.commercial_draft_id
      OR workspace_profile_id IS DISTINCT FROM NEW.output_profile_id
      OR technical_version IS NULL
      OR commercial_version IS NULL THEN
    RAISE EXCEPTION 'Quotation package documents require matching approved frozen source versions';
  END IF;

  IF octet_length(NEW.content) IS DISTINCT FROM NEW.byte_size THEN
    RAISE EXCEPTION 'Quotation package document size does not match its content';
  END IF;

  IF NEW.document_type LIKE 'technical_%'
      AND NEW.document_no IS DISTINCT FROM ('TS-V' || technical_version::text) THEN
    RAISE EXCEPTION 'Technical package document number does not match its source version';
  ELSIF NEW.document_type LIKE 'commercial_%'
      AND NEW.document_no IS DISTINCT FROM ('CP-V' || commercial_version::text) THEN
    RAISE EXCEPTION 'Commercial package document number does not match its source version';
  ELSIF NEW.document_type IN ('complete_docx', 'complete_pdf', 'attachments_zip', 'manifest_json')
      AND NEW.document_no IS DISTINCT FROM ('QP-V' || package_row.version_no::text) THEN
    RAISE EXCEPTION 'Complete bid document number does not match its package version';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS quotation_package_document_source_guard ON quotation_package_documents;
CREATE TRIGGER quotation_package_document_source_guard
BEFORE INSERT ON quotation_package_documents
FOR EACH ROW EXECUTE FUNCTION validate_quotation_package_document();

CREATE OR REPLACE FUNCTION protect_quotation_package_document()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Generated quotation package documents are immutable';
END;
$$;

DROP TRIGGER IF EXISTS quotation_package_document_immutable_guard ON quotation_package_documents;
CREATE TRIGGER quotation_package_document_immutable_guard
BEFORE UPDATE OR DELETE ON quotation_package_documents
FOR EACH ROW EXECUTE FUNCTION protect_quotation_package_document();

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
