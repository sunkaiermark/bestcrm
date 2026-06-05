CREATE SEQUENCE IF NOT EXISTS opportunity_no_seq
  START WITH 800000
  INCREMENT BY 1
  MINVALUE 1;

SELECT setval(
  'opportunity_no_seq',
  GREATEST(
    799999,
    COALESCE((
      SELECT MAX(opportunity_no::bigint)
      FROM opportunities
      WHERE opportunity_no ~ '^[0-9]{6}$'
    ), 799999)
  ),
  true
);
