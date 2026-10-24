ALTER TABLE opportunity_collaboration_work_package_files
 ADD COLUMN status text NOT NULL DEFAULT 'uploaded' CHECK(status IN ('uploaded','submitted','returned','accepted','withdrawn')),
 ADD COLUMN submitted_at timestamptz,
 ADD COLUMN reviewed_by_user_id bigint REFERENCES users(id),
 ADD COLUMN reviewed_at timestamptz,
 ADD COLUMN review_note text NOT NULL DEFAULT '',
 ADD COLUMN superseded_by_attachment_id bigint REFERENCES attachments(id);
UPDATE opportunity_collaboration_work_package_files f SET status=v.status,submitted_at=v.submitted_at,reviewed_by_user_id=v.reviewed_by_user_id,reviewed_at=v.reviewed_at,review_note=v.review_note FROM opportunity_collaboration_work_package_versions v WHERE v.id=f.work_package_version_id;
COMMENT ON COLUMN opportunity_collaboration_work_package_files.status IS 'Independent file submission/review state; existing batch decisions retained during migration.';
