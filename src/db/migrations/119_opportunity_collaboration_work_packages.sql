CREATE TABLE IF NOT EXISTS opportunity_collaboration_work_packages (
  id bigserial PRIMARY KEY,
  opportunity_id bigint NOT NULL REFERENCES opportunities(id) ON DELETE RESTRICT,
  plan_kind text NOT NULL CHECK (plan_kind IN ('technical_solution', 'internal_quote')),
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 1 AND 200),
  assignee_user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  planned_start_date date,
  planned_submit_date date,
  status text NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started', 'in_progress', 'submitted', 'returned', 'accepted')),
  created_by_user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS opportunity_collaboration_work_packages_opportunity_idx
  ON opportunity_collaboration_work_packages(opportunity_id, plan_kind, created_at, id);

CREATE TABLE IF NOT EXISTS opportunity_collaboration_work_package_versions (
  id bigserial PRIMARY KEY,
  work_package_id bigint NOT NULL REFERENCES opportunity_collaboration_work_packages(id) ON DELETE RESTRICT,
  version_no integer NOT NULL CHECK (version_no > 0),
  status text NOT NULL DEFAULT 'submitted' CHECK (status IN ('submitted', 'returned', 'accepted')),
  submitted_by_user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  reviewed_by_user_id bigint REFERENCES users(id) ON DELETE RESTRICT,
  reviewed_at timestamptz,
  review_note text NOT NULL DEFAULT '',
  UNIQUE (work_package_id, version_no),
  CHECK ((status = 'submitted' AND reviewed_by_user_id IS NULL AND reviewed_at IS NULL)
    OR (status IN ('returned', 'accepted') AND reviewed_by_user_id IS NOT NULL AND reviewed_at IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS opportunity_collaboration_work_package_files (
  id bigserial PRIMARY KEY,
  work_package_version_id bigint NOT NULL REFERENCES opportunity_collaboration_work_package_versions(id) ON DELETE RESTRICT,
  attachment_id bigint NOT NULL REFERENCES attachments(id) ON DELETE RESTRICT,
  sort_order integer NOT NULL DEFAULT 1 CHECK (sort_order > 0),
  added_by_user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  added_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (attachment_id),
  UNIQUE (work_package_version_id, sort_order)
);

CREATE TABLE IF NOT EXISTS opportunity_collaboration_work_package_events (
  id bigserial PRIMARY KEY,
  work_package_id bigint NOT NULL REFERENCES opportunity_collaboration_work_packages(id) ON DELETE RESTRICT,
  work_package_version_id bigint REFERENCES opportunity_collaboration_work_package_versions(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN ('created', 'submitted', 'returned', 'accepted')),
  actor_user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS opportunity_collaboration_work_package_versions_package_idx
  ON opportunity_collaboration_work_package_versions(work_package_id, version_no DESC, id DESC);

CREATE INDEX IF NOT EXISTS opportunity_collaboration_work_package_events_package_idx
  ON opportunity_collaboration_work_package_events(work_package_id, created_at DESC, id DESC);

COMMENT ON TABLE opportunity_collaboration_work_packages IS
  'Presales technical and internal quotation work packages. Customer quotation and contract remain separate formal records.';
