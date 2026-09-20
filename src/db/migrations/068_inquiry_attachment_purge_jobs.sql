CREATE TABLE IF NOT EXISTS inquiry_attachment_purge_audits (
  id bigserial PRIMARY KEY,
  operation_id uuid NOT NULL UNIQUE,
  inquiry_id_snapshot bigint NOT NULL CHECK (inquiry_id_snapshot > 0),
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  attachment_count bigint NOT NULL CHECK (attachment_count >= 0),
  total_bytes bigint NOT NULL CHECK (total_bytes >= 0),
  identity_digest char(64) NOT NULL CHECK (identity_digest ~ '^[0-9a-f]{64}$'),
  initiated_by bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inquiry_attachment_purge_audits_inquiry_idx
  ON inquiry_attachment_purge_audits(inquiry_id_snapshot, created_at DESC);

CREATE TABLE IF NOT EXISTS inquiry_attachment_purge_events (
  id bigserial PRIMARY KEY,
  purge_audit_id bigint NOT NULL REFERENCES inquiry_attachment_purge_audits(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN ('planned', 'completed', 'failed')),
  actor_user_id bigint REFERENCES users(id) ON DELETE RESTRICT,
  detail_code text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inquiry_attachment_purge_events_audit_idx
  ON inquiry_attachment_purge_events(purge_audit_id, id);

CREATE TABLE IF NOT EXISTS inquiry_attachment_purge_file_jobs (
  id bigserial PRIMARY KEY,
  purge_audit_id bigint NOT NULL REFERENCES inquiry_attachment_purge_audits(id) ON DELETE RESTRICT,
  stored_path text NOT NULL CHECK (
    btrim(stored_path) <> ''
    AND stored_path NOT LIKE '/%'
    AND stored_path NOT LIKE '\\%'
    AND stored_path !~ '^[A-Za-z]:'
    AND stored_path !~ '(^|[\\/])\.\.([\\/]|$)'
  ),
  expected_size bigint NOT NULL CHECK (expected_size >= 0),
  expected_sha256 char(64) NOT NULL CHECK (expected_sha256 ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'failed')),
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_owner text,
  lease_expires_at timestamptz,
  last_attempt_at timestamptz,
  last_error_code text NOT NULL DEFAULT '',
  last_error_detail text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (purge_audit_id, stored_path),
  CHECK (
    (status IN ('pending', 'failed') AND lease_owner IS NULL AND lease_expires_at IS NULL)
    OR
    (status = 'processing' AND btrim(lease_owner) <> '' AND lease_expires_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS inquiry_attachment_purge_file_jobs_claim_idx
  ON inquiry_attachment_purge_file_jobs(available_at, id)
  WHERE status IN ('pending', 'failed');

CREATE INDEX IF NOT EXISTS inquiry_attachment_purge_file_jobs_expired_lease_idx
  ON inquiry_attachment_purge_file_jobs(lease_expires_at, id)
  WHERE status = 'processing';

CREATE INDEX IF NOT EXISTS inquiry_attachment_purge_file_jobs_audit_idx
  ON inquiry_attachment_purge_file_jobs(purge_audit_id, id);

CREATE OR REPLACE FUNCTION bestcrm_protect_inquiry_attachment_purge_audit()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Inquiry attachment purge audits are immutable';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS inquiry_attachment_purge_audits_no_change
  ON inquiry_attachment_purge_audits;
CREATE TRIGGER inquiry_attachment_purge_audits_no_change
BEFORE UPDATE OR DELETE ON inquiry_attachment_purge_audits
FOR EACH ROW EXECUTE FUNCTION bestcrm_protect_inquiry_attachment_purge_audit();

CREATE OR REPLACE FUNCTION bestcrm_protect_inquiry_attachment_purge_event()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Inquiry attachment purge events are append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS inquiry_attachment_purge_events_no_change
  ON inquiry_attachment_purge_events;
CREATE TRIGGER inquiry_attachment_purge_events_no_change
BEFORE UPDATE OR DELETE ON inquiry_attachment_purge_events
FOR EACH ROW EXECUTE FUNCTION bestcrm_protect_inquiry_attachment_purge_event();

CREATE OR REPLACE FUNCTION bestcrm_protect_inquiry_attachment_purge_file_job()
RETURNS trigger AS $$
BEGIN
  IF current_setting('bestcrm.inquiry_attachment_file_cleanup', true) = 'enabled' THEN
    NULL;
  ELSE
    RAISE EXCEPTION 'Inquiry attachment purge file jobs can only be changed by the cleanup worker';
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;

  IF NEW.purge_audit_id IS DISTINCT FROM OLD.purge_audit_id
    OR NEW.stored_path IS DISTINCT FROM OLD.stored_path
    OR NEW.expected_size IS DISTINCT FROM OLD.expected_size
    OR NEW.expected_sha256 IS DISTINCT FROM OLD.expected_sha256
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Inquiry attachment purge file job identity is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS inquiry_attachment_purge_file_jobs_protect
  ON inquiry_attachment_purge_file_jobs;
CREATE TRIGGER inquiry_attachment_purge_file_jobs_protect
BEFORE UPDATE OR DELETE ON inquiry_attachment_purge_file_jobs
FOR EACH ROW EXECUTE FUNCTION bestcrm_protect_inquiry_attachment_purge_file_job();
