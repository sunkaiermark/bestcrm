ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS coordinator_user_id bigint;

UPDATE customers
SET coordinator_user_id = owner_user_id
WHERE coordinator_user_id IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'customers_coordinator_user_id_fkey'
      AND conrelid = 'customers'::regclass
  ) THEN
    ALTER TABLE customers
      ADD CONSTRAINT customers_coordinator_user_id_fkey
      FOREIGN KEY (coordinator_user_id) REFERENCES users(id) ON DELETE RESTRICT;
  END IF;
END
$$;

ALTER TABLE customers
  ALTER COLUMN coordinator_user_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS customers_coordinator_user_id_idx
  ON customers(coordinator_user_id, archived_at, id);

COMMENT ON COLUMN customers.owner_user_id IS
  'Legacy compatibility mirror of coordinator_user_id. It is not customer ownership or an opportunity access boundary.';
COMMENT ON COLUMN customers.coordinator_user_id IS
  'Customer relationship coordinator. Customers remain company-shared and opportunity ownership is independent.';

CREATE OR REPLACE FUNCTION bestcrm_sync_customer_coordinator()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.coordinator_user_id := COALESCE(NEW.coordinator_user_id, NEW.owner_user_id);
    NEW.owner_user_id := COALESCE(NEW.coordinator_user_id, NEW.owner_user_id);
  ELSIF NEW.coordinator_user_id IS DISTINCT FROM OLD.coordinator_user_id THEN
    NEW.owner_user_id := NEW.coordinator_user_id;
  ELSIF NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id THEN
    NEW.coordinator_user_id := NEW.owner_user_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS customers_sync_coordinator ON customers;
CREATE TRIGGER customers_sync_coordinator
BEFORE INSERT OR UPDATE OF owner_user_id, coordinator_user_id ON customers
FOR EACH ROW EXECUTE FUNCTION bestcrm_sync_customer_coordinator();

CREATE TABLE IF NOT EXISTS customer_coordination_events (
  id bigserial PRIMARY KEY,
  customer_id bigint NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN ('migrated', 'coordinator_assigned', 'coordinator_changed')),
  previous_coordinator_user_id bigint REFERENCES users(id) ON DELETE RESTRICT,
  coordinator_user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  actor_user_id bigint REFERENCES users(id) ON DELETE RESTRICT,
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS customer_coordination_events_customer_idx
  ON customer_coordination_events(customer_id, created_at DESC, id DESC);

CREATE UNIQUE INDEX IF NOT EXISTS customer_coordination_events_migrated_idx
  ON customer_coordination_events(customer_id)
  WHERE event_type = 'migrated';

INSERT INTO customer_coordination_events (
  customer_id,
  event_type,
  previous_coordinator_user_id,
  coordinator_user_id,
  actor_user_id,
  note
)
SELECT
  customer.id,
  'migrated',
  customer.owner_user_id,
  customer.coordinator_user_id,
  NULL,
  'Migrated legacy customer responsible person to relationship coordinator; opportunity ownership remains independent.'
FROM customers customer
ON CONFLICT (customer_id) WHERE event_type = 'migrated' DO NOTHING;

ALTER TABLE inquiry_customer_approvals
  DROP CONSTRAINT IF EXISTS inquiry_customer_approvals_status_check;

ALTER TABLE inquiry_customer_approvals
  ADD CONSTRAINT inquiry_customer_approvals_status_check
  CHECK (status IN ('pending', 'approved', 'rejected', 'superseded'));

UPDATE inquiry_customer_approvals
SET
  status = 'superseded',
  decision_note = concat_ws(
    E'\n',
    NULLIF(btrim(decision_note), ''),
    'Superseded by shared-customer policy: selecting an existing customer no longer requires owner approval.'
  ),
  decided_at = COALESCE(decided_at, now()),
  updated_at = now()
WHERE status = 'pending';

UPDATE inquiries inquiry
SET
  status = 'reviewing',
  assigned_user_id = approval.requested_by,
  review_note = concat_ws(
    E'\n',
    NULLIF(btrim(inquiry.review_note), ''),
    'Customer collaboration approval superseded; continue by selecting the existing customer.'
  ),
  updated_at = now()
FROM inquiry_customer_approvals approval
WHERE inquiry.id = approval.inquiry_id
  AND inquiry.status = 'customer_approval_pending'
  AND approval.status = 'superseded';

CREATE TABLE IF NOT EXISTS inquiry_opportunity_link_events (
  id bigserial PRIMARY KEY,
  inquiry_id bigint NOT NULL UNIQUE REFERENCES inquiries(id) ON DELETE RESTRICT,
  customer_id bigint NOT NULL REFERENCES customers(id) ON DELETE RESTRICT,
  opportunity_id bigint NOT NULL REFERENCES opportunities(id) ON DELETE RESTRICT,
  link_kind text NOT NULL CHECK (link_kind IN ('created', 'existing')),
  actor_user_id bigint REFERENCES users(id) ON DELETE RESTRICT,
  source text NOT NULL DEFAULT 'inquiry_conversion',
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inquiry_opportunity_link_events_opportunity_idx
  ON inquiry_opportunity_link_events(opportunity_id, created_at DESC, id DESC);

INSERT INTO inquiry_opportunity_link_events (
  inquiry_id,
  customer_id,
  opportunity_id,
  link_kind,
  actor_user_id,
  source,
  note
)
SELECT
  inquiry.id,
  opportunity.customer_id,
  opportunity.id,
  CASE WHEN opportunity.origin_inquiry_id = inquiry.id THEN 'created' ELSE 'existing' END,
  inquiry.reviewed_by,
  'migration',
  'Backfilled from the immutable inquiry conversion relationship.'
FROM inquiries inquiry
JOIN opportunities opportunity ON opportunity.id = inquiry.converted_opportunity_id
WHERE inquiry.converted_opportunity_id IS NOT NULL
ON CONFLICT (inquiry_id) DO NOTHING;

CREATE OR REPLACE FUNCTION bestcrm_reject_shared_customer_audit_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Shared customer coordination and inquiry opportunity link events are append-only';
END;
$$;

DROP TRIGGER IF EXISTS customer_coordination_events_append_only ON customer_coordination_events;
CREATE TRIGGER customer_coordination_events_append_only
BEFORE UPDATE OR DELETE ON customer_coordination_events
FOR EACH ROW EXECUTE FUNCTION bestcrm_reject_shared_customer_audit_mutation();

DROP TRIGGER IF EXISTS inquiry_opportunity_link_events_append_only ON inquiry_opportunity_link_events;
CREATE TRIGGER inquiry_opportunity_link_events_append_only
BEFORE UPDATE OR DELETE ON inquiry_opportunity_link_events
FOR EACH ROW EXECUTE FUNCTION bestcrm_reject_shared_customer_audit_mutation();
