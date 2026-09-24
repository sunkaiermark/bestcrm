-- CRM classifications are independent of the immutable email message archive.
-- Existing single-category hints are not promoted to confirmed classifications.
CREATE OR REPLACE FUNCTION bestcrm_valid_reviewed_product_categories(codes text[])
RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT codes IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM unnest(codes) AS selected(code)
      WHERE code IS NULL OR code NOT IN (
        'custom-machines', 'filtration', 'flow-control', 'heat-exchanger',
        'incineration-pyrolysis', 'kneaders', 'mixers', 'process-line',
        'pulp-refiners', 'pumps', 'reactors', 'separation'
      )
    )
    AND cardinality(codes) = (SELECT count(DISTINCT code) FROM unnest(codes) AS selected(code));
$$;

ALTER TABLE inquiries
  ADD COLUMN confirmed_product_category_codes text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN product_category_reviewed_by bigint REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN product_category_reviewed_at timestamptz,
  ADD CONSTRAINT inquiries_confirmed_product_categories_check
    CHECK (bestcrm_valid_reviewed_product_categories(confirmed_product_category_codes));

ALTER TABLE opportunities
  ADD COLUMN confirmed_product_category_codes text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN product_category_reviewed_by bigint REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN product_category_reviewed_at timestamptz,
  ADD CONSTRAINT opportunities_confirmed_product_categories_check
    CHECK (bestcrm_valid_reviewed_product_categories(confirmed_product_category_codes));

ALTER TABLE email_threads
  ADD COLUMN confirmed_product_category_codes text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN product_category_reviewed_by bigint REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN product_category_reviewed_at timestamptz,
  ADD CONSTRAINT email_threads_confirmed_product_categories_check
    CHECK (bestcrm_valid_reviewed_product_categories(confirmed_product_category_codes));

CREATE INDEX inquiries_confirmed_product_categories_idx
  ON inquiries USING gin (confirmed_product_category_codes);
CREATE INDEX inquiries_product_category_review_pending_idx
  ON inquiries (created_at DESC, id DESC)
  WHERE product_category_reviewed_at IS NULL
    AND status NOT IN ('spam', 'duplicate', 'rejected');
CREATE INDEX opportunities_confirmed_product_categories_idx
  ON opportunities USING gin (confirmed_product_category_codes);
CREATE INDEX opportunities_product_category_review_pending_idx
  ON opportunities (created_at DESC, id DESC)
  WHERE product_category_reviewed_at IS NULL AND deleted_at IS NULL;
CREATE INDEX email_threads_confirmed_product_categories_idx
  ON email_threads USING gin (confirmed_product_category_codes);
CREATE INDEX email_threads_product_category_review_pending_idx
  ON email_threads (last_message_at DESC, id DESC)
  WHERE product_category_reviewed_at IS NULL AND archive_disposition = 'active';

CREATE TABLE product_category_review_events (
  id bigserial PRIMARY KEY,
  record_type text NOT NULL CHECK (record_type IN ('inquiry', 'opportunity', 'email_thread')),
  record_id bigint NOT NULL,
  previous_codes text[] NOT NULL DEFAULT '{}'::text[],
  confirmed_codes text[] NOT NULL DEFAULT '{}'::text[],
  actor_user_id bigint REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX product_category_review_events_record_idx
  ON product_category_review_events (record_type, record_id, created_at DESC, id DESC);

CREATE OR REPLACE FUNCTION bestcrm_protect_product_category_review_event()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Product category review events are immutable';
END;
$$;
CREATE TRIGGER product_category_review_events_no_change
BEFORE UPDATE OR DELETE ON product_category_review_events
FOR EACH ROW EXECUTE FUNCTION bestcrm_protect_product_category_review_event();

CREATE OR REPLACE FUNCTION bestcrm_log_product_category_review()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  previous_codes text[] := '{}'::text[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF cardinality(NEW.confirmed_product_category_codes) = 0 THEN RETURN NEW; END IF;
  ELSE
    previous_codes := OLD.confirmed_product_category_codes;
    IF NEW.confirmed_product_category_codes IS NOT DISTINCT FROM OLD.confirmed_product_category_codes
        AND (OLD.product_category_reviewed_at IS NOT NULL OR NEW.product_category_reviewed_at IS NULL) THEN
      RETURN NEW;
    END IF;
  END IF;
  INSERT INTO product_category_review_events (
    record_type, record_id, previous_codes, confirmed_codes, actor_user_id
  ) VALUES (
    CASE TG_TABLE_NAME
      WHEN 'inquiries' THEN 'inquiry'
      WHEN 'opportunities' THEN 'opportunity'
      ELSE 'email_thread'
    END,
    NEW.id,
    previous_codes,
    NEW.confirmed_product_category_codes,
    NEW.product_category_reviewed_by
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER inquiries_product_category_review_log
AFTER INSERT OR UPDATE ON inquiries
FOR EACH ROW EXECUTE FUNCTION bestcrm_log_product_category_review();
CREATE TRIGGER opportunities_product_category_review_log
AFTER INSERT OR UPDATE ON opportunities
FOR EACH ROW EXECUTE FUNCTION bestcrm_log_product_category_review();
CREATE TRIGGER email_threads_product_category_review_log
AFTER INSERT OR UPDATE ON email_threads
FOR EACH ROW EXECUTE FUNCTION bestcrm_log_product_category_review();
