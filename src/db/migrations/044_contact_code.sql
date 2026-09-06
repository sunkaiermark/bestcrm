CREATE SEQUENCE IF NOT EXISTS contact_code_seq
  START WITH 1
  INCREMENT BY 1
  MINVALUE 1
  MAXVALUE 999999
  NO CYCLE;

ALTER TABLE contacts
  ADD COLUMN IF NOT EXISTS contact_code text;

WITH code_base AS (
  SELECT COALESCE(MAX(substring(contact_code FROM 3)::bigint), 0) AS highest_existing_code
  FROM contacts
  WHERE contact_code ~ '^CT[0-9]{6}$'
), contacts_missing_code AS (
  SELECT
    id,
    row_number() OVER (ORDER BY id) AS code_offset
  FROM contacts
  WHERE contact_code IS NULL OR btrim(contact_code) = ''
)
UPDATE contacts AS contact
SET contact_code = 'CT' || lpad((code_base.highest_existing_code + contacts_missing_code.code_offset)::text, 6, '0')
FROM contacts_missing_code
CROSS JOIN code_base
WHERE contact.id = contacts_missing_code.id;

DO $$
DECLARE
  highest_contact_code bigint;
BEGIN
  SELECT MAX(substring(contact_code FROM 3)::bigint)
  INTO highest_contact_code
  FROM contacts
  WHERE contact_code ~ '^CT[0-9]{6}$';

  IF highest_contact_code IS NULL THEN
    PERFORM setval('contact_code_seq', 1, false);
  ELSE
    PERFORM setval('contact_code_seq', highest_contact_code, true);
  END IF;
END
$$;

ALTER TABLE contacts
  ALTER COLUMN contact_code SET DEFAULT ('CT' || lpad(nextval('contact_code_seq')::text, 6, '0')),
  ALTER COLUMN contact_code SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS contacts_contact_code_unique_idx
  ON contacts(contact_code);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'contacts_contact_code_format_check'
      AND conrelid = 'contacts'::regclass
  ) THEN
    ALTER TABLE contacts
      ADD CONSTRAINT contacts_contact_code_format_check
      CHECK (contact_code ~ '^CT[0-9]{6}$');
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION bestcrm_protect_contact_code()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.contact_code IS DISTINCT FROM OLD.contact_code THEN
    RAISE EXCEPTION 'contact_code is immutable';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS contacts_protect_contact_code ON contacts;

CREATE TRIGGER contacts_protect_contact_code
BEFORE UPDATE OF contact_code ON contacts
FOR EACH ROW
EXECUTE FUNCTION bestcrm_protect_contact_code();
