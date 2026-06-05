ALTER TABLE roles
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;
