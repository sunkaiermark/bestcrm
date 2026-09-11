CREATE TABLE IF NOT EXISTS email_message_mailbox_deliveries (
  id bigserial PRIMARY KEY,
  message_id bigint NOT NULL REFERENCES email_messages(id) ON DELETE RESTRICT,
  raw_message_id bigint REFERENCES email_raw_messages(id) ON DELETE RESTRICT,
  mailbox_key text NOT NULL CHECK (btrim(mailbox_key) <> ''),
  provider_name text NOT NULL DEFAULT 'imap' CHECK (
    provider_name ~ '^[a-z][a-z0-9_-]{1,39}$'
  ),
  provider_mailbox text NOT NULL CHECK (btrim(provider_mailbox) <> ''),
  provider_uid_validity text NOT NULL CHECK (btrim(provider_uid_validity) <> ''),
  provider_uid bigint NOT NULL CHECK (provider_uid > 0),
  direction text NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  first_observed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (mailbox_key, provider_mailbox, provider_uid_validity, provider_uid)
);

CREATE UNIQUE INDEX IF NOT EXISTS email_message_mailbox_deliveries_raw_idx
  ON email_message_mailbox_deliveries(raw_message_id)
  WHERE raw_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS email_message_mailbox_deliveries_message_idx
  ON email_message_mailbox_deliveries(message_id, id);

INSERT INTO email_message_mailbox_deliveries (
  message_id,
  raw_message_id,
  mailbox_key,
  provider_name,
  provider_mailbox,
  provider_uid_validity,
  provider_uid,
  direction,
  first_observed_at
)
SELECT
  message.id,
  message.raw_message_id,
  thread.mailbox_key,
  COALESCE(raw.provider_name, 'imap'),
  message.provider_mailbox,
  message.provider_uid_validity,
  message.provider_uid,
  message.direction,
  COALESCE(raw.first_observed_at, message.created_at)
FROM email_messages message
JOIN email_threads thread ON thread.id = message.thread_id
LEFT JOIN email_raw_messages raw ON raw.id = message.raw_message_id
WHERE btrim(message.provider_mailbox) <> ''
  AND btrim(message.provider_uid_validity) <> ''
  AND message.provider_uid IS NOT NULL
ON CONFLICT (mailbox_key, provider_mailbox, provider_uid_validity, provider_uid)
DO NOTHING;

DROP INDEX IF EXISTS email_messages_provider_uid_idx;

CREATE OR REPLACE FUNCTION bestcrm_protect_email_mailbox_delivery()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Email mailbox delivery records are immutable';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS email_message_mailbox_deliveries_no_change
  ON email_message_mailbox_deliveries;
CREATE TRIGGER email_message_mailbox_deliveries_no_change
BEFORE UPDATE OR DELETE ON email_message_mailbox_deliveries
FOR EACH ROW EXECUTE FUNCTION bestcrm_protect_email_mailbox_delivery();
