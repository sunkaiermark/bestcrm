-- Start the eight-hour response clock only for mail received after this release.
-- The migration timestamp in schema_migrations is the activation boundary; old
-- archived mail must not produce a burst of overdue alerts on deployment.
ALTER TABLE email_messages
  ADD COLUMN IF NOT EXISTS mailbox_received_at timestamptz;

COMMENT ON COLUMN email_messages.mailbox_received_at IS
  'IMAP internal date, used for response SLA instead of the sender-controlled Date header.';

CREATE TABLE IF NOT EXISTS email_message_owner_acknowledgments (
  message_id bigint NOT NULL REFERENCES email_messages(id) ON DELETE RESTRICT,
  user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (message_id, user_id)
);

CREATE INDEX IF NOT EXISTS email_messages_inbound_reply_sla_idx
  ON email_messages (COALESCE(mailbox_received_at, created_at), id)
  WHERE direction = 'inbound' AND canonical_message_id IS NULL;

CREATE INDEX IF NOT EXISTS email_messages_outbound_sent_reply_idx
  ON email_messages (thread_id, sent_at, id)
  WHERE direction = 'outbound' AND delivery_status = 'sent'
    AND canonical_message_id IS NULL;

-- A reply must actually be sent to the sender of this inbound message in the
-- same archived conversation. Drafts, failed sends and internal forwards do
-- not close the customer's response clock.
CREATE OR REPLACE FUNCTION bestcrm_email_customer_reply_at(inbound_message_id bigint)
RETURNS timestamptz
LANGUAGE sql
STABLE
AS $$
  SELECT min(outbound.sent_at)
  FROM email_messages inbound
  JOIN email_messages outbound ON outbound.thread_id = inbound.thread_id
  WHERE inbound.id = inbound_message_id
    AND inbound.direction = 'inbound'
    AND outbound.direction = 'outbound'
    AND outbound.canonical_message_id IS NULL
    AND outbound.delivery_status = 'sent'
    AND outbound.sent_at >= COALESCE(inbound.mailbox_received_at, inbound.created_at)
    AND EXISTS (
      SELECT 1
      FROM jsonb_array_elements(outbound.to_recipients || outbound.cc_recipients) recipient(value)
      WHERE lower(btrim(recipient.value->>'address')) = lower(btrim(inbound.from_address))
    );
$$;
