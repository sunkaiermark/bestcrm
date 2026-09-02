CREATE TABLE IF NOT EXISTS quotation_package_versions (
  id bigserial PRIMARY KEY,
  opportunity_id bigint NOT NULL REFERENCES opportunities(id) ON DELETE RESTRICT,
  source_package_id bigint REFERENCES quotation_package_versions(id) ON DELETE RESTRICT,
  draft_revision_no integer NOT NULL CHECK (draft_revision_no > 0),
  version_no integer,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending', 'approved', 'rejected', 'sent', 'superseded', 'accepted')),
  technical_solution_version_id bigint NOT NULL REFERENCES opportunity_technical_drafts(id) ON DELETE RESTRICT,
  commercial_quote_id bigint NOT NULL REFERENCES commercial_quotes(id) ON DELETE RESTRICT,
  currency char(3) NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  total_price numeric(14,2) NOT NULL CHECK (total_price > 0),
  delivery_period text NOT NULL CHECK (btrim(delivery_period) <> ''),
  payment_terms text NOT NULL CHECK (btrim(payment_terms) <> ''),
  valid_until date NOT NULL,
  commercial_line_items jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(commercial_line_items) = 'array'),
  inclusions text NOT NULL DEFAULT '',
  exclusions text NOT NULL DEFAULT '',
  technical_assumptions text NOT NULL DEFAULT '',
  revision_reason text,
  change_summary text,
  created_by bigint NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  submitted_by bigint REFERENCES users(id),
  submitted_at timestamptz,
  reviewed_by bigint REFERENCES users(id),
  reviewed_at timestamptz,
  review_comment text,
  sent_by bigint REFERENCES users(id),
  sent_at timestamptz,
  accepted_by bigint REFERENCES users(id),
  accepted_at timestamptz,
  superseded_at timestamptz,
  updated_by bigint NOT NULL REFERENCES users(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (opportunity_id, draft_revision_no),
  CONSTRAINT quotation_package_versions_formal_version_check CHECK (
    (status IN ('approved', 'sent', 'superseded', 'accepted') AND version_no > 0)
    OR (status IN ('draft', 'pending', 'rejected') AND version_no IS NULL)
  ),
  CONSTRAINT quotation_package_versions_revision_check CHECK (
    source_package_id IS NULL
    OR (
      revision_reason IS NOT NULL AND btrim(revision_reason) <> ''
      AND change_summary IS NOT NULL AND btrim(change_summary) <> ''
    )
  ),
  CONSTRAINT quotation_package_versions_submission_check CHECK (
    status NOT IN ('pending', 'approved', 'rejected', 'sent', 'superseded', 'accepted')
    OR (submitted_by IS NOT NULL AND submitted_at IS NOT NULL)
  ),
  CONSTRAINT quotation_package_versions_review_check CHECK (
    status NOT IN ('approved', 'rejected', 'sent', 'superseded', 'accepted')
    OR (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
  ),
  CONSTRAINT quotation_package_versions_sent_check CHECK (
    status NOT IN ('sent', 'superseded', 'accepted')
    OR (sent_by IS NOT NULL AND sent_at IS NOT NULL)
  ),
  CONSTRAINT quotation_package_versions_accepted_check CHECK (
    status <> 'accepted'
    OR (accepted_by IS NOT NULL AND accepted_at IS NOT NULL)
  ),
  CONSTRAINT quotation_package_versions_superseded_check CHECK (
    status <> 'superseded' OR superseded_at IS NOT NULL
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS quotation_package_versions_formal_version_idx
  ON quotation_package_versions(opportunity_id, version_no)
  WHERE version_no IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS quotation_package_versions_pending_idx
  ON quotation_package_versions(opportunity_id)
  WHERE status = 'pending';

CREATE UNIQUE INDEX IF NOT EXISTS quotation_package_versions_open_draft_idx
  ON quotation_package_versions(opportunity_id)
  WHERE status = 'draft';

CREATE UNIQUE INDEX IF NOT EXISTS quotation_package_versions_accepted_idx
  ON quotation_package_versions(opportunity_id)
  WHERE status = 'accepted';

CREATE INDEX IF NOT EXISTS quotation_package_versions_opportunity_idx
  ON quotation_package_versions(opportunity_id, draft_revision_no DESC);

CREATE TABLE IF NOT EXISTS quotation_package_attachments (
  id bigserial PRIMARY KEY,
  quotation_package_id bigint NOT NULL REFERENCES quotation_package_versions(id) ON DELETE RESTRICT,
  source_type text NOT NULL CHECK (source_type IN ('technical_solution_document', 'commercial_quote_attachment')),
  technical_solution_document_id bigint REFERENCES technical_solution_documents(id) ON DELETE RESTRICT,
  attachment_id bigint REFERENCES attachments(id) ON DELETE RESTRICT,
  original_name text NOT NULL,
  mime_type text NOT NULL,
  byte_size bigint NOT NULL CHECK (byte_size > 0),
  sha256 char(64) NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT quotation_package_attachments_source_check CHECK (
    (source_type = 'technical_solution_document' AND technical_solution_document_id IS NOT NULL AND attachment_id IS NULL)
    OR (source_type = 'commercial_quote_attachment' AND attachment_id IS NOT NULL AND technical_solution_document_id IS NULL)
  ),
  UNIQUE (quotation_package_id, technical_solution_document_id),
  UNIQUE (quotation_package_id, attachment_id)
);

CREATE INDEX IF NOT EXISTS quotation_package_attachments_package_idx
  ON quotation_package_attachments(quotation_package_id, display_order, id);

CREATE TABLE IF NOT EXISTS quotation_package_events (
  id bigserial PRIMARY KEY,
  quotation_package_id bigint NOT NULL REFERENCES quotation_package_versions(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN ('created', 'updated', 'submitted', 'approved', 'rejected', 'revision_created', 'sent', 'superseded', 'accepted')),
  actor_user_id bigint NOT NULL REFERENCES users(id),
  comment text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS quotation_package_events_package_idx
  ON quotation_package_events(quotation_package_id, created_at DESC, id DESC);

ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS accepted_quotation_package_id bigint;

ALTER TABLE opportunities
  DROP CONSTRAINT IF EXISTS opportunities_accepted_quotation_package_fk,
  ADD CONSTRAINT opportunities_accepted_quotation_package_fk
    FOREIGN KEY (accepted_quotation_package_id)
    REFERENCES quotation_package_versions(id) ON DELETE RESTRICT;

ALTER TABLE contract_approvals
  ADD COLUMN IF NOT EXISTS quotation_package_version_id bigint;

ALTER TABLE contract_approvals
  DROP CONSTRAINT IF EXISTS contract_approvals_quotation_package_fk,
  ADD CONSTRAINT contract_approvals_quotation_package_fk
    FOREIGN KEY (quotation_package_version_id)
    REFERENCES quotation_package_versions(id) ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION validate_quotation_package_components()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  technical_opportunity_id bigint;
  technical_status text;
  technical_version integer;
  quote_opportunity_id bigint;
  quote_status text;
  quote_total numeric(14,2);
  quote_payment_terms text;
  quote_validity date;
  source_row quotation_package_versions%ROWTYPE;
BEGIN
  SELECT opportunity_id, status, formal_version_no
  INTO technical_opportunity_id, technical_status, technical_version
  FROM opportunity_technical_drafts
  WHERE id = NEW.technical_solution_version_id;

  SELECT opportunity_id, status, total_price, payment_terms, validity_date
  INTO quote_opportunity_id, quote_status, quote_total, quote_payment_terms, quote_validity
  FROM commercial_quotes
  WHERE id = NEW.commercial_quote_id;

  IF technical_opportunity_id IS DISTINCT FROM NEW.opportunity_id
      OR technical_status IS DISTINCT FROM 'approved'
      OR technical_version IS NULL
      OR quote_opportunity_id IS DISTINCT FROM NEW.opportunity_id
      OR quote_status IS DISTINCT FROM 'approved'
      OR quote_total IS DISTINCT FROM NEW.total_price
      OR quote_payment_terms IS DISTINCT FROM NEW.payment_terms
      OR quote_validity IS DISTINCT FROM NEW.valid_until THEN
    RAISE EXCEPTION 'Quotation packages require approved technical solution and commercial quote versions from the same opportunity';
  END IF;

  IF NEW.source_package_id IS NOT NULL THEN
    SELECT * INTO source_row
    FROM quotation_package_versions
    WHERE id = NEW.source_package_id;
    IF source_row.id IS NULL
        OR source_row.opportunity_id IS DISTINCT FROM NEW.opportunity_id
        OR source_row.status NOT IN ('sent', 'superseded') THEN
      RAISE EXCEPTION 'Quotation package revisions require a sent source package from the same opportunity';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS quotation_package_component_guard ON quotation_package_versions;
CREATE TRIGGER quotation_package_component_guard
BEFORE INSERT OR UPDATE OF opportunity_id, source_package_id, technical_solution_version_id,
  commercial_quote_id, total_price, payment_terms, valid_until
ON quotation_package_versions
FOR EACH ROW
EXECUTE FUNCTION validate_quotation_package_components();

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

DROP TRIGGER IF EXISTS quotation_package_immutable_guard ON quotation_package_versions;
CREATE TRIGGER quotation_package_immutable_guard
BEFORE UPDATE OR DELETE ON quotation_package_versions
FOR EACH ROW
EXECUTE FUNCTION protect_quotation_package_version();

CREATE OR REPLACE FUNCTION validate_quotation_package_attachment_source()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  package_row quotation_package_versions%ROWTYPE;
  document_draft_id bigint;
  document_name text;
  document_mime text;
  document_size bigint;
  document_sha char(64);
  attachment_opportunity_id bigint;
  attachment_version_id bigint;
  attachment_name text;
  attachment_mime text;
  attachment_size bigint;
BEGIN
  SELECT * INTO package_row FROM quotation_package_versions WHERE id = NEW.quotation_package_id;
  IF package_row.id IS NULL OR package_row.status <> 'draft' THEN
    RAISE EXCEPTION 'Quotation package attachments can only be added to a draft';
  END IF;

  IF NEW.source_type = 'technical_solution_document' THEN
    SELECT technical_draft_id, original_name, mime_type, byte_size, sha256
    INTO document_draft_id, document_name, document_mime, document_size, document_sha
    FROM technical_solution_documents WHERE id = NEW.technical_solution_document_id;
    IF document_draft_id IS DISTINCT FROM package_row.technical_solution_version_id
        OR document_name IS DISTINCT FROM NEW.original_name
        OR document_mime IS DISTINCT FROM NEW.mime_type
        OR document_size IS DISTINCT FROM NEW.byte_size
        OR document_sha IS DISTINCT FROM NEW.sha256 THEN
      RAISE EXCEPTION 'Technical solution attachment snapshot does not match its approved source';
    END IF;
  ELSE
    SELECT a.opportunity_id, a.opportunity_material_version_id, a.original_name, a.mime_type, a.file_size
    INTO attachment_opportunity_id, attachment_version_id, attachment_name, attachment_mime, attachment_size
    FROM attachments a WHERE a.id = NEW.attachment_id;
    IF attachment_opportunity_id IS DISTINCT FROM package_row.opportunity_id
        OR attachment_name IS DISTINCT FROM NEW.original_name
        OR attachment_mime IS DISTINCT FROM NEW.mime_type
        OR attachment_size IS DISTINCT FROM NEW.byte_size
        OR NOT EXISTS (
          SELECT 1
          FROM opportunity_material_versions mv
          JOIN commercial_quotes cq
            ON cq.opportunity_id = mv.opportunity_id
           AND cq.version_no = mv.version_no
          WHERE mv.id = attachment_version_id
            AND mv.material_type = 'commercial_quote'
            AND mv.status = 'approved'
            AND cq.id = package_row.commercial_quote_id
        ) THEN
      RAISE EXCEPTION 'Commercial quote attachment does not belong to the selected approved quote';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS quotation_package_attachment_source_guard ON quotation_package_attachments;
CREATE TRIGGER quotation_package_attachment_source_guard
BEFORE INSERT ON quotation_package_attachments
FOR EACH ROW
EXECUTE FUNCTION validate_quotation_package_attachment_source();

CREATE OR REPLACE FUNCTION protect_quotation_package_attachment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  package_status text;
BEGIN
  IF TG_OP = 'UPDATE' OR TG_OP = 'DELETE' THEN
    SELECT status INTO package_status
    FROM quotation_package_versions
    WHERE id = OLD.quotation_package_id;
    IF package_status <> 'draft' THEN
      RAISE EXCEPTION 'Quotation package attachments are immutable after submission';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS quotation_package_attachment_immutable_guard ON quotation_package_attachments;
CREATE TRIGGER quotation_package_attachment_immutable_guard
BEFORE UPDATE OR DELETE ON quotation_package_attachments
FOR EACH ROW
EXECUTE FUNCTION protect_quotation_package_attachment();

CREATE OR REPLACE FUNCTION protect_quotation_package_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Quotation package events are append-only';
END;
$$;

DROP TRIGGER IF EXISTS quotation_package_event_append_only_guard ON quotation_package_events;
CREATE TRIGGER quotation_package_event_append_only_guard
BEFORE UPDATE OR DELETE ON quotation_package_events
FOR EACH ROW
EXECUTE FUNCTION protect_quotation_package_event();

CREATE OR REPLACE FUNCTION validate_accepted_quotation_package_link()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  package_opportunity_id bigint;
  package_status text;
BEGIN
  IF TG_OP = 'UPDATE'
      AND OLD.accepted_quotation_package_id IS NOT NULL
      AND NEW.accepted_quotation_package_id IS NULL THEN
    RAISE EXCEPTION 'Accepted quotation package link cannot be cleared';
  END IF;
  IF NEW.accepted_quotation_package_id IS NULL THEN RETURN NEW; END IF;
  SELECT opportunity_id, status
  INTO package_opportunity_id, package_status
  FROM quotation_package_versions
  WHERE id = NEW.accepted_quotation_package_id;
  IF package_opportunity_id IS DISTINCT FROM NEW.id OR package_status IS DISTINCT FROM 'accepted' THEN
    RAISE EXCEPTION 'Opportunity accepted quotation package must be accepted and belong to the same opportunity';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS opportunity_accepted_quotation_package_guard ON opportunities;
CREATE CONSTRAINT TRIGGER opportunity_accepted_quotation_package_guard
AFTER INSERT OR UPDATE OF accepted_quotation_package_id ON opportunities
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION validate_accepted_quotation_package_link();

CREATE OR REPLACE FUNCTION validate_contract_quotation_package_link()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  package_opportunity_id bigint;
  package_status text;
BEGIN
  IF NEW.quotation_package_version_id IS NULL THEN
    RAISE EXCEPTION 'Contract approval requires an accepted quotation package from the same opportunity';
  END IF;
  SELECT opportunity_id, status
  INTO package_opportunity_id, package_status
  FROM quotation_package_versions
  WHERE id = NEW.quotation_package_version_id;
  IF package_opportunity_id IS DISTINCT FROM NEW.opportunity_id OR package_status IS DISTINCT FROM 'accepted' THEN
    RAISE EXCEPTION 'Contract approval requires an accepted quotation package from the same opportunity';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS contract_quotation_package_guard ON contract_approvals;
CREATE TRIGGER contract_quotation_package_guard
BEFORE INSERT OR UPDATE OF opportunity_id, quotation_package_version_id ON contract_approvals
FOR EACH ROW
EXECUTE FUNCTION validate_contract_quotation_package_link();
