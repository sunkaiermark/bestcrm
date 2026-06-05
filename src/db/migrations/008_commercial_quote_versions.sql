ALTER TABLE commercial_quotes
  ADD COLUMN IF NOT EXISTS version_no integer,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS reviewed_by bigint REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS review_comment text;

WITH numbered AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY opportunity_id
      ORDER BY submitted_at ASC, id ASC
    ) AS computed_version_no
  FROM commercial_quotes
  WHERE version_no IS NULL
)
UPDATE commercial_quotes cq
SET version_no = numbered.computed_version_no
FROM numbered
WHERE cq.id = numbered.id;

CREATE UNIQUE INDEX IF NOT EXISTS commercial_quotes_opportunity_version_idx
  ON commercial_quotes(opportunity_id, version_no)
  WHERE version_no IS NOT NULL;
