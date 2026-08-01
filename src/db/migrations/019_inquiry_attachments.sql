CREATE TABLE IF NOT EXISTS inquiry_attachments (
  id bigserial PRIMARY KEY,
  inquiry_id bigint NOT NULL REFERENCES inquiries(id) ON DELETE CASCADE,
  source_index integer NOT NULL DEFAULT 0,
  original_name text NOT NULL,
  stored_path text NOT NULL,
  mime_type text NOT NULL,
  file_size bigint NOT NULL,
  cid text NOT NULL DEFAULT '',
  uploaded_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS inquiry_attachments_source_index_idx
  ON inquiry_attachments(inquiry_id, source_index);

CREATE INDEX IF NOT EXISTS inquiry_attachments_inquiry_idx
  ON inquiry_attachments(inquiry_id, uploaded_at DESC, id DESC);
