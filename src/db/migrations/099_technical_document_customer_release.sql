-- Technical approval is not permission to send a file to a customer.
-- Existing documents have no row here and therefore remain internal-only.
CREATE TABLE technical_document_customer_releases (
  id bigserial PRIMARY KEY,
  technical_document_id bigint NOT NULL UNIQUE REFERENCES technical_solution_documents(id) ON DELETE RESTRICT,
  opportunity_id bigint NOT NULL REFERENCES opportunities(id) ON DELETE RESTRICT,
  customer_id bigint NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  file_sha256 char(64) NOT NULL CHECK (file_sha256 ~ '^[0-9a-f]{64}$'),
  purpose text NOT NULL CHECK (btrim(purpose) <> '' AND char_length(purpose) <= 1000),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected', 'revoked')),
  requested_by bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  requested_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by bigint REFERENCES users(id) ON DELETE RESTRICT,
  reviewed_at timestamptz,
  review_comment text,
  revoked_by bigint REFERENCES users(id) ON DELETE RESTRICT,
  revoked_at timestamptz,
  revocation_reason text,
  CHECK (reviewed_by IS NULL OR reviewed_by <> requested_by),
  CHECK ((status = 'pending') = (reviewed_by IS NULL)),
  CHECK ((status = 'pending') = (reviewed_at IS NULL)),
  CHECK (status <> 'rejected' OR btrim(COALESCE(review_comment, '')) <> ''),
  CHECK ((status = 'revoked') = (revoked_by IS NOT NULL)),
  CHECK ((status = 'revoked') = (revoked_at IS NOT NULL)),
  CHECK (status <> 'revoked' OR btrim(COALESCE(revocation_reason, '')) <> '')
);

CREATE INDEX technical_document_customer_releases_scope_idx
  ON technical_document_customer_releases (opportunity_id, customer_id, status);

CREATE OR REPLACE FUNCTION bestcrm_guard_technical_document_customer_release()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  source_record record;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Customer-release decisions cannot be deleted';
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF (NEW.technical_document_id, NEW.opportunity_id, NEW.customer_id,
        NEW.file_sha256, NEW.purpose, NEW.requested_by, NEW.requested_at)
       IS DISTINCT FROM
       (OLD.technical_document_id, OLD.opportunity_id, OLD.customer_id,
        OLD.file_sha256, OLD.purpose, OLD.requested_by, OLD.requested_at) THEN
      RAISE EXCEPTION 'The requested customer-file version and scope are immutable';
    END IF;
    IF NOT ((OLD.status = 'pending' AND NEW.status IN ('approved', 'rejected'))
        OR (OLD.status = 'approved' AND NEW.status = 'revoked')) THEN
      RAISE EXCEPTION 'Invalid customer-file release transition';
    END IF;
    IF OLD.status = 'approved' AND
        (NEW.reviewed_by, NEW.reviewed_at, NEW.review_comment)
        IS DISTINCT FROM
        (OLD.reviewed_by, OLD.reviewed_at, OLD.review_comment) THEN
      RAISE EXCEPTION 'The original customer-release review is immutable';
    END IF;
  ELSIF NEW.status <> 'pending' OR NEW.reviewed_by IS NOT NULL
      OR NEW.revoked_by IS NOT NULL THEN
    RAISE EXCEPTION 'Customer-file release must begin pending';
  END IF;

  SELECT d.sha256, draft.opportunity_id, draft.status,
    draft.formal_version_no, draft.self_approval_test,
    opportunity.customer_id
    INTO source_record
    FROM technical_solution_documents d
    JOIN opportunity_technical_drafts draft ON draft.id = d.technical_draft_id
    JOIN opportunities opportunity ON opportunity.id = draft.opportunity_id
    WHERE d.id = NEW.technical_document_id;
  IF NOT FOUND OR source_record.status <> 'approved'
      OR source_record.formal_version_no IS NULL
      OR source_record.self_approval_test
      OR source_record.opportunity_id IS DISTINCT FROM NEW.opportunity_id
      OR source_record.customer_id IS DISTINCT FROM NEW.customer_id
      OR source_record.sha256 IS DISTINCT FROM NEW.file_sha256 THEN
    RAISE EXCEPTION 'An approved exact technical file and customer are required';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER technical_document_customer_release_guard
  BEFORE INSERT OR UPDATE OR DELETE ON technical_document_customer_releases
  FOR EACH ROW EXECUTE FUNCTION bestcrm_guard_technical_document_customer_release();

-- A new quotation package may only snapshot a currently released technical file.
CREATE OR REPLACE FUNCTION bestcrm_guard_quotation_customer_technical_attachment()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  package_customer_id bigint;
BEGIN
  IF NEW.source_type = 'technical_solution_document' THEN
    SELECT opportunity.customer_id INTO package_customer_id
      FROM quotation_package_versions package
      JOIN opportunities opportunity ON opportunity.id = package.opportunity_id
      WHERE package.id = NEW.quotation_package_id;
    IF NOT EXISTS (
      SELECT 1 FROM technical_document_customer_releases rel
      WHERE rel.technical_document_id = NEW.technical_solution_document_id
        AND rel.opportunity_id = (
          SELECT opportunity_id FROM quotation_package_versions
          WHERE id = NEW.quotation_package_id)
        AND rel.customer_id = package_customer_id
        AND rel.file_sha256 = NEW.sha256
        AND rel.status = 'approved'
    ) THEN
      RAISE EXCEPTION 'Technical file lacks customer-release approval';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER quotation_customer_technical_attachment_guard
  BEFORE INSERT ON quotation_package_attachments
  FOR EACH ROW EXECUTE FUNCTION bestcrm_guard_quotation_customer_technical_attachment();
