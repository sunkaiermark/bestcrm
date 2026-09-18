CREATE TABLE IF NOT EXISTS email_reimport_reset_audits (
  operation_id uuid PRIMARY KEY,
  plan_schema_version integer NOT NULL CHECK (plan_schema_version > 0),
  plan_sha256 char(64) NOT NULL UNIQUE CHECK (plan_sha256 ~ '^[0-9a-f]{64}$'),
  retention_rule_version text NOT NULL CHECK (btrim(retention_rule_version) <> ''),
  backup_id text NOT NULL CHECK (btrim(backup_id) <> ''),
  retained_email_inquiries bigint NOT NULL CHECK (retained_email_inquiries >= 0),
  deleted_email_inquiries bigint NOT NULL CHECK (deleted_email_inquiries >= 0),
  retained_threads bigint NOT NULL CHECK (retained_threads >= 0),
  deleted_threads bigint NOT NULL CHECK (deleted_threads >= 0),
  deleted_messages bigint NOT NULL CHECK (deleted_messages >= 0),
  deleted_email_attachments bigint NOT NULL CHECK (deleted_email_attachments >= 0),
  deleted_inquiry_attachments bigint NOT NULL CHECK (deleted_inquiry_attachments >= 0),
  deleted_raw_messages bigint NOT NULL CHECK (deleted_raw_messages >= 0),
  deleted_files bigint NOT NULL CHECK (deleted_files >= 0),
  deleted_file_bytes bigint NOT NULL CHECK (deleted_file_bytes >= 0),
  reset_sync_states bigint NOT NULL CHECK (reset_sync_states >= 0),
  retained_malware_metadata_events bigint NOT NULL CHECK (retained_malware_metadata_events >= 0),
  executed_by text NOT NULL CHECK (btrim(executed_by) <> ''),
  summary jsonb NOT NULL CHECK (jsonb_typeof(summary) = 'object'),
  executed_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_reimport_reset_audits_executed_at_idx
  ON email_reimport_reset_audits(executed_at DESC, operation_id);

CREATE OR REPLACE FUNCTION bestcrm_protect_email_reimport_reset_audit()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Email reimport reset audit records are immutable';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS email_reimport_reset_audits_no_change
  ON email_reimport_reset_audits;
CREATE TRIGGER email_reimport_reset_audits_no_change
BEFORE UPDATE OR DELETE ON email_reimport_reset_audits
FOR EACH ROW EXECUTE FUNCTION bestcrm_protect_email_reimport_reset_audit();
