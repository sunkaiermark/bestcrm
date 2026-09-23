-- Administrator-only opportunity deletion is implemented as an audited logical
-- deletion. The opportunity row and its dependent business evidence remain in
-- the database, while normal CRM reads no longer expose the opportunity. Email
-- threads are unlinked atomically so administrators may review and delete those
-- messages separately through the email-center purge workflow.

ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by bigint,
  ADD COLUMN IF NOT EXISTS delete_reason text;

ALTER TABLE opportunities
  ADD CONSTRAINT opportunities_deleted_by_fkey
    FOREIGN KEY (deleted_by) REFERENCES users(id) ON DELETE RESTRICT,
  ADD CONSTRAINT opportunities_deleted_state_check
    CHECK (
      (deleted_at IS NULL AND deleted_by IS NULL AND delete_reason IS NULL)
      OR
      (deleted_at IS NOT NULL AND deleted_by IS NOT NULL AND btrim(delete_reason) <> '')
    );

CREATE INDEX opportunities_deleted_at_idx ON opportunities(deleted_at, id);

ALTER TABLE record_lifecycle_events
  DROP CONSTRAINT IF EXISTS record_lifecycle_events_event_type_check;

ALTER TABLE record_lifecycle_events
  ADD CONSTRAINT record_lifecycle_events_event_type_check
    CHECK (event_type IN ('archive', 'reopen', 'merge', 'delete'));

CREATE OR REPLACE FUNCTION bestcrm_index_email_thread_after_opportunity_link()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  message_row record;
BEGIN
  IF NEW.opportunity_id IS NOT DISTINCT FROM OLD.opportunity_id THEN
    RETURN NEW;
  END IF;

  IF current_setting('bestcrm.opportunity_delete', true) = 'enabled'
      AND NEW.opportunity_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.opportunity_id IS NULL AND EXISTS (
    SELECT 1
    FROM email_messages message
    JOIN opportunity_activity_links link
      ON link.email_message_id = message.id
      AND link.link_role = 'primary'
    WHERE message.thread_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'An indexed email thread cannot be unlinked from its opportunity';
  END IF;

  IF NEW.opportunity_id IS NOT NULL THEN
    FOR message_row IN SELECT id FROM email_messages WHERE thread_id = NEW.id ORDER BY id LOOP
      PERFORM bestcrm_index_activity_source('email_messages', message_row.id);
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;
