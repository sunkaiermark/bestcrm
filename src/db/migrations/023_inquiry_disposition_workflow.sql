ALTER TABLE inquiries
  ADD COLUMN IF NOT EXISTS opportunity_type text NOT NULL DEFAULT '';

ALTER TABLE opportunities
  ADD COLUMN IF NOT EXISTS product_interest text NOT NULL DEFAULT '';

ALTER TABLE inquiries
  DROP CONSTRAINT IF EXISTS inquiries_status_check;

ALTER TABLE inquiries
  ADD CONSTRAINT inquiries_status_check
  CHECK (status IN (
    'new',
    'reviewing',
    'converted',
    'contact_saved',
    'customer_saved',
    'duplicate',
    'spam',
    'archived'
  ));
