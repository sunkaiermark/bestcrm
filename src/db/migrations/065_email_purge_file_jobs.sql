CREATE TABLE IF NOT EXISTS email_purge_file_jobs (
  id bigserial PRIMARY KEY,
  purge_audit_id bigint NOT NULL REFERENCES email_purge_audits(id) ON DELETE RESTRICT,
  file_kind text NOT NULL CHECK (file_kind IN ('attachment', 'raw_email')),
  stored_path text NOT NULL CHECK (
    btrim(stored_path) <> ''
    AND stored_path NOT LIKE '/%'
    AND stored_path NOT LIKE '\\%'
    AND stored_path NOT LIKE '%..%'
  ),
  expected_size bigint NOT NULL CHECK (expected_size >= 0),
  expected_sha256 char(64) NOT NULL CHECK (expected_sha256 ~ '^[0-9a-f]{64}$'),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing')),
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
    (status = 'pending' AND lease_owner IS NULL AND lease_expires_at IS NULL)
    OR
    (status = 'processing' AND btrim(lease_owner) <> '' AND lease_expires_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS email_purge_file_jobs_claim_idx
  ON email_purge_file_jobs(available_at, id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS email_purge_file_jobs_expired_lease_idx
  ON email_purge_file_jobs(lease_expires_at, id)
  WHERE status = 'processing';

CREATE INDEX IF NOT EXISTS email_purge_file_jobs_audit_idx
  ON email_purge_file_jobs(purge_audit_id, id);

CREATE OR REPLACE FUNCTION bestcrm_protect_email_purge_file_job()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('bestcrm.email_purge_file_cleanup', true) = 'enabled' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'Email purge file jobs can only be removed by the cleanup worker';
  END IF;

  IF NEW.purge_audit_id IS DISTINCT FROM OLD.purge_audit_id
    OR NEW.file_kind IS DISTINCT FROM OLD.file_kind
    OR NEW.stored_path IS DISTINCT FROM OLD.stored_path
    OR NEW.expected_size IS DISTINCT FROM OLD.expected_size
    OR NEW.expected_sha256 IS DISTINCT FROM OLD.expected_sha256
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Email purge file job identity is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS email_purge_file_jobs_protect
  ON email_purge_file_jobs;
CREATE TRIGGER email_purge_file_jobs_protect
BEFORE UPDATE OR DELETE ON email_purge_file_jobs
FOR EACH ROW EXECUTE FUNCTION bestcrm_protect_email_purge_file_job();
