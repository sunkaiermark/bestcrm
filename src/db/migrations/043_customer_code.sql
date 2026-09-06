CREATE SEQUENCE IF NOT EXISTS customer_code_seq
  START WITH 1
  INCREMENT BY 1
  MINVALUE 1
  MAXVALUE 999999
  NO CYCLE;

ALTER TABLE customers
  ADD COLUMN IF NOT EXISTS customer_code text;

WITH code_base AS (
  SELECT COALESCE(MAX(substring(customer_code FROM 2)::bigint), 0) AS highest_existing_code
  FROM customers
  WHERE customer_code ~ '^C[0-9]{6}$'
), customers_missing_code AS (
  SELECT
    id,
    row_number() OVER (ORDER BY id) AS code_offset
  FROM customers
  WHERE customer_code IS NULL OR btrim(customer_code) = ''
)
UPDATE customers AS customer
SET customer_code = 'C' || lpad((code_base.highest_existing_code + customers_missing_code.code_offset)::text, 6, '0')
FROM customers_missing_code
CROSS JOIN code_base
WHERE customer.id = customers_missing_code.id;

DO $$
DECLARE
  highest_customer_code bigint;
BEGIN
  SELECT MAX(substring(customer_code FROM 2)::bigint)
  INTO highest_customer_code
  FROM customers
  WHERE customer_code ~ '^C[0-9]{6}$';

  IF highest_customer_code IS NULL THEN
    PERFORM setval('customer_code_seq', 1, false);
  ELSE
    PERFORM setval('customer_code_seq', highest_customer_code, true);
  END IF;
END
$$;

ALTER TABLE customers
  ALTER COLUMN customer_code SET DEFAULT ('C' || lpad(nextval('customer_code_seq')::text, 6, '0')),
  ALTER COLUMN customer_code SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS customers_customer_code_unique_idx
  ON customers(customer_code);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'customers_customer_code_format_check'
      AND conrelid = 'customers'::regclass
  ) THEN
    ALTER TABLE customers
      ADD CONSTRAINT customers_customer_code_format_check
      CHECK (customer_code ~ '^C[0-9]{6}$');
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION bestcrm_protect_customer_code()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.customer_code IS DISTINCT FROM OLD.customer_code THEN
    RAISE EXCEPTION 'customer_code is immutable';
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS customers_protect_customer_code ON customers;

CREATE TRIGGER customers_protect_customer_code
BEFORE UPDATE OF customer_code ON customers
FOR EACH ROW
EXECUTE FUNCTION bestcrm_protect_customer_code();
