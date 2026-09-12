ALTER TABLE email_threads
  ADD COLUMN IF NOT EXISTS triage_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS triage_assigned_user_id bigint REFERENCES users(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS triaged_by bigint REFERENCES users(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS triaged_at timestamptz,
  ADD COLUMN IF NOT EXISTS triage_note text NOT NULL DEFAULT '';

ALTER TABLE email_threads
  DROP CONSTRAINT IF EXISTS email_threads_triage_status_check,
  ADD CONSTRAINT email_threads_triage_status_check CHECK (
    triage_status IN (
      'pending',
      'linked_opportunity',
      'linked_inquiry',
      'converted_inquiry',
      'archived',
      'spam',
      'outbound_only'
    )
  );

UPDATE email_threads thread
SET
  triage_status = CASE
    WHEN thread.archive_disposition = 'spam' THEN 'spam'
    WHEN thread.archive_disposition = 'archived' THEN 'archived'
    WHEN thread.opportunity_id IS NOT NULL THEN 'linked_opportunity'
    WHEN thread.inquiry_id IS NOT NULL THEN 'converted_inquiry'
    WHEN EXISTS (
      SELECT 1
      FROM email_messages message
      WHERE message.thread_id = thread.id
        AND message.direction = 'inbound'
    ) THEN 'pending'
    ELSE 'outbound_only'
  END,
  triaged_at = CASE
    WHEN thread.archive_disposition IN ('spam', 'archived')
      OR thread.opportunity_id IS NOT NULL
      OR thread.inquiry_id IS NOT NULL
      OR NOT EXISTS (
        SELECT 1
        FROM email_messages message
        WHERE message.thread_id = thread.id
          AND message.direction = 'inbound'
      ) THEN COALESCE(thread.updated_at, thread.created_at)
    ELSE NULL
  END;

CREATE INDEX IF NOT EXISTS email_threads_triage_status_idx
  ON email_threads(triage_status, last_message_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS email_threads_triage_assignee_idx
  ON email_threads(triage_assigned_user_id, last_message_at DESC, id DESC)
  WHERE triage_status = 'pending' AND triage_assigned_user_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS email_thread_triage_events (
  id bigserial PRIMARY KEY,
  thread_id bigint NOT NULL REFERENCES email_threads(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (
    event_type IN (
      'assigned',
      'linked_opportunity',
      'linked_inquiry',
      'converted_inquiry',
      'archived',
      'spam',
      'reopened'
    )
  ),
  from_status text NOT NULL CHECK (
    from_status IN (
      'pending',
      'linked_opportunity',
      'linked_inquiry',
      'converted_inquiry',
      'archived',
      'spam',
      'outbound_only'
    )
  ),
  to_status text NOT NULL CHECK (
    to_status IN (
      'pending',
      'linked_opportunity',
      'linked_inquiry',
      'converted_inquiry',
      'archived',
      'spam',
      'outbound_only'
    )
  ),
  actor_user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  assigned_user_id bigint REFERENCES users(id) ON DELETE RESTRICT,
  inquiry_id bigint REFERENCES inquiries(id) ON DELETE RESTRICT,
  opportunity_id bigint REFERENCES opportunities(id) ON DELETE RESTRICT,
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_thread_triage_events_thread_idx
  ON email_thread_triage_events(thread_id, id);

CREATE OR REPLACE FUNCTION bestcrm_protect_email_triage_event()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Email triage events are immutable';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS email_thread_triage_events_no_change
  ON email_thread_triage_events;
CREATE TRIGGER email_thread_triage_events_no_change
BEFORE UPDATE OR DELETE ON email_thread_triage_events
FOR EACH ROW EXECUTE FUNCTION bestcrm_protect_email_triage_event();
