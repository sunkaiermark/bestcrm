ALTER TABLE inquiries
  DROP CONSTRAINT IF EXISTS inquiries_status_check;

ALTER TABLE inquiries
  ADD CONSTRAINT inquiries_status_check
  CHECK (status IN (
    'new',
    'reviewing',
    'returned',
    'rejected',
    'customer_approval_pending',
    'converted',
    'contact_saved',
    'customer_saved',
    'duplicate',
    'spam',
    'archived'
  ));

UPDATE inquiries
SET status = 'new', updated_at = now()
WHERE submission_type = 'sales_lead'
  AND status = 'reviewing';

ALTER TABLE inquiries
  DROP CONSTRAINT IF EXISTS inquiries_sales_lead_status_check;

ALTER TABLE inquiries
  ADD CONSTRAINT inquiries_sales_lead_status_check
  CHECK (
    (
      submission_type = 'sales_lead'
      AND status IN ('new', 'returned', 'rejected', 'converted')
    )
    OR
    (
      submission_type = 'standard'
      AND status NOT IN ('returned', 'rejected')
    )
  );

ALTER TABLE inquiries
  DROP CONSTRAINT IF EXISTS inquiries_sales_lead_opportunity_check;

ALTER TABLE inquiries
  ADD CONSTRAINT inquiries_sales_lead_opportunity_check
  CHECK (
    submission_type <> 'sales_lead'
    OR (status = 'converted') = (converted_opportunity_id IS NOT NULL)
  );

CREATE TABLE IF NOT EXISTS lead_review_events (
  id bigserial PRIMARY KEY,
  inquiry_id bigint NOT NULL REFERENCES inquiries(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (
    event_type IN ('returned', 'resubmitted', 'rejected', 'approved', 'reviewer_reassigned')
  ),
  from_status text NOT NULL CHECK (btrim(from_status) <> ''),
  to_status text NOT NULL CHECK (btrim(to_status) <> ''),
  actor_user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  assigned_user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  opportunity_id bigint REFERENCES opportunities(id) ON DELETE RESTRICT,
  reason text NOT NULL DEFAULT '',
  details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lead_review_events_reason_check CHECK (
    event_type NOT IN ('returned', 'rejected', 'reviewer_reassigned')
    OR btrim(reason) <> ''
  ),
  CONSTRAINT lead_review_events_opportunity_check CHECK (
    (event_type = 'approved' AND opportunity_id IS NOT NULL)
    OR (event_type <> 'approved' AND opportunity_id IS NULL)
  ),
  CONSTRAINT lead_review_events_transition_check CHECK (
    (event_type = 'returned' AND from_status = 'new' AND to_status = 'returned')
    OR (event_type = 'resubmitted' AND from_status = 'returned' AND to_status = 'new')
    OR (event_type = 'rejected' AND from_status = 'new' AND to_status = 'rejected')
    OR (event_type = 'approved' AND from_status = 'new' AND to_status = 'converted')
    OR (event_type = 'reviewer_reassigned' AND from_status = to_status AND from_status IN ('new', 'returned'))
  )
);

CREATE INDEX IF NOT EXISTS lead_review_events_inquiry_idx
  ON lead_review_events(inquiry_id, id);

CREATE OR REPLACE FUNCTION bestcrm_protect_lead_review_event()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Lead review events are immutable';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS lead_review_events_no_change ON lead_review_events;
CREATE TRIGGER lead_review_events_no_change
BEFORE UPDATE OR DELETE ON lead_review_events
FOR EACH ROW EXECUTE FUNCTION bestcrm_protect_lead_review_event();

CREATE OR REPLACE FUNCTION bestcrm_protect_converted_sales_lead()
RETURNS trigger AS $$
BEGIN
  IF OLD.submission_type = 'sales_lead'
     AND (OLD.status = 'converted' OR OLD.converted_opportunity_id IS NOT NULL) THEN
    RAISE EXCEPTION 'Converted sales leads are immutable and cannot be deleted';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS inquiries_converted_sales_lead_guard ON inquiries;
CREATE TRIGGER inquiries_converted_sales_lead_guard
BEFORE UPDATE OR DELETE ON inquiries
FOR EACH ROW EXECUTE FUNCTION bestcrm_protect_converted_sales_lead();

CREATE INDEX IF NOT EXISTS inquiries_sales_lead_review_queue_idx
  ON inquiries(status, assigned_user_id, created_at DESC, id DESC)
  WHERE submission_type = 'sales_lead';
