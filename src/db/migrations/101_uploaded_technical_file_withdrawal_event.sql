-- Uploaded technical file withdrawal already writes this audit event. Keep the
-- existing event vocabulary while allowing that previously rejected write.
ALTER TABLE opportunity_technical_draft_events
  DROP CONSTRAINT IF EXISTS opportunity_technical_draft_events_event_type_check,
  ADD CONSTRAINT opportunity_technical_draft_events_event_type_check
    CHECK (event_type IN (
      'created', 'variables_updated', 'section_updated', 'clauses_updated',
      'assignment_added', 'assignment_removed', 'readiness_checked',
      'submitted', 'withdrawn', 'approved', 'rejected', 'revision_created',
      'documents_generated', 'file_uploaded', 'file_replaced', 'file_withdrawn'
    ));
