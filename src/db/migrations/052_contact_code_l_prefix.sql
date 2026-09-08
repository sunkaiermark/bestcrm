DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM contacts
    WHERE contact_code !~ '^CT[0-9]{6}$'
  ) THEN
    RAISE EXCEPTION 'Cannot migrate contact codes: an unexpected contact_code format exists';
  END IF;
END
$$;

DROP TRIGGER IF EXISTS contacts_protect_contact_code ON contacts;

ALTER TABLE contacts
  DROP CONSTRAINT IF EXISTS contacts_contact_code_format_check;

ALTER TABLE contacts
  ALTER COLUMN contact_code DROP DEFAULT;

UPDATE contacts
SET contact_code = 'L' || substring(contact_code FROM 3)
WHERE contact_code ~ '^CT[0-9]{6}$';

ALTER TABLE contacts
  ALTER COLUMN contact_code SET DEFAULT ('L' || lpad(nextval('contact_code_seq')::text, 6, '0'));

ALTER TABLE contacts
  ADD CONSTRAINT contacts_contact_code_format_check
  CHECK (contact_code ~ '^L[0-9]{6}$');

CREATE TRIGGER contacts_protect_contact_code
BEFORE UPDATE OF contact_code ON contacts
FOR EACH ROW
EXECUTE FUNCTION bestcrm_protect_contact_code();
