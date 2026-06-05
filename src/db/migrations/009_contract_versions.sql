ALTER TABLE contract_approvals
  ADD COLUMN IF NOT EXISTS version_no integer;

WITH numbered AS (
  SELECT
    id,
    ROW_NUMBER() OVER (
      PARTITION BY opportunity_id
      ORDER BY submitted_at ASC, id ASC
    ) AS computed_version_no
  FROM contract_approvals
  WHERE version_no IS NULL
)
UPDATE contract_approvals ca
SET version_no = numbered.computed_version_no
FROM numbered
WHERE ca.id = numbered.id;

CREATE UNIQUE INDEX IF NOT EXISTS contract_approvals_opportunity_version_idx
  ON contract_approvals(opportunity_id, version_no)
  WHERE version_no IS NOT NULL;
