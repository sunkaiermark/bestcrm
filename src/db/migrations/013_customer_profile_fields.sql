ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS parent_company text,
  ADD COLUMN IF NOT EXISTS enterprise_nature text,
  ADD COLUMN IF NOT EXISTS company_highlights text;
