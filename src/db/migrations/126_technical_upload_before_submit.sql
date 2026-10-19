ALTER TABLE opportunity_collaboration_work_package_versions ALTER COLUMN submitted_at DROP NOT NULL;
ALTER TABLE opportunity_collaboration_work_package_versions ADD COLUMN IF NOT EXISTS uploaded_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE opportunity_collaboration_work_package_versions DROP CONSTRAINT IF EXISTS opportunity_collaboration_work_package_versions_status_check;
ALTER TABLE opportunity_collaboration_work_package_versions ADD CONSTRAINT opportunity_collaboration_work_package_versions_status_check CHECK(status IN ('uploaded','submitted','returned','accepted','withdrawn'));
ALTER TABLE opportunity_collaboration_work_package_versions DROP CONSTRAINT IF EXISTS opportunity_collaboration_work_package_versions_check;
ALTER TABLE opportunity_collaboration_work_package_versions ADD CONSTRAINT opportunity_collaboration_work_package_versions_check CHECK((status IN ('uploaded','submitted','withdrawn') AND reviewed_by_user_id IS NULL AND reviewed_at IS NULL) OR(status IN ('returned','accepted') AND reviewed_by_user_id IS NOT NULL AND reviewed_at IS NOT NULL));
ALTER TABLE opportunity_collaboration_work_package_events DROP CONSTRAINT IF EXISTS opportunity_collaboration_work_package_events_event_type_check;
ALTER TABLE opportunity_collaboration_work_package_events ADD CONSTRAINT opportunity_collaboration_work_package_events_event_type_check CHECK(event_type IN ('created','uploaded','submitted','returned','accepted','updated','withdrawn','deleted','file_retired'));
