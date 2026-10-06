-- Keep the catalog empty until company-approved wording is entered by staff.
-- Draft edits and every publication/retirement are independently auditable.
ALTER TABLE sales_quotation_standard_terms
  ADD COLUMN retired_by bigint REFERENCES users(id) ON DELETE RESTRICT;

CREATE TABLE sales_quotation_standard_term_events (
  id bigserial PRIMARY KEY,
  term_id bigint NOT NULL REFERENCES sales_quotation_standard_terms(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN ('created', 'edited', 'published', 'retired')),
  actor_user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  from_status text,
  to_status text NOT NULL,
  previous_title text,
  previous_body text,
  title text NOT NULL,
  body text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX sales_quotation_standard_term_events_term_idx
  ON sales_quotation_standard_term_events (term_id, id);

CREATE OR REPLACE FUNCTION bestcrm_guard_sales_quotation_standard_term()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Standard commercial term versions cannot be deleted';
  END IF;
  IF OLD.status = 'draft' THEN
    IF (NEW.term_key, NEW.language, NEW.revision_no, NEW.created_by, NEW.created_at)
       IS DISTINCT FROM
       (OLD.term_key, OLD.language, OLD.revision_no, OLD.created_by, OLD.created_at)
       OR NEW.status NOT IN ('draft', 'published') THEN
      RAISE EXCEPTION 'Standard commercial term draft identity is immutable';
    END IF;
    IF NEW.status = 'published' AND
       (NEW.title, NEW.body) IS DISTINCT FROM (OLD.title, OLD.body) THEN
      RAISE EXCEPTION 'Standard commercial term content cannot change during approval';
    END IF;
  ELSIF OLD.status = 'published' THEN
    IF (NEW.term_key, NEW.language, NEW.revision_no, NEW.title, NEW.body,
        NEW.created_by, NEW.approved_by, NEW.published_at, NEW.created_at)
       IS DISTINCT FROM
       (OLD.term_key, OLD.language, OLD.revision_no, OLD.title, OLD.body,
        OLD.created_by, OLD.approved_by, OLD.published_at, OLD.created_at)
       OR NEW.status NOT IN ('published', 'retired')
       OR (NEW.status = 'published' AND
           (NEW.retired_at, NEW.retired_by) IS DISTINCT FROM (OLD.retired_at, OLD.retired_by))
       OR (NEW.status = 'retired' AND (NEW.retired_by IS NULL OR NEW.retired_at IS NULL)) THEN
      RAISE EXCEPTION 'Published standard commercial term content is immutable';
    END IF;
  ELSE
    RAISE EXCEPTION 'Retired standard commercial terms are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION bestcrm_audit_sales_quotation_standard_term()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  kind text;
  actor bigint;
  prior_status text;
  prior_title text;
  prior_body text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    kind := 'created';
    actor := NEW.created_by;
  ELSE
    prior_status := OLD.status;
    prior_title := OLD.title;
    prior_body := OLD.body;
    IF NEW.status = 'published' AND OLD.status = 'draft' THEN
      kind := 'published';
      actor := NEW.approved_by;
    ELSIF NEW.status = 'retired' AND OLD.status = 'published' THEN
      kind := 'retired';
      actor := NEW.retired_by;
    ELSE
      kind := 'edited';
      actor := NEW.created_by;
    END IF;
  END IF;
  INSERT INTO sales_quotation_standard_term_events (
    term_id, event_type, actor_user_id, from_status, to_status,
    previous_title, previous_body, title, body
  ) VALUES (
    NEW.id, kind, actor, prior_status, NEW.status,
    prior_title, prior_body, NEW.title, NEW.body
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER sales_quotation_standard_term_audit
  AFTER INSERT OR UPDATE ON sales_quotation_standard_terms
  FOR EACH ROW EXECUTE FUNCTION bestcrm_audit_sales_quotation_standard_term();

CREATE OR REPLACE FUNCTION bestcrm_protect_sales_quotation_standard_term_event()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Standard commercial term audit events are immutable';
END;
$$;

CREATE TRIGGER sales_quotation_standard_term_event_immutable
  BEFORE UPDATE OR DELETE ON sales_quotation_standard_term_events
  FOR EACH ROW EXECUTE FUNCTION bestcrm_protect_sales_quotation_standard_term_event();
