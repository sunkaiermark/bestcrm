-- Phase A: durable identities, reversible lifecycle actions, and database-level
-- protection for the three core CRM records.

DO $$
DECLARE
  actual_constraints text[];
  expected_constraints constant text[] := ARRAY[
    'attachments_opportunity_id_fkey',
    'commercial_quotes_opportunity_id_fkey',
    'contacts_customer_id_fkey',
    'contract_approvals_opportunity_id_fkey',
    'email_threads_contact_id_fkey',
    'email_threads_customer_id_fkey',
    'email_threads_opportunity_id_fkey',
    'inquiries_converted_opportunity_id_fkey',
    'inquiries_matched_contact_id_fkey',
    'inquiries_matched_customer_id_fkey',
    'inquiry_customer_approvals_converted_opportunity_id_fkey',
    'inquiry_customer_approvals_customer_id_fkey',
    'opportunities_customer_id_fkey',
    'opportunities_primary_contact_id_fkey',
    'opportunity_bid_workspaces_opportunity_id_fkey',
    'opportunity_engineering_contributions_opportunity_id_fkey',
    'opportunity_material_versions_opportunity_id_fkey',
    'opportunity_member_events_opportunity_id_fkey',
    'opportunity_members_opportunity_id_fkey',
    'opportunity_owner_transfers_opportunity_id_fkey',
    'opportunity_technical_drafts_opportunity_id_fkey',
    'quotation_package_versions_opportunity_id_fkey',
    'requirement_updates_opportunity_id_fkey',
    'sales_work_logs_contact_id_fkey',
    'sales_work_logs_customer_id_fkey',
    'sales_work_logs_opportunity_id_fkey',
    'sales_work_plans_contact_id_fkey',
    'sales_work_plans_customer_id_fkey',
    'sales_work_plans_opportunity_id_fkey',
    'technical_solutions_opportunity_id_fkey',
    'todos_opportunity_id_fkey',
    'workflow_events_opportunity_id_fkey'
  ];
BEGIN
  SELECT array_agg(con.conname ORDER BY con.conname)
  INTO actual_constraints
  FROM pg_constraint con
  JOIN pg_class parent_table ON parent_table.oid = con.confrelid
  JOIN pg_namespace child_namespace ON child_namespace.oid = con.connamespace
  WHERE con.contype = 'f'
    AND child_namespace.nspname = 'public'
    AND parent_table.relname IN ('customers', 'contacts', 'opportunities');

  IF actual_constraints IS DISTINCT FROM expected_constraints THEN
    RAISE EXCEPTION
      'Unexpected foreign-key inventory for core CRM records. Expected %, found %',
      expected_constraints,
      actual_constraints;
  END IF;
END;
$$;

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS record_uid uuid,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by bigint,
  ADD COLUMN IF NOT EXISTS archive_reason text,
  ADD COLUMN IF NOT EXISTS merged_into_id bigint;

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS record_uid uuid,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_by bigint,
  ADD COLUMN IF NOT EXISTS archive_reason text,
  ADD COLUMN IF NOT EXISTS merged_into_id bigint;

ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS record_uid uuid,
  ADD COLUMN IF NOT EXISTS archived_by bigint,
  ADD COLUMN IF NOT EXISTS archive_reason text;

UPDATE customers SET record_uid = gen_random_uuid() WHERE record_uid IS NULL;
UPDATE contacts SET record_uid = gen_random_uuid() WHERE record_uid IS NULL;
UPDATE opportunities SET record_uid = gen_random_uuid() WHERE record_uid IS NULL;

ALTER TABLE customers
  ALTER COLUMN record_uid SET DEFAULT gen_random_uuid(),
  ALTER COLUMN record_uid SET NOT NULL,
  ADD CONSTRAINT customers_archived_by_fkey
    FOREIGN KEY (archived_by) REFERENCES users(id) ON DELETE RESTRICT,
  ADD CONSTRAINT customers_merged_into_id_fkey
    FOREIGN KEY (merged_into_id) REFERENCES customers(id) ON DELETE RESTRICT,
  ADD CONSTRAINT customers_merge_target_check
    CHECK (merged_into_id IS NULL OR (merged_into_id <> id AND archived_at IS NOT NULL));

ALTER TABLE contacts
  ALTER COLUMN record_uid SET DEFAULT gen_random_uuid(),
  ALTER COLUMN record_uid SET NOT NULL,
  ADD CONSTRAINT contacts_archived_by_fkey
    FOREIGN KEY (archived_by) REFERENCES users(id) ON DELETE RESTRICT,
  ADD CONSTRAINT contacts_merged_into_id_fkey
    FOREIGN KEY (merged_into_id) REFERENCES contacts(id) ON DELETE RESTRICT,
  ADD CONSTRAINT contacts_merge_target_check
    CHECK (merged_into_id IS NULL OR (merged_into_id <> id AND archived_at IS NOT NULL));

ALTER TABLE opportunities
  ALTER COLUMN record_uid SET DEFAULT gen_random_uuid(),
  ALTER COLUMN record_uid SET NOT NULL,
  ADD CONSTRAINT opportunities_archived_by_fkey
    FOREIGN KEY (archived_by) REFERENCES users(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX customers_record_uid_unique_idx ON customers(record_uid);
CREATE UNIQUE INDEX contacts_record_uid_unique_idx ON contacts(record_uid);
CREATE UNIQUE INDEX opportunities_record_uid_unique_idx ON opportunities(record_uid);

CREATE INDEX customers_archived_at_idx ON customers(archived_at, id);
CREATE INDEX contacts_archived_at_idx ON contacts(archived_at, id);
CREATE INDEX opportunities_archived_at_idx ON opportunities(archived_at, id);

CREATE TABLE record_lifecycle_events (
  id bigserial PRIMARY KEY,
  record_type text NOT NULL CHECK (record_type IN ('customer', 'contact', 'opportunity')),
  record_id bigint NOT NULL,
  record_uid uuid NOT NULL,
  event_type text NOT NULL CHECK (event_type IN ('archive', 'reopen', 'merge')),
  actor_user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  merged_into_record_id bigint,
  merged_into_record_uid uuid,
  event_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT record_lifecycle_events_merge_target_check CHECK (
    (event_type = 'merge' AND merged_into_record_id IS NOT NULL AND merged_into_record_uid IS NOT NULL)
    OR
    (event_type <> 'merge' AND merged_into_record_id IS NULL AND merged_into_record_uid IS NULL)
  )
);

CREATE INDEX record_lifecycle_events_record_idx
  ON record_lifecycle_events(record_type, record_id, created_at DESC, id DESC);
CREATE INDEX record_lifecycle_events_uid_idx
  ON record_lifecycle_events(record_uid, created_at DESC, id DESC);

CREATE OR REPLACE FUNCTION bestcrm_reject_core_record_delete()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Core CRM records cannot be deleted; archive or merge the record instead';
END;
$$;

CREATE OR REPLACE FUNCTION bestcrm_protect_record_uid()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.record_uid IS DISTINCT FROM OLD.record_uid THEN
    RAISE EXCEPTION 'Stable record UID cannot be changed';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION bestcrm_reject_lifecycle_event_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Record lifecycle events are append-only';
END;
$$;

CREATE OR REPLACE FUNCTION bestcrm_prevent_merge_cycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  cycle_found boolean;
BEGIN
  IF NEW.merged_into_id IS NULL THEN
    RETURN NEW;
  END IF;

  EXECUTE format(
    'WITH RECURSIVE merge_chain AS (
       SELECT id, merged_into_id FROM %I WHERE id = $1
       UNION ALL
       SELECT next_record.id, next_record.merged_into_id
       FROM %I next_record
       JOIN merge_chain current_record ON next_record.id = current_record.merged_into_id
       WHERE current_record.merged_into_id IS NOT NULL
     )
     SELECT EXISTS (SELECT 1 FROM merge_chain WHERE id = $2)',
    TG_TABLE_NAME,
    TG_TABLE_NAME
  ) INTO cycle_found USING NEW.merged_into_id, NEW.id;

  IF cycle_found THEN
    RAISE EXCEPTION 'Core CRM merge chains cannot contain a cycle';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER customers_prevent_delete
BEFORE DELETE ON customers
FOR EACH ROW EXECUTE FUNCTION bestcrm_reject_core_record_delete();
CREATE TRIGGER contacts_prevent_delete
BEFORE DELETE ON contacts
FOR EACH ROW EXECUTE FUNCTION bestcrm_reject_core_record_delete();
CREATE TRIGGER opportunities_prevent_delete
BEFORE DELETE ON opportunities
FOR EACH ROW EXECUTE FUNCTION bestcrm_reject_core_record_delete();

CREATE TRIGGER customers_protect_record_uid
BEFORE UPDATE OF record_uid ON customers
FOR EACH ROW EXECUTE FUNCTION bestcrm_protect_record_uid();
CREATE TRIGGER contacts_protect_record_uid
BEFORE UPDATE OF record_uid ON contacts
FOR EACH ROW EXECUTE FUNCTION bestcrm_protect_record_uid();
CREATE TRIGGER opportunities_protect_record_uid
BEFORE UPDATE OF record_uid ON opportunities
FOR EACH ROW EXECUTE FUNCTION bestcrm_protect_record_uid();

CREATE TRIGGER customers_prevent_merge_cycle
BEFORE INSERT OR UPDATE OF merged_into_id ON customers
FOR EACH ROW EXECUTE FUNCTION bestcrm_prevent_merge_cycle();
CREATE TRIGGER contacts_prevent_merge_cycle
BEFORE INSERT OR UPDATE OF merged_into_id ON contacts
FOR EACH ROW EXECUTE FUNCTION bestcrm_prevent_merge_cycle();

CREATE TRIGGER record_lifecycle_events_immutable
BEFORE UPDATE OR DELETE ON record_lifecycle_events
FOR EACH ROW EXECUTE FUNCTION bestcrm_reject_lifecycle_event_change();

ALTER TABLE contacts DROP CONSTRAINT contacts_customer_id_fkey;
ALTER TABLE contacts ADD CONSTRAINT contacts_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT;
ALTER TABLE email_threads DROP CONSTRAINT email_threads_customer_id_fkey;
ALTER TABLE email_threads ADD CONSTRAINT email_threads_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT;
ALTER TABLE inquiries DROP CONSTRAINT inquiries_matched_customer_id_fkey;
ALTER TABLE inquiries ADD CONSTRAINT inquiries_matched_customer_id_fkey FOREIGN KEY (matched_customer_id) REFERENCES customers(id) ON DELETE RESTRICT;
ALTER TABLE inquiry_customer_approvals DROP CONSTRAINT inquiry_customer_approvals_customer_id_fkey;
ALTER TABLE inquiry_customer_approvals ADD CONSTRAINT inquiry_customer_approvals_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT;
ALTER TABLE opportunities DROP CONSTRAINT opportunities_customer_id_fkey;
ALTER TABLE opportunities ADD CONSTRAINT opportunities_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT;
ALTER TABLE sales_work_logs DROP CONSTRAINT sales_work_logs_customer_id_fkey;
ALTER TABLE sales_work_logs ADD CONSTRAINT sales_work_logs_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT;
ALTER TABLE sales_work_plans DROP CONSTRAINT sales_work_plans_customer_id_fkey;
ALTER TABLE sales_work_plans ADD CONSTRAINT sales_work_plans_customer_id_fkey FOREIGN KEY (customer_id) REFERENCES customers(id) ON DELETE RESTRICT;

ALTER TABLE email_threads DROP CONSTRAINT email_threads_contact_id_fkey;
ALTER TABLE email_threads ADD CONSTRAINT email_threads_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE RESTRICT;
ALTER TABLE inquiries DROP CONSTRAINT inquiries_matched_contact_id_fkey;
ALTER TABLE inquiries ADD CONSTRAINT inquiries_matched_contact_id_fkey FOREIGN KEY (matched_contact_id) REFERENCES contacts(id) ON DELETE RESTRICT;
ALTER TABLE opportunities DROP CONSTRAINT opportunities_primary_contact_id_fkey;
ALTER TABLE opportunities ADD CONSTRAINT opportunities_primary_contact_id_fkey FOREIGN KEY (primary_contact_id) REFERENCES contacts(id) ON DELETE RESTRICT;
ALTER TABLE sales_work_logs DROP CONSTRAINT sales_work_logs_contact_id_fkey;
ALTER TABLE sales_work_logs ADD CONSTRAINT sales_work_logs_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE RESTRICT;
ALTER TABLE sales_work_plans DROP CONSTRAINT sales_work_plans_contact_id_fkey;
ALTER TABLE sales_work_plans ADD CONSTRAINT sales_work_plans_contact_id_fkey FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE RESTRICT;

ALTER TABLE attachments DROP CONSTRAINT attachments_opportunity_id_fkey;
ALTER TABLE attachments ADD CONSTRAINT attachments_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE RESTRICT;
ALTER TABLE commercial_quotes DROP CONSTRAINT commercial_quotes_opportunity_id_fkey;
ALTER TABLE commercial_quotes ADD CONSTRAINT commercial_quotes_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE RESTRICT;
ALTER TABLE contract_approvals DROP CONSTRAINT contract_approvals_opportunity_id_fkey;
ALTER TABLE contract_approvals ADD CONSTRAINT contract_approvals_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE RESTRICT;
ALTER TABLE email_threads DROP CONSTRAINT email_threads_opportunity_id_fkey;
ALTER TABLE email_threads ADD CONSTRAINT email_threads_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE RESTRICT;
ALTER TABLE inquiries DROP CONSTRAINT inquiries_converted_opportunity_id_fkey;
ALTER TABLE inquiries ADD CONSTRAINT inquiries_converted_opportunity_id_fkey FOREIGN KEY (converted_opportunity_id) REFERENCES opportunities(id) ON DELETE RESTRICT;
ALTER TABLE inquiry_customer_approvals DROP CONSTRAINT inquiry_customer_approvals_converted_opportunity_id_fkey;
ALTER TABLE inquiry_customer_approvals ADD CONSTRAINT inquiry_customer_approvals_converted_opportunity_id_fkey FOREIGN KEY (converted_opportunity_id) REFERENCES opportunities(id) ON DELETE RESTRICT;
ALTER TABLE opportunity_bid_workspaces DROP CONSTRAINT opportunity_bid_workspaces_opportunity_id_fkey;
ALTER TABLE opportunity_bid_workspaces ADD CONSTRAINT opportunity_bid_workspaces_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE RESTRICT;
ALTER TABLE opportunity_engineering_contributions DROP CONSTRAINT opportunity_engineering_contributions_opportunity_id_fkey;
ALTER TABLE opportunity_engineering_contributions ADD CONSTRAINT opportunity_engineering_contributions_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE RESTRICT;
ALTER TABLE opportunity_material_versions DROP CONSTRAINT opportunity_material_versions_opportunity_id_fkey;
ALTER TABLE opportunity_material_versions ADD CONSTRAINT opportunity_material_versions_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE RESTRICT;
ALTER TABLE opportunity_member_events DROP CONSTRAINT opportunity_member_events_opportunity_id_fkey;
ALTER TABLE opportunity_member_events ADD CONSTRAINT opportunity_member_events_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE RESTRICT;
ALTER TABLE opportunity_members DROP CONSTRAINT opportunity_members_opportunity_id_fkey;
ALTER TABLE opportunity_members ADD CONSTRAINT opportunity_members_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE RESTRICT;
ALTER TABLE opportunity_owner_transfers DROP CONSTRAINT opportunity_owner_transfers_opportunity_id_fkey;
ALTER TABLE opportunity_owner_transfers ADD CONSTRAINT opportunity_owner_transfers_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE RESTRICT;
ALTER TABLE opportunity_technical_drafts DROP CONSTRAINT opportunity_technical_drafts_opportunity_id_fkey;
ALTER TABLE opportunity_technical_drafts ADD CONSTRAINT opportunity_technical_drafts_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE RESTRICT;
ALTER TABLE quotation_package_versions DROP CONSTRAINT quotation_package_versions_opportunity_id_fkey;
ALTER TABLE quotation_package_versions ADD CONSTRAINT quotation_package_versions_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE RESTRICT;
ALTER TABLE requirement_updates DROP CONSTRAINT requirement_updates_opportunity_id_fkey;
ALTER TABLE requirement_updates ADD CONSTRAINT requirement_updates_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE RESTRICT;
ALTER TABLE sales_work_logs DROP CONSTRAINT sales_work_logs_opportunity_id_fkey;
ALTER TABLE sales_work_logs ADD CONSTRAINT sales_work_logs_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE RESTRICT;
ALTER TABLE sales_work_plans DROP CONSTRAINT sales_work_plans_opportunity_id_fkey;
ALTER TABLE sales_work_plans ADD CONSTRAINT sales_work_plans_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE RESTRICT;
ALTER TABLE technical_solutions DROP CONSTRAINT technical_solutions_opportunity_id_fkey;
ALTER TABLE technical_solutions ADD CONSTRAINT technical_solutions_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE RESTRICT;
ALTER TABLE todos DROP CONSTRAINT todos_opportunity_id_fkey;
ALTER TABLE todos ADD CONSTRAINT todos_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE RESTRICT;
ALTER TABLE workflow_events DROP CONSTRAINT workflow_events_opportunity_id_fkey;
ALTER TABLE workflow_events ADD CONSTRAINT workflow_events_opportunity_id_fkey FOREIGN KEY (opportunity_id) REFERENCES opportunities(id) ON DELETE RESTRICT;
