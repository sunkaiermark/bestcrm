ALTER TABLE technical_solutions
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
  FROM technical_solutions
  WHERE version_no IS NULL
)
UPDATE technical_solutions ts
SET version_no = numbered.computed_version_no
FROM numbered
WHERE ts.id = numbered.id;

CREATE UNIQUE INDEX IF NOT EXISTS technical_solutions_opportunity_version_idx
  ON technical_solutions(opportunity_id, version_no)
  WHERE version_no IS NOT NULL;
