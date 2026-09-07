ALTER TABLE email_imap_sync_states
  ADD COLUMN IF NOT EXISTS raw_backfill_before_uid bigint,
  ADD COLUMN IF NOT EXISTS raw_backfill_complete boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_raw_backfill_sync_at timestamptz;

ALTER TABLE email_imap_sync_states
  DROP CONSTRAINT IF EXISTS email_imap_sync_states_raw_backfill_before_uid_check,
  ADD CONSTRAINT email_imap_sync_states_raw_backfill_before_uid_check CHECK (
    raw_backfill_before_uid IS NULL OR raw_backfill_before_uid > 0
  );

CREATE INDEX IF NOT EXISTS email_imap_sync_states_raw_backfill_idx
  ON email_imap_sync_states(raw_backfill_complete, raw_backfill_before_uid, id)
  WHERE raw_backfill_complete = false;

COMMENT ON COLUMN email_imap_sync_states.raw_backfill_before_uid IS
  'Independent descending cursor for immutable EML capture; never reuse the parsed-email backfill cursor.';
