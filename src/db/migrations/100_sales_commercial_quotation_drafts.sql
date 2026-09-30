-- Sales may prepare an internal quotation draft from an uploaded technical file
-- before technical approval. This table cannot be used as a formal quote or email source.
CREATE TABLE sales_commercial_quotation_drafts (
  id bigserial PRIMARY KEY,
  opportunity_id bigint NOT NULL UNIQUE REFERENCES opportunities(id) ON DELETE RESTRICT,
  source_technical_draft_id bigint NOT NULL REFERENCES opportunity_technical_drafts(id) ON DELETE RESTRICT,
  source_attachment_id bigint NOT NULL REFERENCES attachments(id) ON DELETE RESTRICT,
  source_sha256 char(64) NOT NULL CHECK (source_sha256 ~ '^[0-9a-f]{64}$'),
  source_file_name text NOT NULL CHECK (btrim(source_file_name) <> ''),
  language text NOT NULL CHECK (language IN ('en', 'zh')),
  currency char(3) CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  line_items jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(line_items) = 'array' AND jsonb_array_length(line_items) <= 100),
  draft_revision_no integer NOT NULL DEFAULT 1 CHECK (draft_revision_no > 0),
  created_by bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE sales_commercial_quotation_draft_events (
  id bigserial PRIMARY KEY,
  draft_id bigint NOT NULL REFERENCES sales_commercial_quotation_drafts(id) ON DELETE RESTRICT,
  revision_no integer NOT NULL CHECK (revision_no > 0),
  actor_user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  source_technical_draft_id bigint NOT NULL REFERENCES opportunity_technical_drafts(id) ON DELETE RESTRICT,
  source_attachment_id bigint NOT NULL REFERENCES attachments(id) ON DELETE RESTRICT,
  source_sha256 char(64) NOT NULL,
  currency char(3),
  line_items jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (draft_id, revision_no)
);

CREATE OR REPLACE FUNCTION bestcrm_guard_sales_commercial_quotation_draft()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  file_record record;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Internal commercial quotation drafts cannot be deleted';
  END IF;
  IF TG_OP = 'UPDATE' AND (
      NEW.opportunity_id, NEW.language, NEW.created_by, NEW.created_at)
      IS DISTINCT FROM
      (OLD.opportunity_id, OLD.language, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'Internal commercial quotation draft identity is immutable';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.draft_revision_no <> OLD.draft_revision_no + 1 THEN
    RAISE EXCEPTION 'Internal quotation draft revision must advance by one';
  END IF;
  SELECT draft.opportunity_id, draft.source_kind, draft.status, attachment.sha256,
    attachment.original_name, attachment.retired_at, opportunity.archived_at
    INTO file_record
    FROM opportunity_technical_draft_attachments link
    JOIN opportunity_technical_drafts draft ON draft.id = link.technical_draft_id
    JOIN attachments attachment ON attachment.id = link.attachment_id
    JOIN opportunities opportunity ON opportunity.id = draft.opportunity_id
    WHERE link.technical_draft_id = NEW.source_technical_draft_id
      AND link.attachment_id = NEW.source_attachment_id;
  IF NOT FOUND OR file_record.opportunity_id IS DISTINCT FROM NEW.opportunity_id
      OR file_record.source_kind IS DISTINCT FROM 'uploaded_file'
      OR file_record.status NOT IN ('ready', 'pending', 'approved')
      OR file_record.sha256 IS DISTINCT FROM NEW.source_sha256
      OR file_record.original_name IS DISTINCT FROM NEW.source_file_name
      OR file_record.retired_at IS NOT NULL
      OR file_record.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'The exact active uploaded technical file is required for an internal quotation draft';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER sales_commercial_quotation_draft_guard
  BEFORE INSERT OR UPDATE OR DELETE ON sales_commercial_quotation_drafts
  FOR EACH ROW EXECUTE FUNCTION bestcrm_guard_sales_commercial_quotation_draft();

CREATE OR REPLACE FUNCTION bestcrm_log_sales_commercial_quotation_draft()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO sales_commercial_quotation_draft_events (
    draft_id, revision_no, actor_user_id, source_technical_draft_id,
    source_attachment_id, source_sha256, currency, line_items
  ) VALUES (
    NEW.id, NEW.draft_revision_no, NEW.updated_by, NEW.source_technical_draft_id,
    NEW.source_attachment_id, NEW.source_sha256, NEW.currency, NEW.line_items
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER sales_commercial_quotation_draft_audit
  AFTER INSERT OR UPDATE ON sales_commercial_quotation_drafts
  FOR EACH ROW EXECUTE FUNCTION bestcrm_log_sales_commercial_quotation_draft();

CREATE OR REPLACE FUNCTION bestcrm_protect_sales_commercial_quotation_draft_event()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Internal quotation draft audit events are immutable';
END;
$$;

CREATE TRIGGER sales_commercial_quotation_draft_event_immutable
  BEFORE UPDATE OR DELETE ON sales_commercial_quotation_draft_events
  FOR EACH ROW EXECUTE FUNCTION bestcrm_protect_sales_commercial_quotation_draft_event();
