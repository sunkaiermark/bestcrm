ALTER TABLE inquiries
  DROP CONSTRAINT IF EXISTS inquiries_status_check;

ALTER TABLE inquiries
  ADD CONSTRAINT inquiries_status_check
  CHECK (status IN (
    'new',
    'reviewing',
    'customer_approval_pending',
    'converted',
    'contact_saved',
    'customer_saved',
    'duplicate',
    'spam',
    'archived'
  ));

CREATE TABLE IF NOT EXISTS inquiry_customer_approvals (
  id bigserial PRIMARY KEY,
  inquiry_id bigint NOT NULL REFERENCES inquiries(id) ON DELETE CASCADE,
  customer_id bigint NOT NULL REFERENCES customers(id),
  requested_by bigint NOT NULL REFERENCES users(id),
  customer_owner_user_id bigint NOT NULL REFERENCES users(id),
  reviewer_user_id bigint NOT NULL REFERENCES users(id),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  request_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  decision_note text NOT NULL DEFAULT '',
  decided_by bigint REFERENCES users(id),
  decided_at timestamptz,
  converted_opportunity_id bigint REFERENCES opportunities(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS inquiry_customer_approvals_open_idx
  ON inquiry_customer_approvals(inquiry_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS inquiry_customer_approvals_reviewer_idx
  ON inquiry_customer_approvals(reviewer_user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS inquiry_customer_approvals_customer_idx
  ON inquiry_customer_approvals(customer_id, created_at DESC);
