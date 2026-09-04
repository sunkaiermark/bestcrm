ALTER TABLE quotation_package_documents
  ADD COLUMN IF NOT EXISTS output_profile_revision_no integer,
  ADD COLUMN IF NOT EXISTS source_snapshot_sha256 char(64),
  ADD COLUMN IF NOT EXISTS generation_key char(64);

UPDATE quotation_package_documents document
SET output_profile_revision_no = profile.revision_no,
    source_snapshot_sha256 = document.sha256,
    generation_key = document.sha256
FROM bid_output_profiles profile
WHERE profile.id = document.output_profile_id
  AND (document.output_profile_revision_no IS NULL
    OR document.source_snapshot_sha256 IS NULL
    OR document.generation_key IS NULL);

ALTER TABLE quotation_package_documents
  ALTER COLUMN output_profile_revision_no SET NOT NULL,
  ALTER COLUMN source_snapshot_sha256 SET NOT NULL,
  ALTER COLUMN generation_key SET NOT NULL,
  ADD CONSTRAINT quotation_package_documents_profile_revision_check
    CHECK (output_profile_revision_no > 0),
  ADD CONSTRAINT quotation_package_documents_source_hash_check
    CHECK (source_snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT quotation_package_documents_generation_key_check
    CHECK (generation_key ~ '^[0-9a-f]{64}$');

CREATE INDEX IF NOT EXISTS quotation_package_documents_generation_idx
  ON quotation_package_documents(quotation_package_version_id, generation_key, document_type);

CREATE OR REPLACE FUNCTION validate_quotation_package_document_identity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  profile_revision integer;
BEGIN
  SELECT revision_no INTO profile_revision
  FROM bid_output_profiles WHERE id = NEW.output_profile_id;
  IF profile_revision IS DISTINCT FROM NEW.output_profile_revision_no THEN
    RAISE EXCEPTION 'Quotation package document output profile revision does not match';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS quotation_package_document_identity_guard ON quotation_package_documents;
CREATE TRIGGER quotation_package_document_identity_guard
BEFORE INSERT ON quotation_package_documents
FOR EACH ROW EXECUTE FUNCTION validate_quotation_package_document_identity();

ALTER TABLE bid_package_events
  DROP CONSTRAINT IF EXISTS bid_package_events_event_type_check,
  ADD CONSTRAINT bid_package_events_event_type_check CHECK (event_type IN (
    'variables_saved', 'section_saved', 'section_added', 'section_omitted',
    'section_restored', 'sections_reordered', 'content_selected',
    'attachment_added', 'attachment_removed', 'library_suggestion_created',
    'assignment_added', 'assignment_removed', 'completeness_checked',
    'submitted', 'approved', 'rejected', 'revision_created', 'complete_draft_created',
    'generated_bid_package_outputs', 'downloaded_bid_output'
  ));
