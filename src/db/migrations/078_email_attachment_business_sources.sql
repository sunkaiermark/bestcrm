ALTER TABLE email_attachments
  ADD COLUMN IF NOT EXISTS source_opportunity_attachment_id bigint
    REFERENCES attachments(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS source_technical_document_id bigint
    REFERENCES technical_solution_documents(id) ON DELETE RESTRICT;

ALTER TABLE email_attachments
  DROP CONSTRAINT IF EXISTS email_attachments_single_business_source_check,
  ADD CONSTRAINT email_attachments_single_business_source_check
    CHECK (num_nonnulls(
      source_opportunity_attachment_id,
      source_technical_document_id
    ) <= 1);

CREATE INDEX IF NOT EXISTS email_attachments_source_opportunity_attachment_idx
  ON email_attachments(source_opportunity_attachment_id)
  WHERE source_opportunity_attachment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS email_attachments_source_technical_document_idx
  ON email_attachments(source_technical_document_id)
  WHERE source_technical_document_id IS NOT NULL;

COMMENT ON COLUMN email_attachments.source_opportunity_attachment_id IS
  'Approved opportunity attachment selected as the source for this immutable outbound email copy.';

COMMENT ON COLUMN email_attachments.source_technical_document_id IS
  'Approved technical solution document selected as the source for this immutable outbound email copy.';
