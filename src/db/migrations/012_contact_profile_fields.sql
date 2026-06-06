ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS education_background text,
  ADD COLUMN IF NOT EXISTS work_experience text,
  ADD COLUMN IF NOT EXISTS key_achievements text;
