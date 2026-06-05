ALTER TABLE attachments
  ADD COLUMN IF NOT EXISTS technical_solution_id bigint REFERENCES technical_solutions(id),
  ADD COLUMN IF NOT EXISTS commercial_quote_id bigint REFERENCES commercial_quotes(id),
  ADD COLUMN IF NOT EXISTS contract_approval_id bigint REFERENCES contract_approvals(id);

CREATE INDEX IF NOT EXISTS attachments_technical_solution_idx
  ON attachments(technical_solution_id)
  WHERE technical_solution_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS attachments_commercial_quote_idx
  ON attachments(commercial_quote_id)
  WHERE commercial_quote_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS attachments_contract_approval_idx
  ON attachments(contract_approval_id)
  WHERE contract_approval_id IS NOT NULL;
