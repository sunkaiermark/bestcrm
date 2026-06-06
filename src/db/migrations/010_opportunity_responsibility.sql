CREATE TABLE IF NOT EXISTS opportunity_members (
  id bigserial PRIMARY KEY,
  opportunity_id bigint NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  user_id bigint NOT NULL REFERENCES users(id),
  role_code text NOT NULL,
  permission_level text NOT NULL DEFAULT 'view',
  is_active boolean NOT NULL DEFAULT true,
  added_by bigint NOT NULL REFERENCES users(id),
  added_at timestamptz NOT NULL DEFAULT now(),
  removed_by bigint REFERENCES users(id),
  removed_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS opportunity_members_active_unique_idx
  ON opportunity_members(opportunity_id, user_id, role_code)
  WHERE is_active = true;

CREATE INDEX IF NOT EXISTS opportunity_members_opportunity_idx
  ON opportunity_members(opportunity_id, is_active);

CREATE INDEX IF NOT EXISTS opportunity_members_user_idx
  ON opportunity_members(user_id, is_active);

CREATE TABLE IF NOT EXISTS opportunity_owner_transfers (
  id bigserial PRIMARY KEY,
  opportunity_id bigint NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  from_owner_user_id bigint NOT NULL REFERENCES users(id),
  to_owner_user_id bigint NOT NULL REFERENCES users(id),
  changed_by bigint NOT NULL REFERENCES users(id),
  reason text NOT NULL,
  keep_previous_owner_as_member boolean NOT NULL DEFAULT false,
  transferred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS opportunity_owner_transfers_opportunity_idx
  ON opportunity_owner_transfers(opportunity_id, transferred_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS opportunity_owner_transfers_to_owner_idx
  ON opportunity_owner_transfers(to_owner_user_id, transferred_at DESC);
