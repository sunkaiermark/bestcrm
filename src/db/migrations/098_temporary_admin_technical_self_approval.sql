ALTER TABLE opportunity_technical_drafts
  ADD COLUMN IF NOT EXISTS self_approval_test boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS self_approval_test_until timestamptz;

ALTER TABLE opportunity_technical_drafts
  DROP CONSTRAINT IF EXISTS opportunity_technical_drafts_reviewer_separation_check,
  ADD CONSTRAINT opportunity_technical_drafts_reviewer_separation_check
    CHECK (
      reviewed_by IS NULL OR submitted_by IS NULL OR reviewed_by <> submitted_by
      OR (status = 'approved' AND self_approval_test AND self_approval_test_until IS NOT NULL
        AND reviewed_at IS NOT NULL AND reviewed_at <= self_approval_test_until)
    ) NOT VALID,
  ADD CONSTRAINT opportunity_technical_drafts_self_approval_test_check
    CHECK (
      NOT self_approval_test
      OR (status = 'approved' AND submitted_by IS NOT NULL AND reviewed_by IS NOT NULL
        AND reviewed_by = submitted_by
        AND self_approval_test_until IS NOT NULL
        AND reviewed_at IS NOT NULL AND reviewed_at <= self_approval_test_until)
    ) NOT VALID;

COMMENT ON COLUMN opportunity_technical_drafts.self_approval_test IS
  'Temporary, audited administrator self-approval of the exact submitted technical draft; controlled customer issuance is prohibited.';
