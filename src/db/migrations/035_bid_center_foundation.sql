CREATE TABLE IF NOT EXISTS commercial_package_templates (
  id bigserial PRIMARY KEY,
  template_code text NOT NULL UNIQUE CHECK (template_code ~ '^[A-Z][A-Z0-9-]{0,31}$'),
  name_en text NOT NULL CHECK (btrim(name_en) <> ''),
  name_zh text NOT NULL CHECK (btrim(name_zh) <> ''),
  language text NOT NULL CHECK (language IN ('en', 'zh', 'bilingual')),
  applicable_countries jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(applicable_countries) = 'array'),
  applicable_industries jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(applicable_industries) = 'array'),
  applicable_customer_types jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(applicable_customer_types) = 'array'),
  current_published_revision_id bigint,
  is_active boolean NOT NULL DEFAULT true,
  created_by bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS commercial_package_template_revisions (
  id bigserial PRIMARY KEY,
  template_id bigint NOT NULL REFERENCES commercial_package_templates(id) ON DELETE RESTRICT,
  revision_no integer NOT NULL CHECK (revision_no > 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'review_pending', 'published', 'retired')),
  change_summary text NOT NULL CHECK (btrim(change_summary) <> ''),
  content_schema jsonb NOT NULL DEFAULT '{"schemaVersion":1,"sections":[]}'::jsonb
    CHECK (jsonb_typeof(content_schema) = 'object'),
  variable_schema jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(variable_schema) = 'array'),
  validation_rules jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(validation_rules) = 'object'),
  created_by bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  submitted_by bigint REFERENCES users(id) ON DELETE RESTRICT,
  submitted_at timestamptz,
  published_by bigint REFERENCES users(id) ON DELETE RESTRICT,
  published_at timestamptz,
  retired_by bigint REFERENCES users(id) ON DELETE RESTRICT,
  retired_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (template_id, revision_no),
  CONSTRAINT commercial_package_template_revisions_lifecycle_check CHECK (
    status = 'draft'
    OR (status = 'review_pending' AND submitted_by IS NOT NULL AND submitted_at IS NOT NULL)
    OR (
      status = 'published'
      AND submitted_by IS NOT NULL AND submitted_at IS NOT NULL
      AND published_by IS NOT NULL AND published_at IS NOT NULL
    )
    OR (
      status = 'retired'
      AND submitted_by IS NOT NULL AND submitted_at IS NOT NULL
      AND published_by IS NOT NULL AND published_at IS NOT NULL
      AND retired_by IS NOT NULL AND retired_at IS NOT NULL
    )
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS commercial_package_template_revision_identity_idx
  ON commercial_package_template_revisions(id, template_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'commercial_package_templates_current_revision_owner_fk'
  ) THEN
    ALTER TABLE commercial_package_templates
      ADD CONSTRAINT commercial_package_templates_current_revision_owner_fk
      FOREIGN KEY (current_published_revision_id, id)
      REFERENCES commercial_package_template_revisions(id, template_id)
      ON DELETE RESTRICT;
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS commercial_package_template_open_revision_idx
  ON commercial_package_template_revisions(template_id)
  WHERE status IN ('draft', 'review_pending');

CREATE UNIQUE INDEX IF NOT EXISTS commercial_package_template_published_revision_idx
  ON commercial_package_template_revisions(template_id)
  WHERE status = 'published';

CREATE INDEX IF NOT EXISTS commercial_package_templates_lookup_idx
  ON commercial_package_templates(is_active, language, template_code);

CREATE OR REPLACE FUNCTION protect_commercial_package_template_revision()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status <> 'draft' THEN
    RAISE EXCEPTION 'Commercial template revisions must be created as drafts';
  END IF;
  IF TG_OP = 'DELETE' AND OLD.status <> 'draft' THEN
    RAISE EXCEPTION 'Submitted or published commercial template revisions cannot be deleted';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status <> 'draft' AND (
    NEW.template_id IS DISTINCT FROM OLD.template_id OR
    NEW.revision_no IS DISTINCT FROM OLD.revision_no OR
    NEW.change_summary IS DISTINCT FROM OLD.change_summary OR
    NEW.content_schema IS DISTINCT FROM OLD.content_schema OR
    NEW.variable_schema IS DISTINCT FROM OLD.variable_schema OR
    NEW.validation_rules IS DISTINCT FROM OLD.validation_rules OR
    NEW.created_by IS DISTINCT FROM OLD.created_by OR
    NEW.created_at IS DISTINCT FROM OLD.created_at
  ) THEN
    RAISE EXCEPTION 'Submitted or published commercial template revision content is immutable';
  END IF;
  IF TG_OP = 'UPDATE'
      AND (
        (OLD.status = 'draft' AND NEW.status NOT IN ('draft', 'review_pending'))
        OR (OLD.status = 'review_pending' AND NEW.status NOT IN ('draft', 'review_pending', 'published'))
      ) THEN
    RAISE EXCEPTION 'Commercial template revision status transition is invalid';
  END IF;
  IF TG_OP = 'UPDATE'
      AND OLD.status = 'published'
      AND NEW.status NOT IN ('published', 'retired') THEN
    RAISE EXCEPTION 'Published commercial template revisions can only be retired';
  END IF;
  IF TG_OP = 'UPDATE'
      AND OLD.status = 'retired'
      AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'Retired commercial template revisions cannot change status';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status <> 'draft'
      AND (
        NEW.submitted_by IS DISTINCT FROM OLD.submitted_by
        OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at
        OR (
          OLD.status IN ('published', 'retired')
          AND (
            NEW.published_by IS DISTINCT FROM OLD.published_by
            OR NEW.published_at IS DISTINCT FROM OLD.published_at
          )
        )
        OR (
          OLD.status = 'retired'
          AND (
            NEW.retired_by IS DISTINCT FROM OLD.retired_by
            OR NEW.retired_at IS DISTINCT FROM OLD.retired_at
          )
        )
      ) THEN
    RAISE EXCEPTION 'Commercial template revision approval audit is immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS commercial_package_template_revision_immutable_guard
  ON commercial_package_template_revisions;
CREATE TRIGGER commercial_package_template_revision_immutable_guard
BEFORE INSERT OR UPDATE OR DELETE ON commercial_package_template_revisions
FOR EACH ROW EXECUTE FUNCTION protect_commercial_package_template_revision();

CREATE TABLE IF NOT EXISTS bid_content_blocks (
  id bigserial PRIMARY KEY,
  block_code text NOT NULL UNIQUE CHECK (block_code ~ '^[A-Z][A-Z0-9-]{0,31}$'),
  category text NOT NULL CHECK (category IN ('technical', 'commercial', 'common')),
  name_en text NOT NULL CHECK (btrim(name_en) <> ''),
  name_zh text NOT NULL CHECK (btrim(name_zh) <> ''),
  applicable_countries jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(applicable_countries) = 'array'),
  applicable_industries jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(applicable_industries) = 'array'),
  applicable_product_families jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(applicable_product_families) = 'array'),
  applicable_customer_types jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(applicable_customer_types) = 'array'),
  applicable_sections jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(applicable_sections) = 'array'),
  owner_role_code text NOT NULL REFERENCES roles(code) ON DELETE RESTRICT,
  current_published_revision_id bigint,
  is_active boolean NOT NULL DEFAULT true,
  created_by bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS bid_content_block_revisions (
  id bigserial PRIMARY KEY,
  content_block_id bigint NOT NULL REFERENCES bid_content_blocks(id) ON DELETE RESTRICT,
  revision_no integer NOT NULL CHECK (revision_no > 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'review_pending', 'published', 'retired')),
  language text NOT NULL CHECK (language IN ('en', 'zh', 'bilingual')),
  component_type text NOT NULL CHECK (component_type IN (
    'narrative', 'parameter_table', 'equipment_table', 'materials_table',
    'instrumentation_table', 'electrical_table', 'utilities_table', 'scope_matrix',
    'quotation_table', 'deviation_table', 'image', 'controlled_attachment',
    'page_break', 'toc_control'
  )),
  title_en text NOT NULL DEFAULT '',
  title_zh text NOT NULL DEFAULT '',
  content_schema jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(content_schema) = 'object'),
  condition_schema jsonb NOT NULL DEFAULT '{"all":[]}'::jsonb CHECK (jsonb_typeof(condition_schema) = 'object'),
  allowed_variables jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(allowed_variables) = 'array'),
  source_metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(source_metadata) = 'object'),
  attachment_stored_path text,
  attachment_original_name text,
  attachment_mime_type text,
  attachment_byte_size bigint,
  attachment_sha256 char(64),
  effective_date date,
  expires_at date,
  review_due_at date,
  sensitivity text NOT NULL DEFAULT 'internal' CHECK (sensitivity IN ('public', 'internal', 'confidential', 'restricted')),
  change_summary text NOT NULL CHECK (btrim(change_summary) <> ''),
  created_by bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  submitted_by bigint REFERENCES users(id) ON DELETE RESTRICT,
  submitted_at timestamptz,
  published_by bigint REFERENCES users(id) ON DELETE RESTRICT,
  published_at timestamptz,
  retired_by bigint REFERENCES users(id) ON DELETE RESTRICT,
  retired_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (content_block_id, revision_no),
  CONSTRAINT bid_content_block_revisions_lifecycle_check CHECK (
    status = 'draft'
    OR (status = 'review_pending' AND submitted_by IS NOT NULL AND submitted_at IS NOT NULL)
    OR (
      status = 'published'
      AND submitted_by IS NOT NULL AND submitted_at IS NOT NULL
      AND published_by IS NOT NULL AND published_at IS NOT NULL
    )
    OR (
      status = 'retired'
      AND submitted_by IS NOT NULL AND submitted_at IS NOT NULL
      AND published_by IS NOT NULL AND published_at IS NOT NULL
      AND retired_by IS NOT NULL AND retired_at IS NOT NULL
    )
  ),
  CONSTRAINT bid_content_block_revision_attachment_check CHECK (
    (
      attachment_stored_path IS NULL AND attachment_original_name IS NULL
      AND attachment_mime_type IS NULL AND attachment_byte_size IS NULL
      AND attachment_sha256 IS NULL
    )
    OR (
      attachment_stored_path IS NOT NULL AND btrim(attachment_stored_path) <> ''
      AND attachment_original_name IS NOT NULL AND btrim(attachment_original_name) <> ''
      AND attachment_mime_type IS NOT NULL AND btrim(attachment_mime_type) <> ''
      AND attachment_byte_size > 0
      AND attachment_sha256 ~ '^[0-9a-f]{64}$'
    )
  ),
  CONSTRAINT bid_content_block_revision_component_attachment_check CHECK (
    component_type NOT IN ('image', 'controlled_attachment') OR attachment_sha256 IS NOT NULL
  ),
  CONSTRAINT bid_content_block_revision_dates_check CHECK (
    expires_at IS NULL OR effective_date IS NULL OR expires_at >= effective_date
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS bid_content_block_revision_identity_idx
  ON bid_content_block_revisions(id, content_block_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'bid_content_blocks_current_revision_owner_fk'
  ) THEN
    ALTER TABLE bid_content_blocks
      ADD CONSTRAINT bid_content_blocks_current_revision_owner_fk
      FOREIGN KEY (current_published_revision_id, id)
      REFERENCES bid_content_block_revisions(id, content_block_id)
      ON DELETE RESTRICT;
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS bid_content_block_open_revision_idx
  ON bid_content_block_revisions(content_block_id)
  WHERE status IN ('draft', 'review_pending');

CREATE UNIQUE INDEX IF NOT EXISTS bid_content_block_published_revision_idx
  ON bid_content_block_revisions(content_block_id)
  WHERE status = 'published';

CREATE INDEX IF NOT EXISTS bid_content_blocks_lookup_idx
  ON bid_content_blocks(category, is_active, block_code);

CREATE OR REPLACE FUNCTION protect_bid_content_block_revision()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status <> 'draft' THEN
    RAISE EXCEPTION 'Bid content revisions must be created as drafts';
  END IF;
  IF TG_OP = 'DELETE' AND OLD.status <> 'draft' THEN
    RAISE EXCEPTION 'Submitted or published bid content revisions cannot be deleted';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status <> 'draft' AND (
    NEW.content_block_id IS DISTINCT FROM OLD.content_block_id OR
    NEW.revision_no IS DISTINCT FROM OLD.revision_no OR
    NEW.language IS DISTINCT FROM OLD.language OR
    NEW.component_type IS DISTINCT FROM OLD.component_type OR
    NEW.title_en IS DISTINCT FROM OLD.title_en OR
    NEW.title_zh IS DISTINCT FROM OLD.title_zh OR
    NEW.content_schema IS DISTINCT FROM OLD.content_schema OR
    NEW.condition_schema IS DISTINCT FROM OLD.condition_schema OR
    NEW.allowed_variables IS DISTINCT FROM OLD.allowed_variables OR
    NEW.source_metadata IS DISTINCT FROM OLD.source_metadata OR
    NEW.attachment_stored_path IS DISTINCT FROM OLD.attachment_stored_path OR
    NEW.attachment_original_name IS DISTINCT FROM OLD.attachment_original_name OR
    NEW.attachment_mime_type IS DISTINCT FROM OLD.attachment_mime_type OR
    NEW.attachment_byte_size IS DISTINCT FROM OLD.attachment_byte_size OR
    NEW.attachment_sha256 IS DISTINCT FROM OLD.attachment_sha256 OR
    NEW.effective_date IS DISTINCT FROM OLD.effective_date OR
    NEW.expires_at IS DISTINCT FROM OLD.expires_at OR
    NEW.review_due_at IS DISTINCT FROM OLD.review_due_at OR
    NEW.sensitivity IS DISTINCT FROM OLD.sensitivity OR
    NEW.change_summary IS DISTINCT FROM OLD.change_summary OR
    NEW.created_by IS DISTINCT FROM OLD.created_by OR
    NEW.created_at IS DISTINCT FROM OLD.created_at
  ) THEN
    RAISE EXCEPTION 'Submitted or published bid content revision is immutable';
  END IF;
  IF TG_OP = 'UPDATE'
      AND (
        (OLD.status = 'draft' AND NEW.status NOT IN ('draft', 'review_pending'))
        OR (OLD.status = 'review_pending' AND NEW.status NOT IN ('draft', 'review_pending', 'published'))
      ) THEN
    RAISE EXCEPTION 'Bid content revision status transition is invalid';
  END IF;
  IF TG_OP = 'UPDATE'
      AND OLD.status = 'published'
      AND NEW.status NOT IN ('published', 'retired') THEN
    RAISE EXCEPTION 'Published bid content revisions can only be retired';
  END IF;
  IF TG_OP = 'UPDATE'
      AND OLD.status = 'retired'
      AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'Retired bid content revisions cannot change status';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status <> 'draft'
      AND (
        NEW.submitted_by IS DISTINCT FROM OLD.submitted_by
        OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at
        OR (
          OLD.status IN ('published', 'retired')
          AND (
            NEW.published_by IS DISTINCT FROM OLD.published_by
            OR NEW.published_at IS DISTINCT FROM OLD.published_at
          )
        )
        OR (
          OLD.status = 'retired'
          AND (
            NEW.retired_by IS DISTINCT FROM OLD.retired_by
            OR NEW.retired_at IS DISTINCT FROM OLD.retired_at
          )
        )
      ) THEN
    RAISE EXCEPTION 'Bid content revision approval audit is immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bid_content_block_revision_immutable_guard
  ON bid_content_block_revisions;
CREATE TRIGGER bid_content_block_revision_immutable_guard
BEFORE INSERT OR UPDATE OR DELETE ON bid_content_block_revisions
FOR EACH ROW EXECUTE FUNCTION protect_bid_content_block_revision();

CREATE TABLE IF NOT EXISTS bid_output_profiles (
  id bigserial PRIMARY KEY,
  profile_code text NOT NULL CHECK (profile_code ~ '^[A-Z][A-Z0-9-]{0,31}$'),
  revision_no integer NOT NULL CHECK (revision_no > 0),
  name_en text NOT NULL CHECK (btrim(name_en) <> ''),
  name_zh text NOT NULL CHECK (btrim(name_zh) <> ''),
  language_mode text NOT NULL CHECK (language_mode IN ('en', 'zh', 'bilingual')),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'review_pending', 'published', 'retired')),
  layout_settings jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(layout_settings) = 'object'),
  brand_assets jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(brand_assets) = 'object'),
  change_summary text NOT NULL CHECK (btrim(change_summary) <> ''),
  created_by bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  submitted_by bigint REFERENCES users(id) ON DELETE RESTRICT,
  submitted_at timestamptz,
  published_by bigint REFERENCES users(id) ON DELETE RESTRICT,
  published_at timestamptz,
  retired_by bigint REFERENCES users(id) ON DELETE RESTRICT,
  retired_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (profile_code, revision_no),
  CONSTRAINT bid_output_profiles_lifecycle_check CHECK (
    status = 'draft'
    OR (status = 'review_pending' AND submitted_by IS NOT NULL AND submitted_at IS NOT NULL)
    OR (
      status = 'published'
      AND submitted_by IS NOT NULL AND submitted_at IS NOT NULL
      AND published_by IS NOT NULL AND published_at IS NOT NULL
    )
    OR (
      status = 'retired'
      AND submitted_by IS NOT NULL AND submitted_at IS NOT NULL
      AND published_by IS NOT NULL AND published_at IS NOT NULL
      AND retired_by IS NOT NULL AND retired_at IS NOT NULL
    )
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS bid_output_profile_open_revision_idx
  ON bid_output_profiles(profile_code)
  WHERE status IN ('draft', 'review_pending');

CREATE UNIQUE INDEX IF NOT EXISTS bid_output_profile_published_revision_idx
  ON bid_output_profiles(profile_code)
  WHERE status = 'published';

CREATE INDEX IF NOT EXISTS bid_output_profiles_lookup_idx
  ON bid_output_profiles(status, language_mode, profile_code, revision_no DESC);

CREATE OR REPLACE FUNCTION protect_bid_output_profile_revision()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status <> 'draft' THEN
    RAISE EXCEPTION 'Bid output profiles must be created as drafts';
  END IF;
  IF TG_OP = 'DELETE' AND OLD.status <> 'draft' THEN
    RAISE EXCEPTION 'Submitted or published bid output profiles cannot be deleted';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status <> 'draft' AND (
    NEW.profile_code IS DISTINCT FROM OLD.profile_code OR
    NEW.revision_no IS DISTINCT FROM OLD.revision_no OR
    NEW.name_en IS DISTINCT FROM OLD.name_en OR
    NEW.name_zh IS DISTINCT FROM OLD.name_zh OR
    NEW.language_mode IS DISTINCT FROM OLD.language_mode OR
    NEW.layout_settings IS DISTINCT FROM OLD.layout_settings OR
    NEW.brand_assets IS DISTINCT FROM OLD.brand_assets OR
    NEW.change_summary IS DISTINCT FROM OLD.change_summary OR
    NEW.created_by IS DISTINCT FROM OLD.created_by OR
    NEW.created_at IS DISTINCT FROM OLD.created_at
  ) THEN
    RAISE EXCEPTION 'Submitted or published bid output profile is immutable';
  END IF;
  IF TG_OP = 'UPDATE'
      AND (
        (OLD.status = 'draft' AND NEW.status NOT IN ('draft', 'review_pending'))
        OR (OLD.status = 'review_pending' AND NEW.status NOT IN ('draft', 'review_pending', 'published'))
      ) THEN
    RAISE EXCEPTION 'Bid output profile status transition is invalid';
  END IF;
  IF TG_OP = 'UPDATE'
      AND OLD.status = 'published'
      AND NEW.status NOT IN ('published', 'retired') THEN
    RAISE EXCEPTION 'Published bid output profiles can only be retired';
  END IF;
  IF TG_OP = 'UPDATE'
      AND OLD.status = 'retired'
      AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'Retired bid output profiles cannot change status';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status <> 'draft'
      AND (
        NEW.submitted_by IS DISTINCT FROM OLD.submitted_by
        OR NEW.submitted_at IS DISTINCT FROM OLD.submitted_at
        OR (
          OLD.status IN ('published', 'retired')
          AND (
            NEW.published_by IS DISTINCT FROM OLD.published_by
            OR NEW.published_at IS DISTINCT FROM OLD.published_at
          )
        )
        OR (
          OLD.status = 'retired'
          AND (
            NEW.retired_by IS DISTINCT FROM OLD.retired_by
            OR NEW.retired_at IS DISTINCT FROM OLD.retired_at
          )
        )
      ) THEN
    RAISE EXCEPTION 'Bid output profile approval audit is immutable';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bid_output_profile_immutable_guard ON bid_output_profiles;
CREATE TRIGGER bid_output_profile_immutable_guard
BEFORE INSERT OR UPDATE OR DELETE ON bid_output_profiles
FOR EACH ROW EXECUTE FUNCTION protect_bid_output_profile_revision();
