CREATE TABLE IF NOT EXISTS opportunity_material_versions (
  id bigserial PRIMARY KEY,
  opportunity_id bigint NOT NULL REFERENCES opportunities(id) ON DELETE CASCADE,
  material_type text NOT NULL,
  version_no integer NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  submitted_by bigint REFERENCES users(id),
  submitted_at timestamptz,
  reviewed_by bigint REFERENCES users(id),
  reviewed_at timestamptz,
  review_comment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT opportunity_material_versions_material_type_check
    CHECK (material_type IN ('technical_solution', 'commercial_quote', 'contract')),
  CONSTRAINT opportunity_material_versions_status_check
    CHECK (status IN ('draft', 'pending', 'approved', 'rejected', 'withdrawn')),
  UNIQUE (opportunity_id, material_type, version_no)
);

CREATE INDEX IF NOT EXISTS opportunity_material_versions_opportunity_type_idx
  ON opportunity_material_versions(opportunity_id, material_type);

