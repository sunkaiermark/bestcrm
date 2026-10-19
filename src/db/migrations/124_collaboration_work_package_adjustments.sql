ALTER TABLE opportunity_collaboration_work_package_events DROP CONSTRAINT IF EXISTS opportunity_collaboration_work_package_events_event_type_check;
ALTER TABLE opportunity_collaboration_work_package_events ADD CONSTRAINT opportunity_collaboration_work_package_events_event_type_check CHECK(event_type IN ('created','submitted','returned','accepted','updated'));
