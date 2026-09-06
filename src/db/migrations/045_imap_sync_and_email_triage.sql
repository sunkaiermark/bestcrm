CREATE TABLE IF NOT EXISTS email_imap_sync_states (
  id bigserial PRIMARY KEY,
  mailbox_key text NOT NULL CHECK (btrim(mailbox_key) <> ''),
  mailbox_name text NOT NULL CHECK (btrim(mailbox_name) <> ''),
  uid_validity text NOT NULL CHECK (btrim(uid_validity) <> ''),
  incremental_last_uid bigint NOT NULL DEFAULT 0 CHECK (incremental_last_uid >= 0),
  backfill_before_uid bigint CHECK (backfill_before_uid IS NULL OR backfill_before_uid > 0),
  backfill_complete boolean NOT NULL DEFAULT false,
  last_incremental_sync_at timestamptz,
  last_backfill_sync_at timestamptz,
  last_error_code text NOT NULL DEFAULT '',
  last_error_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (mailbox_key, mailbox_name)
);

CREATE INDEX IF NOT EXISTS email_imap_sync_states_health_idx
  ON email_imap_sync_states(last_error_at DESC, updated_at DESC, id DESC);

DROP TRIGGER IF EXISTS email_messages_protect_content ON email_messages;

ALTER TABLE email_threads
  ADD COLUMN IF NOT EXISTS archive_disposition text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS classification_category text NOT NULL DEFAULT 'inquiry',
  ADD COLUMN IF NOT EXISTS classification_reason text NOT NULL DEFAULT 'manual_review';

ALTER TABLE email_threads
  DROP CONSTRAINT IF EXISTS email_threads_archive_disposition_check,
  ADD CONSTRAINT email_threads_archive_disposition_check CHECK (
    archive_disposition IN ('active', 'archived', 'spam')
  );

ALTER TABLE email_messages
  ADD COLUMN IF NOT EXISTS archive_disposition text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS classification_category text NOT NULL DEFAULT 'inquiry',
  ADD COLUMN IF NOT EXISTS classification_reason text NOT NULL DEFAULT 'manual_review';

ALTER TABLE email_messages
  DROP CONSTRAINT IF EXISTS email_messages_archive_disposition_check,
  ADD CONSTRAINT email_messages_archive_disposition_check CHECK (
    archive_disposition IN ('active', 'archived', 'spam')
  );

UPDATE email_threads thread
SET
  archive_disposition = CASE inquiry.status
    WHEN 'spam' THEN 'spam'
    WHEN 'archived' THEN 'archived'
    ELSE 'active'
  END,
  classification_category = COALESCE(NULLIF(inquiry.raw_payload -> 'emailFilter' ->> 'category', ''), 'inquiry'),
  classification_reason = COALESCE(NULLIF(inquiry.raw_payload -> 'emailFilter' ->> 'reason', ''), 'manual_review')
FROM inquiries inquiry
WHERE inquiry.id = thread.inquiry_id;

UPDATE email_messages message
SET
  archive_disposition = thread.archive_disposition,
  classification_category = thread.classification_category,
  classification_reason = thread.classification_reason
FROM email_threads thread
WHERE thread.id = message.thread_id
  AND message.direction = 'inbound';

CREATE INDEX IF NOT EXISTS email_threads_archive_disposition_idx
  ON email_threads(archive_disposition, last_message_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS email_messages_archive_disposition_idx
  ON email_messages(archive_disposition, received_at DESC, id DESC)
  WHERE direction = 'inbound';

CREATE OR REPLACE FUNCTION bestcrm_protect_email_message_content()
RETURNS trigger AS $$
BEGIN
  IF OLD.direction = 'inbound' THEN
    RAISE EXCEPTION 'Inbound email messages are immutable';
  END IF;

  IF NEW.thread_id IS DISTINCT FROM OLD.thread_id
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
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
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
    RAISE EXCEPTION 'Archived raw email identity is immutable';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER email_messages_protect_content
BEFORE UPDATE ON email_messages
FOR EACH ROW EXECUTE FUNCTION bestcrm_protect_email_message_content();
