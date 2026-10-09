ALTER TABLE users
  ADD COLUMN IF NOT EXISTS represented_company_code text NOT NULL DEFAULT 'sunkaier_apac';

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_represented_company_code_check;

ALTER TABLE users
  ADD CONSTRAINT users_represented_company_code_check
  CHECK (represented_company_code IN ('sunkaier_apac', 'sunkaier_china'));
