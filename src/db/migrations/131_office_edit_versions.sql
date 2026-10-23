CREATE TABLE office_edit_sessions (
  id uuid PRIMARY KEY,
  root_attachment_id bigint NOT NULL REFERENCES attachments(id),
  source_attachment_id bigint NOT NULL REFERENCES attachments(id),
  current_attachment_id bigint NOT NULL REFERENCES attachments(id),
  opportunity_id bigint NOT NULL REFERENCES opportunities(id),
  actor_user_id bigint NOT NULL REFERENCES users(id),
  content_hash text NOT NULL,
  version_no integer NOT NULL DEFAULT 0,
  state text NOT NULL DEFAULT 'editing' CHECK (state IN ('editing','closed')),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX office_edit_active_attachment ON office_edit_sessions(current_attachment_id) WHERE state='editing';
CREATE TABLE office_edit_versions (
  session_id uuid NOT NULL REFERENCES office_edit_sessions(id),
  version_no integer NOT NULL CHECK(version_no>0),
  attachment_id bigint NOT NULL REFERENCES attachments(id),
  content_hash text NOT NULL,
  saved_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(session_id,version_no)
);
