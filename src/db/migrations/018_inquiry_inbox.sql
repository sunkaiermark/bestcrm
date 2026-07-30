CREATE TABLE IF NOT EXISTS inquiries (
  id bigserial PRIMARY KEY,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'website', 'email', 'chatwoot')),
  source_reference text NOT NULL DEFAULT '',
  source_received_at timestamptz,
  subject text NOT NULL DEFAULT '',
  company_name text NOT NULL DEFAULT '',
  contact_name text NOT NULL DEFAULT '',
  contact_email text NOT NULL DEFAULT '',
  contact_phone text NOT NULL DEFAULT '',
  country text NOT NULL DEFAULT '',
  product_interest text NOT NULL DEFAULT '',
  requirement_text text NOT NULL,
  raw_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'reviewing', 'converted', 'duplicate', 'spam', 'archived')),
  assigned_user_id bigint REFERENCES users(id) ON DELETE SET NULL,
  matched_customer_id bigint REFERENCES customers(id) ON DELETE SET NULL,
  matched_contact_id bigint REFERENCES contacts(id) ON DELETE SET NULL,
  converted_opportunity_id bigint REFERENCES opportunities(id) ON DELETE SET NULL,
  created_by bigint REFERENCES users(id) ON DELETE SET NULL,
  reviewed_by bigint REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  review_note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inquiries_status_created_idx
  ON inquiries(status, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS inquiries_source_reference_idx
  ON inquiries(source, source_reference)
  WHERE source_reference <> '';

CREATE INDEX IF NOT EXISTS inquiries_assigned_user_idx
  ON inquiries(assigned_user_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS inquiries_contact_email_idx
  ON inquiries(lower(contact_email))
  WHERE contact_email <> '';

CREATE INDEX IF NOT EXISTS inquiries_matched_customer_idx
  ON inquiries(matched_customer_id, created_at DESC, id DESC);
