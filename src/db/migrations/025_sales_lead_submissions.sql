ALTER TABLE inquiries
  ADD COLUMN IF NOT EXISTS submission_type text NOT NULL DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS source_channel text NOT NULL DEFAULT 'other',
  ADD COLUMN IF NOT EXISTS recommended_salesperson_id bigint REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE inquiries
  ADD CONSTRAINT inquiries_submission_type_check
  CHECK (submission_type IN ('standard', 'sales_lead'));

ALTER TABLE inquiries
  ADD CONSTRAINT inquiries_source_channel_check
  CHECK (source_channel IN (
    'manual',
    'website',
    'email',
    'chatwoot',
    'exhibition',
    'referral',
    'linkedin',
    'whatsapp',
    'phone',
    'partner',
    'existing_customer',
    'other'
  ));

UPDATE inquiries
SET source_channel = CASE
  WHEN source IN ('manual', 'website', 'email', 'chatwoot') THEN source
  ELSE 'other'
END
WHERE source_channel = 'other';

CREATE INDEX IF NOT EXISTS inquiries_creator_submission_idx
  ON inquiries(created_by, submission_type, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS inquiries_recommended_salesperson_idx
  ON inquiries(recommended_salesperson_id, created_at DESC, id DESC)
  WHERE recommended_salesperson_id IS NOT NULL;

ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS origin_inquiry_id bigint REFERENCES inquiries(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX IF NOT EXISTS opportunities_origin_inquiry_unique_idx
  ON opportunities(origin_inquiry_id)
  WHERE origin_inquiry_id IS NOT NULL;
