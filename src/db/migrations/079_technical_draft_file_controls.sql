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

  IF EXISTS (
    SELECT 1
    FROM opportunity_technical_draft_attachments existing_link
    JOIN attachments existing_attachment ON existing_attachment.id = existing_link.attachment_id
    WHERE existing_link.technical_draft_id = NEW.technical_draft_id
      AND existing_attachment.retired_at IS NULL
      AND (
        lower(btrim(existing_attachment.original_name)) = lower(btrim(attachment_row.original_name))
        OR (
          attachment_row.sha256 IS NOT NULL
          AND existing_attachment.sha256 = attachment_row.sha256
        )
      )
  ) THEN
    RAISE unique_violation
      USING MESSAGE = 'Duplicate technical draft file in the same version',
            CONSTRAINT = 'opportunity_technical_draft_attachments_unique_file';
  END IF;

  RETURN NEW;
END;
$$;
