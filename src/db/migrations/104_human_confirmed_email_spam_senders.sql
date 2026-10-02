-- Human-confirmed spam senders are exact-address, CRM-wide rules. Keep the
-- rule after the source conversation is purged so repeated mail stays triaged.
CREATE TABLE email_sender_spam_rules (
  sender_address text PRIMARY KEY CHECK (
    sender_address = lower(btrim(sender_address))
    AND sender_address ~ '^[^[:space:]@]+@[^[:space:]@]+$'
  ),
  enabled boolean NOT NULL DEFAULT true,
  confirmed_by bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  confirmed_at timestamptz NOT NULL DEFAULT now(),
  disabled_by bigint REFERENCES users(id) ON DELETE RESTRICT,
  disabled_at timestamptz,
  source_thread_id bigint NOT NULL CHECK (source_thread_id > 0),
  CHECK (
    (enabled AND disabled_by IS NULL AND disabled_at IS NULL)
    OR (NOT enabled AND disabled_by IS NOT NULL AND disabled_at IS NOT NULL)
  )
);

CREATE TABLE email_sender_spam_rule_events (
  id bigserial PRIMARY KEY,
  sender_address text NOT NULL,
  action text NOT NULL CHECK (action IN ('enabled', 'disabled')),
  actor_user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  source_thread_id bigint NOT NULL CHECK (source_thread_id > 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX email_sender_spam_rule_events_sender_idx
  ON email_sender_spam_rule_events(sender_address, id);

CREATE OR REPLACE FUNCTION bestcrm_protect_email_sender_spam_rule_event()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Email sender spam rule events are immutable';
END;
$$;

CREATE TRIGGER email_sender_spam_rule_events_no_change
  BEFORE UPDATE OR DELETE ON email_sender_spam_rule_events
  FOR EACH ROW EXECUTE FUNCTION bestcrm_protect_email_sender_spam_rule_event();
