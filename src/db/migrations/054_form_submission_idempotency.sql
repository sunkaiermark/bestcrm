CREATE TABLE IF NOT EXISTS form_submission_idempotency (
  token text PRIMARY KEY,
  actor_user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  request_method text NOT NULL,
  request_path text NOT NULL,
  state text NOT NULL DEFAULT 'processing',
  response_status integer,
  response_location text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  CONSTRAINT form_submission_idempotency_token_check
    CHECK (token ~ '^[A-Za-z0-9_-]{16,128}$'),
  CONSTRAINT form_submission_idempotency_method_check
    CHECK (request_method IN ('POST', 'PUT', 'PATCH', 'DELETE')),
  CONSTRAINT form_submission_idempotency_state_check
    CHECK (state IN ('processing', 'completed', 'uncertain')),
  CONSTRAINT form_submission_idempotency_response_status_check
    CHECK (response_status IS NULL OR response_status BETWEEN 100 AND 599)
);

CREATE INDEX IF NOT EXISTS form_submission_idempotency_expires_idx
  ON form_submission_idempotency(expires_at);

CREATE INDEX IF NOT EXISTS form_submission_idempotency_actor_created_idx
  ON form_submission_idempotency(actor_user_id, created_at DESC);
