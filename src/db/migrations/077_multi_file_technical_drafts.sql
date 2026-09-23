CREATE TABLE IF NOT EXISTS opportunity_technical_draft_attachments (
  id bigserial PRIMARY KEY,
  technical_draft_id bigint NOT NULL REFERENCES opportunity_technical_drafts(id) ON DELETE RESTRICT,
  attachment_id bigint NOT NULL UNIQUE REFERENCES attachments(id) ON DELETE RESTRICT,
  sort_order integer NOT NULL CHECK (sort_order > 0),
  added_by bigint NOT NULL REFERENCES users(id),
  added_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (technical_draft_id, sort_order)
);

CREATE INDEX IF NOT EXISTS opportunity_technical_draft_attachments_draft_idx
  ON opportunity_technical_draft_attachments(technical_draft_id, sort_order, id);

INSERT INTO opportunity_technical_draft_attachments (
  technical_draft_id, attachment_id, sort_order, added_by, added_at
)
SELECT id, uploaded_attachment_id, 1, updated_by, updated_at
FROM opportunity_technical_drafts
WHERE source_kind = 'uploaded_file'
  AND uploaded_attachment_id IS NOT NULL
ON CONFLICT DO NOTHING;

CREATE OR REPLACE FUNCTION validate_opportunity_technical_draft_attachment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  draft_row opportunity_technical_drafts%ROWTYPE;
  attachment_row attachments%ROWTYPE;
BEGIN
  SELECT * INTO draft_row
  FROM opportunity_technical_drafts
  WHERE id = NEW.technical_draft_id;

  SELECT * INTO attachment_row
  FROM attachments
  WHERE id = NEW.attachment_id;

  IF draft_row.id IS NULL
      OR draft_row.source_kind IS DISTINCT FROM 'uploaded_file'
      OR draft_row.status NOT IN ('draft', 'ready')
      OR attachment_row.id IS NULL
      OR attachment_row.opportunity_id IS DISTINCT FROM draft_row.opportunity_id
      OR attachment_row.category IS DISTINCT FROM 'technical_solution'
      OR attachment_row.retired_at IS NOT NULL
      OR attachment_row.opportunity_material_version_id IS NOT NULL THEN
    RAISE EXCEPTION 'Technical draft attachments must be active unbound technical files for the editable draft';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS opportunity_technical_draft_attachment_validate
  ON opportunity_technical_draft_attachments;

CREATE TRIGGER opportunity_technical_draft_attachment_validate
BEFORE INSERT ON opportunity_technical_draft_attachments
FOR EACH ROW
EXECUTE FUNCTION validate_opportunity_technical_draft_attachment();

DROP TRIGGER IF EXISTS opportunity_technical_draft_attachment_immutable
  ON opportunity_technical_draft_attachments;

CREATE TRIGGER opportunity_technical_draft_attachment_immutable
BEFORE UPDATE OR DELETE ON opportunity_technical_draft_attachments
FOR EACH ROW
EXECUTE FUNCTION protect_opportunity_technical_draft_event();

CREATE OR REPLACE FUNCTION protect_technical_draft_attachment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE'
      AND NEW.retired_at IS DISTINCT FROM OLD.retired_at
      AND (
        EXISTS (
          SELECT 1
          FROM opportunity_technical_drafts draft
          WHERE draft.uploaded_attachment_id = OLD.id
            AND draft.status NOT IN ('draft', 'ready')
        )
        OR EXISTS (
          SELECT 1
          FROM opportunity_technical_draft_attachments link
          JOIN opportunity_technical_drafts draft ON draft.id = link.technical_draft_id
          WHERE link.attachment_id = OLD.id
            AND draft.status NOT IN ('draft', 'ready')
        )
      ) THEN
    RAISE EXCEPTION 'A submitted technical draft file cannot be retired';
  END IF;
  RETURN NEW;
END;
$$;

ALTER TABLE technical_solution_documents
  DROP CONSTRAINT IF EXISTS technical_solution_documents_technical_draft_id_format_key;

CREATE UNIQUE INDEX IF NOT EXISTS technical_solution_documents_generated_format_idx
  ON technical_solution_documents(technical_draft_id, format)
  WHERE format IN ('docx', 'pdf');

CREATE UNIQUE INDEX IF NOT EXISTS technical_solution_documents_uploaded_file_idx
  ON technical_solution_documents(technical_draft_id, format, original_name, sha256)
  WHERE format = 'uploaded';
