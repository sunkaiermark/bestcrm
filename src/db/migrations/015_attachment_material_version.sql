ALTER TABLE attachments
  ADD COLUMN IF NOT EXISTS opportunity_material_version_id bigint;

ALTER TABLE attachments
  DROP CONSTRAINT IF EXISTS attachments_opportunity_material_version_fk,
  ADD CONSTRAINT attachments_opportunity_material_version_fk
    FOREIGN KEY (opportunity_material_version_id)
    REFERENCES opportunity_material_versions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS attachments_material_version_idx
  ON attachments(opportunity_material_version_id);

CREATE INDEX IF NOT EXISTS attachments_unbound_material_idx
  ON attachments(opportunity_id, category, uploaded_at, id)
  WHERE opportunity_material_version_id IS NULL;

