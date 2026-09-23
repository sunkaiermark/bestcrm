CREATE TABLE IF NOT EXISTS opportunity_technical_review_attachments (
  id bigserial PRIMARY KEY,
  technical_draft_id bigint NOT NULL REFERENCES opportunity_technical_drafts(id) ON DELETE RESTRICT,
  attachment_id bigint NOT NULL UNIQUE REFERENCES attachments(id) ON DELETE RESTRICT,
  reviewer_user_id bigint NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS opportunity_technical_review_attachments_draft_idx
  ON opportunity_technical_review_attachments(technical_draft_id, id);

CREATE OR REPLACE FUNCTION validate_opportunity_technical_review_attachment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  draft_row opportunity_technical_drafts%ROWTYPE;
  attachment_row attachments%ROWTYPE;
BEGIN
  SELECT * INTO draft_row FROM opportunity_technical_drafts WHERE id = NEW.technical_draft_id;
  SELECT * INTO attachment_row FROM attachments WHERE id = NEW.attachment_id;
  IF draft_row.id IS NULL OR draft_row.status IS DISTINCT FROM 'pending'
      OR draft_row.source_kind IS DISTINCT FROM 'uploaded_file'
      OR attachment_row.id IS NULL
      OR attachment_row.opportunity_id IS DISTINCT FROM draft_row.opportunity_id
      OR attachment_row.category IS DISTINCT FROM 'technical_review'
      OR attachment_row.uploaded_by IS DISTINCT FROM NEW.reviewer_user_id
      OR attachment_row.retired_at IS NOT NULL THEN
    RAISE EXCEPTION 'Technical review attachment must belong to the pending uploaded draft and reviewer';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER opportunity_technical_review_attachment_validate
BEFORE INSERT ON opportunity_technical_review_attachments
FOR EACH ROW
EXECUTE FUNCTION validate_opportunity_technical_review_attachment();

CREATE TRIGGER opportunity_technical_review_attachment_immutable
BEFORE UPDATE OR DELETE ON opportunity_technical_review_attachments
FOR EACH ROW
EXECUTE FUNCTION protect_opportunity_technical_draft_event();

CREATE OR REPLACE FUNCTION protect_technical_review_attachment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.retired_at IS DISTINCT FROM OLD.retired_at
      AND EXISTS (
        SELECT 1 FROM opportunity_technical_review_attachments
        WHERE attachment_id = OLD.id
      ) THEN
    RAISE EXCEPTION 'A technical review file cannot be retired while linked to the review';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER attachments_technical_review_file_guard
BEFORE UPDATE OF retired_at ON attachments
FOR EACH ROW
EXECUTE FUNCTION protect_technical_review_attachment();
