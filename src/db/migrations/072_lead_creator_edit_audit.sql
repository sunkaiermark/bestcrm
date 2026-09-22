ALTER TABLE lead_review_events
  DROP CONSTRAINT IF EXISTS lead_review_events_event_type_check;

ALTER TABLE lead_review_events
  ADD CONSTRAINT lead_review_events_event_type_check
  CHECK (
    event_type IN (
      'returned',
      'resubmitted',
      'rejected',
      'approved',
      'reviewer_reassigned',
      'creator_edited'
    )
  );

ALTER TABLE lead_review_events
  DROP CONSTRAINT IF EXISTS lead_review_events_transition_check;

ALTER TABLE lead_review_events
  ADD CONSTRAINT lead_review_events_transition_check CHECK (
    (event_type = 'returned' AND from_status = 'new' AND to_status = 'returned')
    OR (event_type = 'resubmitted' AND from_status = 'returned' AND to_status = 'new')
    OR (event_type = 'rejected' AND from_status = 'new' AND to_status = 'rejected')
    OR (event_type = 'approved' AND from_status = 'new' AND to_status = 'converted')
    OR (event_type = 'reviewer_reassigned' AND from_status = to_status AND from_status IN ('new', 'returned'))
    OR (event_type = 'creator_edited' AND from_status = 'new' AND to_status = 'new')
  );
