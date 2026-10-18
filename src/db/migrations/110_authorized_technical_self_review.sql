ALTER TABLE opportunity_technical_drafts
  ADD COLUMN IF NOT EXISTS authorized_self_review boolean NOT NULL DEFAULT false;

ALTER TABLE opportunity_technical_drafts
  DROP CONSTRAINT IF EXISTS opportunity_technical_drafts_reviewer_separation_check,
  ADD CONSTRAINT opportunity_technical_drafts_reviewer_separation_check
    CHECK (
      reviewed_by IS NULL OR submitted_by IS NULL OR reviewed_by <> submitted_by
      OR authorized_self_review
      OR (status = 'approved' AND self_approval_test AND self_approval_test_until IS NOT NULL
        AND reviewed_at IS NOT NULL AND reviewed_at <= self_approval_test_until)
    ) NOT VALID,
  ADD CONSTRAINT opportunity_technical_drafts_authorized_self_review_check
    CHECK (
      NOT authorized_self_review
      OR (status IN ('approved', 'rejected')
        AND submitted_by IS NOT NULL AND reviewed_by IS NOT NULL
        AND reviewed_by = submitted_by
        AND reviewed_at IS NOT NULL
        AND NOT self_approval_test)
    ) NOT VALID;

COMMENT ON COLUMN opportunity_technical_drafts.authorized_self_review IS
  'Audited self-review by the assigned technical approver who holds both administrator and technical-manager roles.';
