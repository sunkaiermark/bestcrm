-- The catalog starts empty. Approved commercial commitments must be supplied
-- and published through a separate controlled process; no sample legal text is seeded.
CREATE TABLE sales_quotation_standard_terms (
  id bigserial PRIMARY KEY,
  term_key text NOT NULL CHECK (term_key IN (
    'price_tax', 'payment', 'delivery', 'delivery_period',
    'packing', 'warranty', 'validity', 'scope'
  )),
  language text NOT NULL CHECK (language IN ('zh', 'en')),
  revision_no integer NOT NULL CHECK (revision_no > 0),
  title text NOT NULL CHECK (btrim(title) <> '' AND length(title) <= 200),
  body text NOT NULL CHECK (btrim(body) <> '' AND length(body) <= 10000),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'retired')),
  created_by bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  approved_by bigint REFERENCES users(id) ON DELETE RESTRICT,
  published_at timestamptz,
  retired_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (term_key, language, revision_no),
  CHECK (
    (status = 'draft' AND approved_by IS NULL AND published_at IS NULL AND retired_at IS NULL)
    OR (status = 'published' AND approved_by IS NOT NULL AND published_at IS NOT NULL AND retired_at IS NULL)
    OR (status = 'retired' AND approved_by IS NOT NULL AND published_at IS NOT NULL AND retired_at IS NOT NULL)
  ),
  CHECK (approved_by IS NULL OR approved_by <> created_by)
);

CREATE INDEX sales_quotation_standard_terms_available_idx
  ON sales_quotation_standard_terms (language, term_key, revision_no DESC)
  WHERE status = 'published';

CREATE OR REPLACE FUNCTION bestcrm_guard_sales_quotation_standard_term()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Standard commercial term versions cannot be deleted';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status = 'draft' AND NEW.status = 'retired' THEN
    RAISE EXCEPTION 'Draft standard commercial terms cannot be retired before publication';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status IN ('published', 'retired') THEN
    IF (NEW.term_key, NEW.language, NEW.revision_no, NEW.title, NEW.body,
        NEW.created_by, NEW.approved_by, NEW.published_at, NEW.created_at)
        IS DISTINCT FROM
       (OLD.term_key, OLD.language, OLD.revision_no, OLD.title, OLD.body,
        OLD.created_by, OLD.approved_by, OLD.published_at, OLD.created_at)
       OR NOT (OLD.status = NEW.status OR (OLD.status = 'published' AND NEW.status = 'retired'))
       OR (OLD.status = 'retired' AND NEW.retired_at IS DISTINCT FROM OLD.retired_at) THEN
      RAISE EXCEPTION 'Published standard commercial term content is immutable';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER sales_quotation_standard_term_guard
  BEFORE UPDATE OR DELETE ON sales_quotation_standard_terms
  FOR EACH ROW EXECUTE FUNCTION bestcrm_guard_sales_quotation_standard_term();

ALTER TABLE sales_commercial_quotation_drafts
  ADD COLUMN term_selections jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(term_selections) = 'object');

ALTER TABLE sales_commercial_quotation_draft_events
  ADD COLUMN term_selections jsonb NOT NULL DEFAULT '{}'::jsonb
    CHECK (jsonb_typeof(term_selections) = 'object');

CREATE OR REPLACE FUNCTION bestcrm_log_sales_commercial_quotation_draft()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO sales_commercial_quotation_draft_events (
    draft_id, revision_no, actor_user_id, source_technical_draft_id,
    source_attachment_id, source_sha256, currency,
    seller_entity_code, seller_entity_name, line_items, term_selections
  ) VALUES (
    NEW.id, NEW.draft_revision_no, NEW.updated_by, NEW.source_technical_draft_id,
    NEW.source_attachment_id, NEW.source_sha256, NEW.currency,
    NEW.seller_entity_code, NEW.seller_entity_name, NEW.line_items, NEW.term_selections
  );
  RETURN NEW;
END;
$$;
