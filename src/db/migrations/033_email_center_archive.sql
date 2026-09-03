CREATE TABLE IF NOT EXISTS email_threads (
  id bigserial PRIMARY KEY,
  mailbox_key text NOT NULL CHECK (btrim(mailbox_key) <> ''),
  subject text NOT NULL DEFAULT '',
  normalized_subject text NOT NULL DEFAULT '',
  inquiry_id bigint REFERENCES inquiries(id) ON DELETE SET NULL,
  opportunity_id bigint REFERENCES opportunities(id) ON DELETE SET NULL,
  customer_id bigint REFERENCES customers(id) ON DELETE SET NULL,
  contact_id bigint REFERENCES contacts(id) ON DELETE SET NULL,
  last_message_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_threads_last_message_idx
  ON email_threads(last_message_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS email_threads_inquiry_idx
  ON email_threads(inquiry_id)
  WHERE inquiry_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS email_threads_opportunity_idx
  ON email_threads(opportunity_id, last_message_at DESC)
  WHERE opportunity_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS email_messages (
  id bigserial PRIMARY KEY,
  thread_id bigint NOT NULL REFERENCES email_threads(id) ON DELETE RESTRICT,
  direction text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  message_id text NOT NULL DEFAULT '',
  in_reply_to text NOT NULL DEFAULT '',
  reference_ids jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(reference_ids) = 'array'),
  provider_mailbox text NOT NULL DEFAULT '',
  provider_uid_validity text NOT NULL DEFAULT '',
  provider_uid bigint,
  from_address text NOT NULL CHECK (btrim(from_address) <> ''),
  from_name text NOT NULL DEFAULT '',
  to_recipients jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(to_recipients) = 'array'),
  cc_recipients jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(cc_recipients) = 'array'),
  subject text NOT NULL DEFAULT '',
  text_body text NOT NULL DEFAULT '',
  html_body text NOT NULL DEFAULT '',
  safe_headers jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(safe_headers) = 'object'),
  delivery_status text NOT NULL CHECK (delivery_status IN ('received', 'pending', 'sent', 'failed')),
  provider_message_id text NOT NULL DEFAULT '',
  failure_code text NOT NULL DEFAULT '',
  failure_detail text NOT NULL DEFAULT '',
  authored_by bigint REFERENCES users(id) ON DELETE SET NULL,
  sent_at timestamptz,
  received_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT email_messages_provider_uid_check CHECK (provider_uid IS NULL OR provider_uid > 0),
  CONSTRAINT email_messages_direction_status_check CHECK (
    (direction = 'inbound' AND delivery_status = 'received' AND received_at IS NOT NULL)
    OR (direction = 'outbound' AND delivery_status IN ('pending', 'sent', 'failed'))
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS email_messages_message_id_idx
  ON email_messages(lower(message_id))
  WHERE btrim(message_id) <> '';

CREATE UNIQUE INDEX IF NOT EXISTS email_messages_provider_uid_idx
  ON email_messages(provider_mailbox, provider_uid_validity, provider_uid)
  WHERE btrim(provider_mailbox) <> '' AND provider_uid IS NOT NULL;

CREATE INDEX IF NOT EXISTS email_messages_thread_idx
  ON email_messages(thread_id, COALESCE(received_at, sent_at, created_at), id);

CREATE TABLE IF NOT EXISTS email_attachments (
  id bigserial PRIMARY KEY,
  message_id bigint NOT NULL REFERENCES email_messages(id) ON DELETE RESTRICT,
  source_index integer NOT NULL CHECK (source_index >= 0),
  original_name text NOT NULL CHECK (btrim(original_name) <> ''),
  stored_path text NOT NULL CHECK (btrim(stored_path) <> ''),
  mime_type text NOT NULL DEFAULT 'application/octet-stream',
  file_size bigint NOT NULL CHECK (file_size >= 0),
  sha256 char(64) NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  content_id text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id, source_index)
);

CREATE INDEX IF NOT EXISTS email_attachments_message_idx
  ON email_attachments(message_id, source_index, id);

CREATE TABLE IF NOT EXISTS email_delivery_attempts (
  id bigserial PRIMARY KEY,
  message_id bigint NOT NULL REFERENCES email_messages(id) ON DELETE RESTRICT,
  attempt_number integer NOT NULL CHECK (attempt_number > 0),
  attempted_by bigint REFERENCES users(id) ON DELETE SET NULL,
  status text NOT NULL CHECK (status IN ('pending', 'sent', 'failed')),
  provider_message_id text NOT NULL DEFAULT '',
  safe_error text NOT NULL DEFAULT '',
  attempted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (message_id, attempt_number)
);

CREATE INDEX IF NOT EXISTS email_delivery_attempts_message_idx
  ON email_delivery_attempts(message_id, attempt_number DESC);

CREATE OR REPLACE FUNCTION bestcrm_prevent_email_archive_delete()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Business email archive records cannot be deleted';
END;
$$ LANGUAGE plpgsql;

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
    OR NEW.provider_mailbox IS DISTINCT FROM OLD.provider_mailbox
    OR NEW.provider_uid_validity IS DISTINCT FROM OLD.provider_uid_validity
    OR NEW.provider_uid IS DISTINCT FROM OLD.provider_uid
    OR NEW.from_address IS DISTINCT FROM OLD.from_address
    OR NEW.from_name IS DISTINCT FROM OLD.from_name
    OR NEW.to_recipients IS DISTINCT FROM OLD.to_recipients
    OR NEW.cc_recipients IS DISTINCT FROM OLD.cc_recipients
    OR NEW.subject IS DISTINCT FROM OLD.subject
    OR NEW.text_body IS DISTINCT FROM OLD.text_body
    OR NEW.html_body IS DISTINCT FROM OLD.html_body
    OR NEW.safe_headers IS DISTINCT FROM OLD.safe_headers
    OR NEW.authored_by IS DISTINCT FROM OLD.authored_by
    OR NEW.received_at IS DISTINCT FROM OLD.received_at
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Archived email message content is immutable';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION bestcrm_prevent_email_attachment_change()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Archived email attachments are immutable';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS email_threads_no_delete ON email_threads;
CREATE TRIGGER email_threads_no_delete
BEFORE DELETE ON email_threads
FOR EACH ROW EXECUTE FUNCTION bestcrm_prevent_email_archive_delete();

DROP TRIGGER IF EXISTS email_messages_no_delete ON email_messages;
CREATE TRIGGER email_messages_no_delete
BEFORE DELETE ON email_messages
FOR EACH ROW EXECUTE FUNCTION bestcrm_prevent_email_archive_delete();

DROP TRIGGER IF EXISTS email_messages_protect_content ON email_messages;
CREATE TRIGGER email_messages_protect_content
BEFORE UPDATE ON email_messages
FOR EACH ROW EXECUTE FUNCTION bestcrm_protect_email_message_content();

DROP TRIGGER IF EXISTS email_attachments_no_change ON email_attachments;
CREATE TRIGGER email_attachments_no_change
BEFORE UPDATE OR DELETE ON email_attachments
FOR EACH ROW EXECUTE FUNCTION bestcrm_prevent_email_attachment_change();

DROP TRIGGER IF EXISTS email_delivery_attempts_no_change ON email_delivery_attempts;
CREATE TRIGGER email_delivery_attempts_no_change
BEFORE UPDATE OR DELETE ON email_delivery_attempts
FOR EACH ROW EXECUTE FUNCTION bestcrm_prevent_email_archive_delete();

CREATE OR REPLACE FUNCTION bestcrm_link_converted_inquiry_email_threads()
RETURNS trigger AS $$
BEGIN
  IF NEW.converted_opportunity_id IS NOT NULL
    AND NEW.converted_opportunity_id IS DISTINCT FROM OLD.converted_opportunity_id THEN
    UPDATE email_threads
    SET
      opportunity_id = NEW.converted_opportunity_id,
      customer_id = COALESCE(NEW.matched_customer_id, customer_id),
      contact_id = COALESCE(NEW.matched_contact_id, contact_id),
      updated_at = now()
    WHERE inquiry_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS inquiries_link_email_threads_after_conversion ON inquiries;
CREATE TRIGGER inquiries_link_email_threads_after_conversion
AFTER UPDATE OF converted_opportunity_id, matched_customer_id, matched_contact_id ON inquiries
FOR EACH ROW EXECUTE FUNCTION bestcrm_link_converted_inquiry_email_threads();

UPDATE email_threads thread
SET
  opportunity_id = inquiry.converted_opportunity_id,
  customer_id = COALESCE(inquiry.matched_customer_id, thread.customer_id),
  contact_id = COALESCE(inquiry.matched_contact_id, thread.contact_id),
  updated_at = now()
FROM inquiries inquiry
WHERE thread.inquiry_id = inquiry.id
  AND inquiry.converted_opportunity_id IS NOT NULL
  AND thread.opportunity_id IS NULL;
