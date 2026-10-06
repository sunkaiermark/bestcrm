-- Formal commercial quotation versions are separate from mutable sales drafts and
-- from the legacy file-based quotation package workflow.
CREATE TABLE sales_commercial_quotation_versions (
  id bigserial PRIMARY KEY,
  opportunity_id bigint NOT NULL REFERENCES opportunities(id) ON DELETE RESTRICT,
  draft_id bigint NOT NULL REFERENCES sales_commercial_quotation_drafts(id) ON DELETE RESTRICT,
  draft_revision_no integer NOT NULL CHECK (draft_revision_no > 0),
  version_no integer NOT NULL CHECK (version_no > 0),
  quotation_no text NOT NULL UNIQUE CHECK (btrim(quotation_no) <> ''),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  CONSTRAINT sales_commercial_quotation_seller_identity_check CHECK (
    snapshot #>> '{seller,code}' IS NOT NULL
    AND snapshot #>> '{seller,legalName}' IS NOT NULL
    AND ((snapshot #>> '{seller,code}' = 'sunkaier_china'
      AND snapshot #>> '{seller,legalName}' = '江苏胜开尔工业技术有限公司')
      OR (snapshot #>> '{seller,code}' = 'sunkaier_apac'
      AND snapshot #>> '{seller,legalName}' = 'SUNKAIER ASIA PACIFIC PTE. LTD.'))
  ),
  source_technical_draft_id bigint NOT NULL REFERENCES opportunity_technical_drafts(id) ON DELETE RESTRICT,
  source_attachment_id bigint NOT NULL REFERENCES attachments(id) ON DELETE RESTRICT,
  source_sha256 char(64) NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'signed')),
  submitted_by bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by bigint REFERENCES users(id) ON DELETE RESTRICT,
  reviewed_at timestamptz,
  review_comment text NOT NULL DEFAULT '',
  signed_by bigint REFERENCES users(id) ON DELETE RESTRICT,
  signed_at timestamptz,
  signature_sha256 char(64),
  seal_sha256 char(64),
  pdf_stored_path text,
  pdf_sha256 char(64),
  pdf_file_size bigint,
  UNIQUE (opportunity_id, version_no),
  UNIQUE (draft_id, draft_revision_no),
  CHECK (reviewed_by IS NULL OR reviewed_by <> submitted_by),
  CHECK (
    status <> 'signed'
    OR (snapshot #>> '{seller,code}' IS NOT NULL AND (
      (snapshot #>> '{seller,code}' = 'sunkaier_china' AND seal_sha256 IS NULL)
      OR (snapshot #>> '{seller,code}' = 'sunkaier_apac'
        AND seal_sha256 IS NOT NULL AND seal_sha256 ~ '^[0-9a-f]{64}$')
    ))
  ),
  CHECK (status = 'signed' OR (signature_sha256 IS NULL AND seal_sha256 IS NULL
    AND pdf_stored_path IS NULL AND pdf_sha256 IS NULL AND pdf_file_size IS NULL)),
  CHECK (
    (status = 'pending' AND reviewed_by IS NULL AND reviewed_at IS NULL AND signed_by IS NULL)
    OR (status IN ('approved', 'rejected') AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND signed_by IS NULL)
    OR (status = 'signed' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL
      AND signed_by IS NOT NULL AND signed_at IS NOT NULL
      AND signature_sha256 IS NOT NULL AND signature_sha256 ~ '^[0-9a-f]{64}$'
      AND (seal_sha256 IS NULL OR seal_sha256 ~ '^[0-9a-f]{64}$')
      AND pdf_stored_path IS NOT NULL AND btrim(pdf_stored_path) <> ''
      AND pdf_sha256 IS NOT NULL AND pdf_sha256 ~ '^[0-9a-f]{64}$'
      AND pdf_file_size IS NOT NULL AND pdf_file_size > 0)
  )
);

CREATE INDEX sales_commercial_quotation_versions_opportunity_idx
  ON sales_commercial_quotation_versions (opportunity_id, version_no DESC);

CREATE TABLE sales_commercial_quotation_version_events (
  id bigserial PRIMARY KEY,
  quotation_version_id bigint NOT NULL REFERENCES sales_commercial_quotation_versions(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN ('submitted', 'approved', 'rejected', 'signed')),
  actor_user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object')
);

CREATE OR REPLACE FUNCTION bestcrm_guard_sales_commercial_quotation_version()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_row record;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Formal quotation versions cannot be deleted';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status <> 'pending' THEN
      RAISE EXCEPTION 'Formal quotation must start as pending review';
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
    IF NEW.reviewed_by IS NULL OR NEW.reviewed_by = OLD.submitted_by OR NEW.reviewed_at IS NULL
       OR NEW.signed_by IS NOT NULL OR NEW.pdf_stored_path IS NOT NULL THEN
      RAISE EXCEPTION 'Invalid commercial review';
    END IF;
    IF NEW.reviewed_by IS DISTINCT FROM (
      SELECT commercial_manager_id FROM opportunities WHERE id = NEW.opportunity_id
    ) THEN
      RAISE EXCEPTION 'The assigned commercial manager must review the quotation';
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

CREATE TRIGGER sales_commercial_quotation_version_guard
  BEFORE INSERT OR UPDATE OR DELETE ON sales_commercial_quotation_versions
  FOR EACH ROW EXECUTE FUNCTION bestcrm_guard_sales_commercial_quotation_version();

CREATE OR REPLACE FUNCTION bestcrm_audit_sales_commercial_quotation_version()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO sales_commercial_quotation_version_events (
    quotation_version_id, event_type, actor_user_id, details
  ) VALUES (
    NEW.id,
    CASE WHEN TG_OP = 'INSERT' THEN 'submitted' ELSE NEW.status END,
    CASE WHEN TG_OP = 'INSERT' THEN NEW.submitted_by
      WHEN NEW.status = 'signed' THEN NEW.signed_by ELSE NEW.reviewed_by END,
    CASE WHEN NEW.status = 'signed' THEN
      jsonb_build_object('pdfSha256', NEW.pdf_sha256, 'signatureSha256', NEW.signature_sha256,
        'sealSha256', NEW.seal_sha256)
      ELSE jsonb_build_object('reviewComment', NEW.review_comment) END
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER sales_commercial_quotation_version_audit
  AFTER INSERT OR UPDATE ON sales_commercial_quotation_versions
  FOR EACH ROW EXECUTE FUNCTION bestcrm_audit_sales_commercial_quotation_version();

CREATE TRIGGER sales_commercial_quotation_version_event_immutable
  BEFORE UPDATE OR DELETE ON sales_commercial_quotation_version_events
  FOR EACH ROW EXECUTE FUNCTION bestcrm_protect_sales_commercial_quotation_draft_event();

ALTER TABLE email_messages
  ADD COLUMN sales_quotation_version_id bigint
    REFERENCES sales_commercial_quotation_versions(id) ON DELETE RESTRICT;
CREATE INDEX email_messages_sales_quotation_version_idx ON email_messages(sales_quotation_version_id)
  WHERE sales_quotation_version_id IS NOT NULL;

CREATE OR REPLACE FUNCTION bestcrm_guard_sales_quotation_email()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE quotation_row sales_commercial_quotation_versions%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.sales_quotation_version_id IS DISTINCT FROM OLD.sales_quotation_version_id THEN
    RAISE EXCEPTION 'Archived quotation email binding is immutable';
  END IF;
  IF NEW.sales_quotation_version_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO quotation_row FROM sales_commercial_quotation_versions
    WHERE id = NEW.sales_quotation_version_id;
  IF NOT FOUND OR quotation_row.status <> 'signed' OR NEW.direction <> 'outbound'
    OR quotation_row.opportunity_id IS DISTINCT FROM
      (SELECT opportunity_id FROM email_threads WHERE id = NEW.thread_id)
    OR NOT EXISTS (
      SELECT 1 FROM opportunity_technical_drafts technical
      JOIN attachments attachment ON attachment.id = quotation_row.source_attachment_id
      WHERE technical.id = quotation_row.source_technical_draft_id
        AND technical.status = 'approved'
        AND attachment.sha256 = quotation_row.source_sha256
        AND attachment.retired_at IS NULL
    )
    OR EXISTS (
      SELECT 1 FROM opportunity_technical_drafts newer
      JOIN opportunity_technical_drafts source ON source.id = quotation_row.source_technical_draft_id
      WHERE newer.opportunity_id = quotation_row.opportunity_id
        AND newer.source_kind = 'uploaded_file'
        AND newer.status IN ('ready', 'pending', 'approved')
        AND newer.draft_revision_no > source.draft_revision_no
    ) THEN
    RAISE EXCEPTION 'Customer email requires a signed quotation from the same opportunity';
  END IF;
  IF NEW.delivery_status IN ('pending', 'sent') AND NOT EXISTS (
    SELECT 1 FROM email_attachments attachment
    WHERE attachment.message_id = NEW.id
      AND attachment.sha256 = quotation_row.pdf_sha256
      AND attachment.file_size = quotation_row.pdf_file_size
      AND attachment.mime_type = 'application/pdf'
  ) THEN
    RAISE EXCEPTION 'Signed quotation PDF attachment is missing or does not match the frozen file';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER email_messages_sales_quotation_guard
  BEFORE INSERT OR UPDATE OF sales_quotation_version_id, delivery_status ON email_messages
  FOR EACH ROW EXECUTE FUNCTION bestcrm_guard_sales_quotation_email();
