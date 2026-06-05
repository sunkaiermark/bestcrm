CREATE TABLE IF NOT EXISTS requirement_updates (
  id bigserial PRIMARY KEY,
  opportunity_id bigint NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  requirement_text text NOT NULL,
  reason text NOT NULL,
  created_by bigint NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
