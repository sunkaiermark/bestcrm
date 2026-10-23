CREATE TABLE office_review_sessions (
  id uuid PRIMARY KEY,
  attachment_id bigint NOT NULL REFERENCES attachments(id),
  work_package_version_id bigint NOT NULL REFERENCES opportunity_collaboration_work_package_versions(id),
  actor_user_id bigint NOT NULL REFERENCES users(id),
  state text NOT NULL DEFAULT 'editing' CHECK(state IN ('editing','closed')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX office_review_active_attachment ON office_review_sessions(attachment_id) WHERE state='editing';
CREATE TABLE office_review_snapshots (
  id bigserial PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES office_review_sessions(id),
  attachment_id bigint NOT NULL REFERENCES attachments(id),
  work_package_version_id bigint NOT NULL REFERENCES opportunity_collaboration_work_package_versions(id),
  actor_user_id bigint NOT NULL REFERENCES users(id),
  stored_path text NOT NULL,
  sha256 text NOT NULL,
  content_hash text NOT NULL,
  comments jsonb NOT NULL DEFAULT '[]',
  saved_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX office_review_attachment_history ON office_review_snapshots(attachment_id,id DESC);
