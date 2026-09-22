ALTER TABLE email_attachments
  ADD COLUMN IF NOT EXISTS content_disposition text NOT NULL DEFAULT '';

ALTER TABLE email_attachments
  DROP CONSTRAINT IF EXISTS email_attachments_content_disposition_check,
  ADD CONSTRAINT email_attachments_content_disposition_check
    CHECK (content_disposition IN ('', 'attachment', 'inline'));

COMMENT ON COLUMN email_attachments.content_disposition IS
  'Original MIME Content-Disposition. Blank means legacy/unknown; CID metadata remains available for safe inline inference.';
