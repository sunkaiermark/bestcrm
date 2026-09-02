ALTER TABLE opportunity_members
  ADD COLUMN IF NOT EXISTS assignment_scope text,
  ADD COLUMN IF NOT EXISTS task_description text,
  ADD COLUMN IF NOT EXISTS due_date date,
  ADD COLUMN IF NOT EXISTS can_send_external_email boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS updated_by bigint REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz;

CREATE TABLE IF NOT EXISTS opportunity_member_events (
  id bigserial PRIMARY KEY,
  opportunity_id bigint NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  member_id bigint REFERENCES opportunity_members(id) ON DELETE SET NULL,
  user_id bigint NOT NULL REFERENCES users(id),
  event_type text NOT NULL CHECK (event_type IN ('assigned', 'updated', 'removed')),
  role_code text NOT NULL,
  permission_level text NOT NULL,
  assignment_scope text,
  task_description text,
  due_date date,
  can_send_external_email boolean NOT NULL DEFAULT false,
  actor_user_id bigint NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS opportunity_member_events_opportunity_idx
  ON opportunity_member_events(opportunity_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS opportunity_member_events_user_idx
  ON opportunity_member_events(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS opportunity_engineering_contributions (
  id bigserial PRIMARY KEY,
  opportunity_id bigint NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  contributor_user_id bigint NOT NULL REFERENCES users(id),
  contribution_summary text NOT NULL CHECK (btrim(contribution_summary) <> ''),
  created_by bigint NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS opportunity_engineering_contributions_opportunity_idx
  ON opportunity_engineering_contributions(opportunity_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS opportunity_engineering_contributions_contributor_idx
  ON opportunity_engineering_contributions(contributor_user_id, created_at DESC);
