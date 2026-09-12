CREATE TABLE IF NOT EXISTS email_purge_audits (
  id bigserial PRIMARY KEY,
  thread_id bigint NOT NULL UNIQUE,
  mailbox_key text NOT NULL CHECK (btrim(mailbox_key) <> ''),
  subject_sha256 char(64) NOT NULL CHECK (subject_sha256 ~ '^[0-9a-f]{64}$'),
  message_count integer NOT NULL CHECK (message_count > 0),
  attachment_count integer NOT NULL CHECK (attachment_count >= 0),
  attachment_bytes bigint NOT NULL CHECK (attachment_bytes >= 0),
  raw_message_count integer NOT NULL CHECK (raw_message_count >= 0),
  raw_message_bytes bigint NOT NULL CHECK (raw_message_bytes >= 0),
  triage_event_count integer NOT NULL CHECK (triage_event_count >= 0),
  assignment_event_count integer NOT NULL CHECK (assignment_event_count >= 0),
  triage_status text NOT NULL CHECK (btrim(triage_status) <> ''),
  archive_disposition text NOT NULL CHECK (btrim(archive_disposition) <> ''),
  last_message_at timestamptz NOT NULL,
  purged_by bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  purge_reason text NOT NULL CHECK (btrim(purge_reason) <> ''),
  purged_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_purge_audits_purged_at_idx
  ON email_purge_audits(purged_at DESC, id DESC);

CREATE OR REPLACE FUNCTION bestcrm_protect_email_purge_audit()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Email purge audit records are immutable';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS email_purge_audits_no_change
  ON email_purge_audits;
CREATE TRIGGER email_purge_audits_no_change
BEFORE UPDATE OR DELETE ON email_purge_audits
FOR EACH ROW EXECUTE FUNCTION bestcrm_protect_email_purge_audit();

CREATE OR REPLACE FUNCTION bestcrm_prevent_email_archive_delete()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE'
      AND current_setting('bestcrm.email_purge', true) = 'enabled' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Business email archive records cannot be deleted';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION bestcrm_prevent_email_attachment_change()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE'
      AND current_setting('bestcrm.email_purge', true) = 'enabled' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Archived email attachments are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION bestcrm_prevent_email_evidence_change()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE'
      AND current_setting('bestcrm.email_purge', true) = 'enabled' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Email evidence records are immutable and append-only';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION bestcrm_protect_email_mailbox_delivery()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE'
      AND current_setting('bestcrm.email_purge', true) = 'enabled' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Email mailbox delivery records are immutable';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION bestcrm_protect_email_thread_assignment_event()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE'
      AND current_setting('bestcrm.email_purge', true) = 'enabled' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Email thread assignment events are append-only';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION bestcrm_protect_email_triage_event()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE'
      AND current_setting('bestcrm.email_purge', true) = 'enabled' THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'Email triage events are immutable';
END;
$$ LANGUAGE plpgsql;
