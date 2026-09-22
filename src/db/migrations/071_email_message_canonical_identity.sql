CREATE OR REPLACE FUNCTION bestcrm_canonical_email_message_id(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
RETURNS NULL ON NULL INPUT
AS $$
  SELECT lower(btrim(btrim(value), '<>'));
$$;

ALTER TABLE email_messages
  ADD COLUMN IF NOT EXISTS canonical_message_id bigint;

ALTER TABLE email_messages
  ADD CONSTRAINT email_messages_canonical_message_fk
    FOREIGN KEY (canonical_message_id) REFERENCES email_messages(id) ON DELETE RESTRICT,
  ADD CONSTRAINT email_messages_canonical_message_not_self_check
    CHECK (canonical_message_id IS NULL OR canonical_message_id <> id);

COMMENT ON COLUMN email_messages.canonical_message_id IS
  'Points from a preserved duplicate observation to the one canonical CRM message. The duplicate row and its raw evidence remain immutable.';

CREATE INDEX IF NOT EXISTS email_messages_canonical_message_idx
  ON email_messages(canonical_message_id)
  WHERE canonical_message_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS email_message_merge_audits (
  id bigserial PRIMARY KEY,
  canonical_message_id bigint NOT NULL REFERENCES email_messages(id) ON DELETE RESTRICT,
  duplicate_message_id bigint NOT NULL UNIQUE REFERENCES email_messages(id) ON DELETE RESTRICT,
  canonical_rfc_message_id text NOT NULL CHECK (btrim(canonical_rfc_message_id) <> ''),
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(evidence) = 'object'),
  merged_at timestamptz NOT NULL DEFAULT now(),
  CHECK (canonical_message_id <> duplicate_message_id)
);

CREATE INDEX IF NOT EXISTS email_message_merge_audits_canonical_idx
  ON email_message_merge_audits(canonical_message_id, id);

DROP TRIGGER IF EXISTS email_message_merge_audits_no_change ON email_message_merge_audits;
CREATE TRIGGER email_message_merge_audits_no_change
BEFORE UPDATE OR DELETE ON email_message_merge_audits
FOR EACH ROW EXECUTE FUNCTION bestcrm_prevent_email_archive_delete();

CREATE OR REPLACE FUNCTION bestcrm_validate_email_message_alias()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  canonical_row email_messages%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE'
    AND OLD.canonical_message_id IS NOT NULL
    AND NEW.canonical_message_id IS DISTINCT FROM OLD.canonical_message_id THEN
    RAISE EXCEPTION 'Canonical email message aliases are immutable';
  END IF;

  IF NEW.canonical_message_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO canonical_row
  FROM email_messages
  WHERE id = NEW.canonical_message_id;

  IF NOT FOUND OR canonical_row.canonical_message_id IS NOT NULL THEN
    RAISE EXCEPTION 'Canonical email message target must be a canonical archive record';
  END IF;

  IF NEW.id = canonical_row.id
    OR NEW.thread_id IS DISTINCT FROM canonical_row.thread_id
    OR NEW.direction IS DISTINCT FROM canonical_row.direction
    OR bestcrm_canonical_email_message_id(NEW.message_id) = ''
    OR bestcrm_canonical_email_message_id(NEW.message_id)
      IS DISTINCT FROM bestcrm_canonical_email_message_id(canonical_row.message_id) THEN
    RAISE EXCEPTION 'Email message alias must match the canonical thread, direction, and RFC Message-ID';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS email_messages_canonical_alias_guard ON email_messages;
CREATE TRIGGER email_messages_canonical_alias_guard
BEFORE INSERT OR UPDATE OF canonical_message_id ON email_messages
FOR EACH ROW EXECUTE FUNCTION bestcrm_validate_email_message_alias();

DO $$
DECLARE
  duplicate_group record;
  canonical_id bigint;
  duplicate_row email_messages%ROWTYPE;
BEGIN
  FOR duplicate_group IN
    SELECT
      bestcrm_canonical_email_message_id(message.message_id) AS canonical_rfc_message_id,
      count(DISTINCT message.thread_id) AS thread_count,
      count(DISTINCT message.direction) AS direction_count
    FROM email_messages message
    WHERE bestcrm_canonical_email_message_id(message.message_id) <> ''
      AND message.canonical_message_id IS NULL
    GROUP BY bestcrm_canonical_email_message_id(message.message_id)
    HAVING count(*) > 1
    ORDER BY bestcrm_canonical_email_message_id(message.message_id)
  LOOP
    IF duplicate_group.thread_count <> 1 OR duplicate_group.direction_count <> 1 THEN
      RAISE EXCEPTION
        'RFC Message-ID % spans multiple threads or directions and requires manual reconciliation',
        duplicate_group.canonical_rfc_message_id;
    END IF;

    SELECT message.id INTO canonical_id
    FROM email_messages message
    WHERE bestcrm_canonical_email_message_id(message.message_id)
      = duplicate_group.canonical_rfc_message_id
      AND message.canonical_message_id IS NULL
    ORDER BY
      EXISTS (
        SELECT 1 FROM email_outbound_mime_artifacts artifact
        WHERE artifact.message_id = message.id
      ) DESC,
      EXISTS (
        SELECT 1 FROM email_delivery_attempts attempt
        WHERE attempt.message_id = message.id
      ) DESC,
      (btrim(message.provider_message_id) <> '') DESC,
      (message.authored_by IS NOT NULL) DESC,
      message.id
    LIMIT 1;

    FOR duplicate_row IN
      SELECT message.*
      FROM email_messages message
      WHERE bestcrm_canonical_email_message_id(message.message_id)
        = duplicate_group.canonical_rfc_message_id
        AND message.canonical_message_id IS NULL
        AND message.id <> canonical_id
      ORDER BY message.id
    LOOP
      INSERT INTO email_message_merge_audits (
        canonical_message_id,
        duplicate_message_id,
        canonical_rfc_message_id,
        reason,
        evidence
      )
      VALUES (
        canonical_id,
        duplicate_row.id,
        duplicate_group.canonical_rfc_message_id,
        'canonical_rfc_message_id_match',
        jsonb_build_object(
          'duplicateRfcMessageId', duplicate_row.message_id,
          'providerMessageId', NULLIF(duplicate_row.provider_message_id, ''),
          'rawMessageId', duplicate_row.raw_message_id,
          'mailboxDeliveryIds', COALESCE((
            SELECT jsonb_agg(delivery.id ORDER BY delivery.id)
            FROM email_message_mailbox_deliveries delivery
            WHERE delivery.message_id = duplicate_row.id
          ), '[]'::jsonb),
          'attachmentIds', COALESCE((
            SELECT jsonb_agg(attachment.id ORDER BY attachment.id)
            FROM email_attachments attachment
            WHERE attachment.message_id = duplicate_row.id
          ), '[]'::jsonb),
          'deliveryAttemptIds', COALESCE((
            SELECT jsonb_agg(attempt.id ORDER BY attempt.id)
            FROM email_delivery_attempts attempt
            WHERE attempt.message_id = duplicate_row.id
          ), '[]'::jsonb),
          'activityLinkIds', COALESCE((
            SELECT jsonb_agg(activity_link.id ORDER BY activity_link.id)
            FROM opportunity_activity_links activity_link
            WHERE activity_link.email_message_id = duplicate_row.id
          ), '[]'::jsonb),
          'outboundMimeArtifactIds', COALESCE((
            SELECT jsonb_agg(artifact.id ORDER BY artifact.id)
            FROM email_outbound_mime_artifacts artifact
            WHERE artifact.message_id = duplicate_row.id
          ), '[]'::jsonb)
        )
      );

      UPDATE email_messages
      SET canonical_message_id = canonical_id
      WHERE id = duplicate_row.id
        AND canonical_message_id IS NULL;
    END LOOP;
  END LOOP;
END;
$$;

DROP INDEX IF EXISTS email_messages_message_id_idx;
CREATE UNIQUE INDEX email_messages_message_id_idx
  ON email_messages(bestcrm_canonical_email_message_id(message_id))
  WHERE bestcrm_canonical_email_message_id(message_id) <> ''
    AND canonical_message_id IS NULL;
