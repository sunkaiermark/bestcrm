ALTER TABLE email_threads
  DROP CONSTRAINT IF EXISTS email_threads_triage_status_check,
  ADD CONSTRAINT email_threads_triage_status_check CHECK (
    triage_status IN (
      'pending',
      'linked_opportunity',
      'linked_lead',
      'converted_lead',
      'linked_inquiry',
      'converted_inquiry',
      'archived',
      'spam',
      'outbound_only'
    )
  );

ALTER TABLE email_thread_triage_events
  DROP CONSTRAINT IF EXISTS email_thread_triage_events_event_type_check,
  ADD CONSTRAINT email_thread_triage_events_event_type_check CHECK (
    event_type IN (
      'assigned',
      'linked_opportunity',
      'linked_lead',
      'converted_lead',
      'linked_inquiry',
      'converted_inquiry',
      'archived',
      'spam',
      'reopened'
    )
  ),
  DROP CONSTRAINT IF EXISTS email_thread_triage_events_from_status_check,
  ADD CONSTRAINT email_thread_triage_events_from_status_check CHECK (
    from_status IN (
      'pending',
      'linked_opportunity',
      'linked_lead',
      'converted_lead',
      'linked_inquiry',
      'converted_inquiry',
      'archived',
      'spam',
      'outbound_only'
    )
  ),
  DROP CONSTRAINT IF EXISTS email_thread_triage_events_to_status_check,
  ADD CONSTRAINT email_thread_triage_events_to_status_check CHECK (
    to_status IN (
      'pending',
      'linked_opportunity',
      'linked_lead',
      'converted_lead',
      'linked_inquiry',
      'converted_inquiry',
      'archived',
      'spam',
      'outbound_only'
    )
  );
