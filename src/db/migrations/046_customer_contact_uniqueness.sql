CREATE OR REPLACE FUNCTION bestcrm_normalize_identity_text(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  SELECT lower(regexp_replace(btrim(COALESCE(value, '')), '[[:space:]]+', ' ', 'g'));
$$;

CREATE OR REPLACE FUNCTION bestcrm_normalize_phone(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$
  WITH normalized AS (
    SELECT regexp_replace(COALESCE(value, ''), '[^0-9]+', '', 'g') AS digits
  )
  SELECT CASE
    WHEN digits ~ '^0086[1-9][0-9]{10}$' THEN substring(digits FROM 5)
    WHEN digits ~ '^86[1-9][0-9]{10}$' THEN substring(digits FROM 3)
    ELSE digits
  END
  FROM normalized;
$$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM customers
    GROUP BY bestcrm_normalize_identity_text(name)
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate customer unit names exist. Resolve them before applying customer uniqueness.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM contacts
    WHERE bestcrm_normalize_phone(phone) <> ''
    GROUP BY
      customer_id,
      bestcrm_normalize_identity_text(name),
      bestcrm_normalize_phone(phone)
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate contact identities exist. Resolve same-customer, same-name, same-phone records before applying contact uniqueness.';
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS customers_normalized_name_unique_idx
  ON customers (bestcrm_normalize_identity_text(name));

CREATE UNIQUE INDEX IF NOT EXISTS contacts_customer_name_phone_unique_idx
  ON contacts (
    customer_id,
    bestcrm_normalize_identity_text(name),
    bestcrm_normalize_phone(phone)
  )
  WHERE bestcrm_normalize_phone(phone) <> '';
