ALTER TABLE inquiries
  ADD COLUMN IF NOT EXISTS company_website text NOT NULL DEFAULT '';
