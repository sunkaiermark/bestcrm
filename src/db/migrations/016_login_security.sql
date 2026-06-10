CREATE TABLE IF NOT EXISTS login_attempt_states (
  identity_key text PRIMARY KEY,
  failed_count integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  last_failed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS login_audit_events (
  id bigserial PRIMARY KEY,
  username text NOT NULL,
  user_id bigint REFERENCES users(id) ON DELETE SET NULL,
  ip_address text,
  user_agent text,
  result text NOT NULL,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS login_audit_events_username_idx
  ON login_audit_events(username, created_at DESC);

CREATE INDEX IF NOT EXISTS login_audit_events_user_id_idx
  ON login_audit_events(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS login_audit_events_ip_idx
  ON login_audit_events(ip_address, created_at DESC);
