CREATE TABLE IF NOT EXISTS mailbox_connections (
  id bigserial PRIMARY KEY,
  provider text NOT NULL CHECK (provider ~ '^[a-z][a-z0-9_-]{1,39}$'),
  mailbox_address text NOT NULL CHECK (
    mailbox_address = lower(btrim(mailbox_address))
    AND mailbox_address ~ '^[^[:space:]@<>]+@[^[:space:]@<>]+\.[^[:space:]@<>]+$'
  ),
  display_name text NOT NULL DEFAULT '',
  auth_type text NOT NULL DEFAULT 'oauth2' CHECK (auth_type = 'oauth2'),
  encrypted_refresh_token jsonb,
  token_key_version integer,
  granted_scopes text[] NOT NULL DEFAULT ARRAY[]::text[],
  connection_status text NOT NULL DEFAULT 'disconnected' CHECK (
    connection_status IN ('disconnected', 'connected', 'degraded', 'revoked')
  ),
  history_cursor text NOT NULL DEFAULT '' CHECK (
    history_cursor = '' OR history_cursor ~ '^[0-9]+$'
  ),
  watch_expires_at timestamptz,
  last_successful_sync_at timestamptz,
  last_error_code text NOT NULL DEFAULT '',
  last_error_at timestamptz,
  authorized_by bigint REFERENCES users(id) ON DELETE SET NULL,
  authorized_at timestamptz,
  revoked_by bigint REFERENCES users(id) ON DELETE SET NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mailbox_connections_id_provider_unique UNIQUE (id, provider),
  CONSTRAINT mailbox_connections_scope_values_check CHECK (
    array_position(granted_scopes, '') IS NULL
  ),
  CONSTRAINT mailbox_connections_token_state_check CHECK (
    (encrypted_refresh_token IS NULL AND token_key_version IS NULL)
    OR (
      encrypted_refresh_token IS NOT NULL
      AND token_key_version > 0
      AND jsonb_typeof(encrypted_refresh_token) = 'object'
      AND encrypted_refresh_token ?& ARRAY['tokenCiphertext', 'tokenNonce', 'tokenAuthTag']
      AND encrypted_refresh_token - ARRAY['tokenCiphertext', 'tokenNonce', 'tokenAuthTag'] = '{}'::jsonb
      AND jsonb_typeof(encrypted_refresh_token -> 'tokenCiphertext') = 'string'
      AND jsonb_typeof(encrypted_refresh_token -> 'tokenNonce') = 'string'
      AND jsonb_typeof(encrypted_refresh_token -> 'tokenAuthTag') = 'string'
      AND encrypted_refresh_token ->> 'tokenCiphertext' ~ '^[A-Za-z0-9+/]+={0,2}$'
      AND encrypted_refresh_token ->> 'tokenNonce' ~ '^[A-Za-z0-9+/]+={0,2}$'
      AND encrypted_refresh_token ->> 'tokenAuthTag' ~ '^[A-Za-z0-9+/]+={0,2}$'
      AND octet_length(decode(encrypted_refresh_token ->> 'tokenCiphertext', 'base64')) > 0
      AND octet_length(decode(encrypted_refresh_token ->> 'tokenNonce', 'base64')) = 12
      AND octet_length(decode(encrypted_refresh_token ->> 'tokenAuthTag', 'base64')) = 16
    )
  ),
  CONSTRAINT mailbox_connections_lifecycle_check CHECK (
    (
      connection_status = 'disconnected'
      AND encrypted_refresh_token IS NULL
      AND authorized_at IS NULL
      AND revoked_at IS NULL
    )
    OR (
      connection_status IN ('connected', 'degraded')
      AND encrypted_refresh_token IS NOT NULL
      AND authorized_at IS NOT NULL
      AND revoked_at IS NULL
    )
    OR (
      connection_status = 'revoked'
      AND encrypted_refresh_token IS NULL
      AND authorized_at IS NOT NULL
      AND revoked_at IS NOT NULL
    )
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS mailbox_connections_provider_mailbox_idx
  ON mailbox_connections(provider, lower(mailbox_address));

CREATE INDEX IF NOT EXISTS mailbox_connections_health_idx
  ON mailbox_connections(connection_status, last_successful_sync_at, id);

CREATE INDEX IF NOT EXISTS mailbox_connections_watch_expiry_idx
  ON mailbox_connections(watch_expires_at)
  WHERE watch_expires_at IS NOT NULL AND connection_status IN ('connected', 'degraded');

ALTER TABLE email_threads
  ADD COLUMN IF NOT EXISTS mailbox_connection_id bigint,
  ADD COLUMN IF NOT EXISTS workflow_status text NOT NULL DEFAULT 'unassigned',
  ADD COLUMN IF NOT EXISTS assigned_user_id bigint,
  ADD COLUMN IF NOT EXISTS assigned_at timestamptz,
  ADD COLUMN IF NOT EXISTS assigned_by bigint,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_by bigint,
  ADD COLUMN IF NOT EXISTS last_inbound_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_outbound_at timestamptz,
  ADD COLUMN IF NOT EXISTS provider_thread_id text NOT NULL DEFAULT '';

ALTER TABLE email_threads
  DROP CONSTRAINT IF EXISTS email_threads_mailbox_connection_fk,
  ADD CONSTRAINT email_threads_mailbox_connection_fk
    FOREIGN KEY (mailbox_connection_id) REFERENCES mailbox_connections(id) ON DELETE RESTRICT,
  DROP CONSTRAINT IF EXISTS email_threads_assigned_user_fk,
  ADD CONSTRAINT email_threads_assigned_user_fk
    FOREIGN KEY (assigned_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  DROP CONSTRAINT IF EXISTS email_threads_assigned_by_fk,
  ADD CONSTRAINT email_threads_assigned_by_fk
    FOREIGN KEY (assigned_by) REFERENCES users(id) ON DELETE RESTRICT,
  DROP CONSTRAINT IF EXISTS email_threads_completed_by_fk,
  ADD CONSTRAINT email_threads_completed_by_fk
    FOREIGN KEY (completed_by) REFERENCES users(id) ON DELETE RESTRICT,
  DROP CONSTRAINT IF EXISTS email_threads_workflow_status_check,
  ADD CONSTRAINT email_threads_workflow_status_check CHECK (
    workflow_status IN ('unassigned', 'assigned', 'waiting_customer', 'completed')
  ),
  DROP CONSTRAINT IF EXISTS email_threads_assignment_state_check,
  ADD CONSTRAINT email_threads_assignment_state_check CHECK (
    (
      workflow_status = 'unassigned'
      AND assigned_user_id IS NULL
      AND assigned_at IS NULL
      AND assigned_by IS NULL
      AND completed_at IS NULL
      AND completed_by IS NULL
    )
    OR (
      workflow_status IN ('assigned', 'waiting_customer')
      AND assigned_user_id IS NOT NULL
      AND assigned_at IS NOT NULL
      AND assigned_by IS NOT NULL
      AND completed_at IS NULL
      AND completed_by IS NULL
    )
    OR (
      workflow_status = 'completed'
      AND assigned_user_id IS NOT NULL
      AND assigned_at IS NOT NULL
      AND assigned_by IS NOT NULL
      AND completed_at IS NOT NULL
      AND completed_by IS NOT NULL
    )
  ),
  DROP CONSTRAINT IF EXISTS email_threads_provider_identity_check,
  ADD CONSTRAINT email_threads_provider_identity_check CHECK (
    btrim(provider_thread_id) = '' OR mailbox_connection_id IS NOT NULL
  );

CREATE INDEX IF NOT EXISTS email_threads_workflow_queue_idx
  ON email_threads(workflow_status, last_message_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS email_threads_assigned_queue_idx
  ON email_threads(assigned_user_id, workflow_status, last_message_at DESC, id DESC)
  WHERE assigned_user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS email_threads_provider_thread_identity_idx
  ON email_threads(mailbox_connection_id, provider_thread_id)
  WHERE mailbox_connection_id IS NOT NULL AND btrim(provider_thread_id) <> '';

ALTER TABLE email_messages
  ADD COLUMN IF NOT EXISTS mailbox_connection_id bigint,
  ADD COLUMN IF NOT EXISTS provider_name text NOT NULL DEFAULT 'imap_smtp',
  ADD COLUMN IF NOT EXISTS provider_thread_id text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS provider_history_id text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS raw_eml_stored_path text,
  ADD COLUMN IF NOT EXISTS raw_eml_file_size bigint,
  ADD COLUMN IF NOT EXISTS raw_eml_sha256 char(64),
  ADD COLUMN IF NOT EXISTS imported_at timestamptz,
  ADD COLUMN IF NOT EXISTS provider_labels jsonb NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE email_messages
  DROP CONSTRAINT IF EXISTS email_messages_mailbox_provider_fk,
  ADD CONSTRAINT email_messages_mailbox_provider_fk
    FOREIGN KEY (mailbox_connection_id, provider_name)
    REFERENCES mailbox_connections(id, provider) ON DELETE RESTRICT,
  DROP CONSTRAINT IF EXISTS email_messages_provider_name_check,
  ADD CONSTRAINT email_messages_provider_name_check CHECK (
    provider_name ~ '^[a-z][a-z0-9_-]{1,39}$'
    AND (provider_name <> 'google_gmail' OR mailbox_connection_id IS NOT NULL)
  ),
  DROP CONSTRAINT IF EXISTS email_messages_provider_history_check,
  ADD CONSTRAINT email_messages_provider_history_check CHECK (
    provider_history_id = '' OR provider_history_id ~ '^[0-9]+$'
  ),
  DROP CONSTRAINT IF EXISTS email_messages_provider_labels_check,
  ADD CONSTRAINT email_messages_provider_labels_check CHECK (
    jsonb_typeof(provider_labels) = 'array'
  ),
  DROP CONSTRAINT IF EXISTS email_messages_raw_eml_state_check,
  ADD CONSTRAINT email_messages_raw_eml_state_check CHECK (
    (
      raw_eml_stored_path IS NULL
      AND raw_eml_file_size IS NULL
      AND raw_eml_sha256 IS NULL
    )
    OR (
      btrim(raw_eml_stored_path) <> ''
      AND raw_eml_file_size > 0
      AND raw_eml_sha256 ~ '^[0-9a-f]{64}$'
    )
  ),
  DROP CONSTRAINT IF EXISTS email_messages_import_completion_check,
  ADD CONSTRAINT email_messages_import_completion_check CHECK (
    imported_at IS NULL OR raw_eml_stored_path IS NOT NULL
  );

CREATE UNIQUE INDEX IF NOT EXISTS email_messages_provider_message_identity_idx
  ON email_messages(mailbox_connection_id, provider_message_id)
  WHERE mailbox_connection_id IS NOT NULL AND btrim(provider_message_id) <> '';

CREATE INDEX IF NOT EXISTS email_messages_provider_history_idx
  ON email_messages(mailbox_connection_id, provider_history_id)
  WHERE mailbox_connection_id IS NOT NULL AND btrim(provider_history_id) <> '';

CREATE UNIQUE INDEX IF NOT EXISTS email_messages_raw_eml_path_idx
  ON email_messages(raw_eml_stored_path)
  WHERE raw_eml_stored_path IS NOT NULL;

CREATE TABLE IF NOT EXISTS email_thread_assignment_events (
  id bigserial PRIMARY KEY,
  thread_id bigint NOT NULL REFERENCES email_threads(id) ON DELETE RESTRICT,
  previous_assigned_user_id bigint REFERENCES users(id) ON DELETE RESTRICT,
  new_assigned_user_id bigint REFERENCES users(id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (
    action IN ('claim', 'assign', 'transfer', 'release', 'wait_customer', 'reopen', 'complete')
  ),
  reason text NOT NULL DEFAULT '',
  acted_by bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT email_thread_assignment_events_transition_check CHECK (
    (
      action IN ('claim', 'assign')
      AND previous_assigned_user_id IS NULL
      AND new_assigned_user_id IS NOT NULL
    )
    OR (
      action = 'transfer'
      AND previous_assigned_user_id IS NOT NULL
      AND new_assigned_user_id IS NOT NULL
      AND previous_assigned_user_id <> new_assigned_user_id
    )
    OR (
      action = 'release'
      AND previous_assigned_user_id IS NOT NULL
      AND new_assigned_user_id IS NULL
    )
    OR (
      action IN ('wait_customer', 'reopen', 'complete')
      AND previous_assigned_user_id IS NOT NULL
      AND new_assigned_user_id = previous_assigned_user_id
    )
  ),
  CONSTRAINT email_thread_assignment_events_reason_check CHECK (
    action NOT IN ('transfer', 'release') OR btrim(reason) <> ''
  )
);

CREATE INDEX IF NOT EXISTS email_thread_assignment_events_thread_idx
  ON email_thread_assignment_events(thread_id, created_at, id);

CREATE INDEX IF NOT EXISTS email_thread_assignment_events_actor_idx
  ON email_thread_assignment_events(acted_by, created_at DESC, id DESC);

CREATE OR REPLACE FUNCTION bestcrm_protect_mailbox_connection_delete()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Mailbox connections cannot be deleted; revoke them instead';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS mailbox_connections_no_delete ON mailbox_connections;
CREATE TRIGGER mailbox_connections_no_delete
BEFORE DELETE ON mailbox_connections
FOR EACH ROW EXECUTE FUNCTION bestcrm_protect_mailbox_connection_delete();

CREATE OR REPLACE FUNCTION bestcrm_protect_email_thread_provider_identity()
RETURNS trigger AS $$
BEGIN
  IF OLD.mailbox_connection_id IS NOT NULL
      AND NEW.mailbox_connection_id IS DISTINCT FROM OLD.mailbox_connection_id THEN
    RAISE EXCEPTION 'Email thread mailbox connection cannot be changed after binding';
  END IF;
  IF btrim(OLD.provider_thread_id) <> ''
      AND NEW.provider_thread_id IS DISTINCT FROM OLD.provider_thread_id THEN
    RAISE EXCEPTION 'Email thread provider identity cannot be changed after binding';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS email_threads_provider_identity_guard ON email_threads;
CREATE TRIGGER email_threads_provider_identity_guard
BEFORE UPDATE OF mailbox_connection_id, provider_thread_id ON email_threads
FOR EACH ROW EXECUTE FUNCTION bestcrm_protect_email_thread_provider_identity();

CREATE OR REPLACE FUNCTION bestcrm_validate_email_message_connection()
RETURNS trigger AS $$
DECLARE
  thread_connection_id bigint;
  thread_provider_id text;
BEGIN
  SELECT mailbox_connection_id, provider_thread_id
  INTO thread_connection_id, thread_provider_id
  FROM email_threads
  WHERE id = NEW.thread_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Email message thread does not exist';
  END IF;
  IF NEW.mailbox_connection_id IS DISTINCT FROM thread_connection_id THEN
    RAISE EXCEPTION 'Email message mailbox connection must match its thread';
  END IF;
  IF btrim(NEW.provider_thread_id) <> ''
      AND btrim(thread_provider_id) <> ''
      AND NEW.provider_thread_id IS DISTINCT FROM thread_provider_id THEN
    RAISE EXCEPTION 'Email message provider thread must match its CRM thread';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS email_messages_connection_guard ON email_messages;
CREATE TRIGGER email_messages_connection_guard
BEFORE INSERT OR UPDATE OF thread_id, mailbox_connection_id, provider_name, provider_thread_id ON email_messages
FOR EACH ROW EXECUTE FUNCTION bestcrm_validate_email_message_connection();

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
  IF OLD.imported_at IS NOT NULL AND NEW.imported_at IS DISTINCT FROM OLD.imported_at THEN
    RAISE EXCEPTION 'Email import completion time is immutable';
  END IF;
  IF OLD.delivery_status = 'sent' AND NEW.delivery_status IS DISTINCT FROM 'sent' THEN
    RAISE EXCEPTION 'Sent email delivery state is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION bestcrm_protect_email_thread_assignment_event()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Email thread assignment events are append-only';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS email_thread_assignment_events_append_only_guard ON email_thread_assignment_events;
CREATE TRIGGER email_thread_assignment_events_append_only_guard
BEFORE UPDATE OR DELETE ON email_thread_assignment_events
FOR EACH ROW EXECUTE FUNCTION bestcrm_protect_email_thread_assignment_event();
