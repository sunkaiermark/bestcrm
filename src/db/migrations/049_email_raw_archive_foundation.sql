CREATE TABLE IF NOT EXISTS email_raw_messages (
  id bigserial PRIMARY KEY,
  mailbox_key text NOT NULL CHECK (btrim(mailbox_key) <> ''),
  provider_name text NOT NULL DEFAULT 'imap' CHECK (
    provider_name ~ '^[a-z][a-z0-9_-]{1,39}$'
  ),
  provider_mailbox text NOT NULL CHECK (btrim(provider_mailbox) <> ''),
  provider_uid_validity text NOT NULL CHECK (btrim(provider_uid_validity) <> ''),
  provider_uid bigint NOT NULL CHECK (provider_uid > 0),
  rfc_message_id_hint text NOT NULL DEFAULT '',
  source_received_at timestamptz,
  first_observed_at timestamptz NOT NULL DEFAULT now(),
  stored_path text NOT NULL CHECK (
    btrim(stored_path) <> ''
    AND stored_path LIKE 'email-raw/%'
    AND stored_path NOT LIKE '%..%'
  ),
  file_size bigint NOT NULL CHECK (file_size > 0),
  sha256 char(64) NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (mailbox_key, provider_mailbox, provider_uid_validity, provider_uid),
  UNIQUE (stored_path)
);

CREATE INDEX IF NOT EXISTS email_raw_messages_received_idx
  ON email_raw_messages(source_received_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS email_raw_messages_sha256_idx
  ON email_raw_messages(sha256, id);

CREATE TABLE IF NOT EXISTS email_raw_scan_attempts (
  id bigserial PRIMARY KEY,
  raw_message_id bigint NOT NULL REFERENCES email_raw_messages(id) ON DELETE RESTRICT,
  attempt_no integer NOT NULL CHECK (attempt_no > 0),
  engine text NOT NULL CHECK (btrim(engine) <> ''),
  engine_version text NOT NULL DEFAULT '',
  signature_version text NOT NULL DEFAULT '',
  verdict text NOT NULL CHECK (verdict IN ('clean', 'malware', 'suspicious', 'error')),
  finding_code text NOT NULL DEFAULT '',
  safe_detail text NOT NULL DEFAULT '' CHECK (length(safe_detail) <= 1000),
  started_at timestamptz NOT NULL,
  completed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (raw_message_id, attempt_no),
  CHECK (completed_at >= started_at)
);

CREATE INDEX IF NOT EXISTS email_raw_scan_attempts_latest_idx
  ON email_raw_scan_attempts(raw_message_id, attempt_no DESC);

CREATE TABLE IF NOT EXISTS email_raw_processing_attempts (
  id bigserial PRIMARY KEY,
  raw_message_id bigint NOT NULL REFERENCES email_raw_messages(id) ON DELETE RESTRICT,
  attempt_no integer NOT NULL CHECK (attempt_no > 0),
  stage text NOT NULL CHECK (stage IN ('parse', 'archive', 'rebuild')),
  outcome text NOT NULL CHECK (outcome IN ('succeeded', 'retryable_error', 'permanent_error')),
  processor_version text NOT NULL DEFAULT '',
  safe_error_code text NOT NULL DEFAULT '',
  safe_detail text NOT NULL DEFAULT '' CHECK (length(safe_detail) <= 1000),
  started_at timestamptz NOT NULL,
  completed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (raw_message_id, attempt_no),
  CHECK (completed_at >= started_at)
);

CREATE INDEX IF NOT EXISTS email_raw_processing_attempts_latest_idx
  ON email_raw_processing_attempts(raw_message_id, attempt_no DESC);

ALTER TABLE email_messages
  ADD COLUMN IF NOT EXISTS raw_message_id bigint;

ALTER TABLE email_messages
  DROP CONSTRAINT IF EXISTS email_messages_raw_message_fk,
  ADD CONSTRAINT email_messages_raw_message_fk
    FOREIGN KEY (raw_message_id) REFERENCES email_raw_messages(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX IF NOT EXISTS email_messages_raw_message_idx
  ON email_messages(raw_message_id)
  WHERE raw_message_id IS NOT NULL;

COMMENT ON COLUMN email_messages.raw_message_id IS
  'Nullable only during the historical raw-email backfill transition; new archived inbound mail must bind one raw message.';

CREATE TABLE IF NOT EXISTS email_attachment_scan_attempts (
  id bigserial PRIMARY KEY,
  attachment_id bigint NOT NULL REFERENCES email_attachments(id) ON DELETE RESTRICT,
  attempt_no integer NOT NULL CHECK (attempt_no > 0),
  engine text NOT NULL CHECK (btrim(engine) <> ''),
  engine_version text NOT NULL DEFAULT '',
  signature_version text NOT NULL DEFAULT '',
  verdict text NOT NULL CHECK (verdict IN ('clean', 'malware', 'suspicious', 'error')),
  finding_code text NOT NULL DEFAULT '',
  safe_detail text NOT NULL DEFAULT '' CHECK (length(safe_detail) <= 1000),
  started_at timestamptz NOT NULL,
  completed_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (attachment_id, attempt_no),
  CHECK (completed_at >= started_at)
);

CREATE INDEX IF NOT EXISTS email_attachment_scan_attempts_latest_idx
  ON email_attachment_scan_attempts(attachment_id, attempt_no DESC);

CREATE TABLE IF NOT EXISTS email_classification_events (
  id bigserial PRIMARY KEY,
  message_id bigint NOT NULL REFERENCES email_messages(id) ON DELETE RESTRICT,
  thread_id bigint NOT NULL REFERENCES email_threads(id) ON DELETE RESTRICT,
  actor_type text NOT NULL CHECK (actor_type IN ('rule', 'ai', 'human')),
  actor_version text NOT NULL DEFAULT '',
  actor_user_id bigint REFERENCES users(id) ON DELETE RESTRICT,
  category text NOT NULL CHECK (btrim(category) <> ''),
  confidence numeric(5,4) CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
  reason_codes jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(reason_codes) = 'array'),
  is_final boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((actor_type = 'human') = (actor_user_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS email_classification_events_message_idx
  ON email_classification_events(message_id, created_at, id);

CREATE INDEX IF NOT EXISTS email_classification_events_thread_idx
  ON email_classification_events(thread_id, created_at, id);

CREATE OR REPLACE FUNCTION bestcrm_prevent_email_evidence_change()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Email evidence records are immutable and append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS email_raw_messages_no_change ON email_raw_messages;
CREATE TRIGGER email_raw_messages_no_change
BEFORE UPDATE OR DELETE ON email_raw_messages
FOR EACH ROW EXECUTE FUNCTION bestcrm_prevent_email_evidence_change();

DROP TRIGGER IF EXISTS email_raw_scan_attempts_no_change ON email_raw_scan_attempts;
CREATE TRIGGER email_raw_scan_attempts_no_change
BEFORE UPDATE OR DELETE ON email_raw_scan_attempts
FOR EACH ROW EXECUTE FUNCTION bestcrm_prevent_email_evidence_change();

DROP TRIGGER IF EXISTS email_raw_processing_attempts_no_change ON email_raw_processing_attempts;
CREATE TRIGGER email_raw_processing_attempts_no_change
BEFORE UPDATE OR DELETE ON email_raw_processing_attempts
FOR EACH ROW EXECUTE FUNCTION bestcrm_prevent_email_evidence_change();

DROP TRIGGER IF EXISTS email_attachment_scan_attempts_no_change ON email_attachment_scan_attempts;
CREATE TRIGGER email_attachment_scan_attempts_no_change
BEFORE UPDATE OR DELETE ON email_attachment_scan_attempts
FOR EACH ROW EXECUTE FUNCTION bestcrm_prevent_email_evidence_change();

DROP TRIGGER IF EXISTS email_classification_events_no_change ON email_classification_events;
CREATE TRIGGER email_classification_events_no_change
BEFORE UPDATE OR DELETE ON email_classification_events
FOR EACH ROW EXECUTE FUNCTION bestcrm_prevent_email_evidence_change();

CREATE OR REPLACE FUNCTION bestcrm_validate_email_raw_binding()
RETURNS trigger AS $$
DECLARE
  raw_path text;
  raw_size bigint;
  raw_sha char(64);
BEGIN
  IF NEW.raw_message_id IS NULL THEN
    IF NEW.raw_eml_stored_path IS NOT NULL
      OR NEW.raw_eml_file_size IS NOT NULL
      OR NEW.raw_eml_sha256 IS NOT NULL THEN
      RAISE EXCEPTION 'Raw email compatibility fields require raw_message_id';
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.direction <> 'inbound' THEN
    RAISE EXCEPTION 'Only inbound email messages can bind raw email evidence';
  END IF;

  SELECT stored_path, file_size, sha256
  INTO raw_path, raw_size, raw_sha
  FROM email_raw_messages
  WHERE id = NEW.raw_message_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Raw email evidence does not exist';
  END IF;

  IF NEW.raw_eml_stored_path IS DISTINCT FROM raw_path
    OR NEW.raw_eml_file_size IS DISTINCT FROM raw_size
    OR NEW.raw_eml_sha256 IS DISTINCT FROM raw_sha THEN
    RAISE EXCEPTION 'Raw email compatibility fields must match authoritative evidence';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS email_messages_raw_binding_guard ON email_messages;
CREATE TRIGGER email_messages_raw_binding_guard
BEFORE INSERT OR UPDATE OF raw_message_id, raw_eml_stored_path, raw_eml_file_size, raw_eml_sha256
ON email_messages
FOR EACH ROW EXECUTE FUNCTION bestcrm_validate_email_raw_binding();

CREATE OR REPLACE FUNCTION bestcrm_protect_email_message_content()
RETURNS trigger AS $$
DECLARE
  binding_legacy_raw boolean;
BEGIN
  binding_legacy_raw := OLD.direction = 'inbound'
    AND OLD.raw_message_id IS NULL
    AND NEW.raw_message_id IS NOT NULL
    AND NEW.thread_id IS NOT DISTINCT FROM OLD.thread_id
    AND NEW.direction IS NOT DISTINCT FROM OLD.direction
    AND NEW.message_id IS NOT DISTINCT FROM OLD.message_id
    AND NEW.in_reply_to IS NOT DISTINCT FROM OLD.in_reply_to
    AND NEW.reference_ids IS NOT DISTINCT FROM OLD.reference_ids
    AND NEW.reply_to_message_id IS NOT DISTINCT FROM OLD.reply_to_message_id
    AND NEW.quotation_package_version_id IS NOT DISTINCT FROM OLD.quotation_package_version_id
    AND NEW.provider_mailbox IS NOT DISTINCT FROM OLD.provider_mailbox
    AND NEW.provider_uid_validity IS NOT DISTINCT FROM OLD.provider_uid_validity
    AND NEW.provider_uid IS NOT DISTINCT FROM OLD.provider_uid
    AND NEW.mailbox_connection_id IS NOT DISTINCT FROM OLD.mailbox_connection_id
    AND NEW.provider_name IS NOT DISTINCT FROM OLD.provider_name
    AND NEW.provider_message_id IS NOT DISTINCT FROM OLD.provider_message_id
    AND NEW.provider_thread_id IS NOT DISTINCT FROM OLD.provider_thread_id
    AND NEW.provider_history_id IS NOT DISTINCT FROM OLD.provider_history_id
    AND NEW.from_address IS NOT DISTINCT FROM OLD.from_address
    AND NEW.from_name IS NOT DISTINCT FROM OLD.from_name
    AND NEW.to_recipients IS NOT DISTINCT FROM OLD.to_recipients
    AND NEW.cc_recipients IS NOT DISTINCT FROM OLD.cc_recipients
    AND NEW.subject IS NOT DISTINCT FROM OLD.subject
    AND NEW.text_body IS NOT DISTINCT FROM OLD.text_body
    AND NEW.html_body IS NOT DISTINCT FROM OLD.html_body
    AND NEW.safe_headers IS NOT DISTINCT FROM OLD.safe_headers
    AND NEW.archive_disposition IS NOT DISTINCT FROM OLD.archive_disposition
    AND NEW.classification_category IS NOT DISTINCT FROM OLD.classification_category
    AND NEW.classification_reason IS NOT DISTINCT FROM OLD.classification_reason
    AND NEW.authored_by IS NOT DISTINCT FROM OLD.authored_by
    AND NEW.received_at IS NOT DISTINCT FROM OLD.received_at
    AND NEW.sent_at IS NOT DISTINCT FROM OLD.sent_at
    AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at;

  IF OLD.direction = 'inbound' AND NOT binding_legacy_raw THEN
    RAISE EXCEPTION 'Inbound email messages are immutable';
  END IF;

  IF OLD.raw_message_id IS NOT NULL AND NEW.raw_message_id IS DISTINCT FROM OLD.raw_message_id THEN
    RAISE EXCEPTION 'Archived raw email identity is immutable';
  END IF;

  IF OLD.direction <> 'inbound' AND (
    NEW.thread_id IS DISTINCT FROM OLD.thread_id
    OR NEW.direction IS DISTINCT FROM OLD.direction
    OR NEW.message_id IS DISTINCT FROM OLD.message_id
    OR NEW.in_reply_to IS DISTINCT FROM OLD.in_reply_to
    OR NEW.reference_ids IS DISTINCT FROM OLD.reference_ids
    OR NEW.reply_to_message_id IS DISTINCT FROM OLD.reply_to_message_id
    OR NEW.quotation_package_version_id IS DISTINCT FROM OLD.quotation_package_version_id
    OR NEW.provider_mailbox IS DISTINCT FROM OLD.provider_mailbox
    OR NEW.provider_uid_validity IS DISTINCT FROM OLD.provider_uid_validity
    OR NEW.provider_uid IS DISTINCT FROM OLD.provider_uid
    OR NEW.mailbox_connection_id IS DISTINCT FROM OLD.mailbox_connection_id
    OR NEW.provider_name IS DISTINCT FROM OLD.provider_name
    OR NEW.from_address IS DISTINCT FROM OLD.from_address
    OR NEW.from_name IS DISTINCT FROM OLD.from_name
    OR NEW.to_recipients IS DISTINCT FROM OLD.to_recipients
    OR NEW.cc_recipients IS DISTINCT FROM OLD.cc_recipients
    OR NEW.subject IS DISTINCT FROM OLD.subject
    OR NEW.text_body IS DISTINCT FROM OLD.text_body
    OR NEW.html_body IS DISTINCT FROM OLD.html_body
    OR NEW.safe_headers IS DISTINCT FROM OLD.safe_headers
    OR NEW.archive_disposition IS DISTINCT FROM OLD.archive_disposition
    OR NEW.classification_category IS DISTINCT FROM OLD.classification_category
    OR NEW.classification_reason IS DISTINCT FROM OLD.classification_reason
    OR NEW.authored_by IS DISTINCT FROM OLD.authored_by
    OR NEW.received_at IS DISTINCT FROM OLD.received_at
    OR NEW.created_at IS DISTINCT FROM OLD.created_at
  ) THEN
    RAISE EXCEPTION 'Archived email message content is immutable';
  END IF;

  IF btrim(OLD.provider_message_id) <> ''
      AND NEW.provider_message_id IS DISTINCT FROM OLD.provider_message_id THEN
    RAISE EXCEPTION 'Email provider message identity cannot be changed after binding';
  END IF;
  IF btrim(OLD.provider_thread_id) <> ''
      AND NEW.provider_thread_id IS DISTINCT FROM OLD.provider_thread_id THEN
    RAISE EXCEPTION 'Email provider thread identity cannot be changed after binding';
  END IF;
  IF OLD.raw_eml_stored_path IS NOT NULL AND (
      NEW.raw_eml_stored_path IS DISTINCT FROM OLD.raw_eml_stored_path
      OR NEW.raw_eml_file_size IS DISTINCT FROM OLD.raw_eml_file_size
      OR NEW.raw_eml_sha256 IS DISTINCT FROM OLD.raw_eml_sha256
    ) THEN
    RAISE EXCEPTION 'Archived raw email compatibility identity is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS email_messages_protect_content ON email_messages;
CREATE TRIGGER email_messages_protect_content
BEFORE UPDATE ON email_messages
FOR EACH ROW EXECUTE FUNCTION bestcrm_protect_email_message_content();
