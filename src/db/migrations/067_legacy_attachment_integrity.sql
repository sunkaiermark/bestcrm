ALTER TABLE attachments
  ADD COLUMN IF NOT EXISTS sha256 char(64),
  ADD COLUMN IF NOT EXISTS source_inquiry_attachment_id bigint,
  ADD COLUMN IF NOT EXISTS retired_at timestamptz,
  ADD COLUMN IF NOT EXISTS retired_by bigint,
  ADD COLUMN IF NOT EXISTS retirement_reason text,
  ADD COLUMN IF NOT EXISTS replaced_by_attachment_id bigint;

ALTER TABLE inquiry_attachments
  ADD COLUMN IF NOT EXISTS sha256 char(64);

ALTER TABLE attachments
  DROP CONSTRAINT IF EXISTS attachments_sha256_required,
  ADD CONSTRAINT attachments_sha256_required
    CHECK (sha256 IS NOT NULL AND sha256 ~ '^[0-9a-f]{64}$') NOT VALID,
  DROP CONSTRAINT IF EXISTS attachments_stored_path_safe,
  ADD CONSTRAINT attachments_stored_path_safe
    CHECK (
      btrim(stored_path) <> ''
      AND stored_path !~ '(^[\\/]|^[A-Za-z]:[\\/]|(^|[\\/])\.\.([\\/]|$))'
    ) NOT VALID,
  DROP CONSTRAINT IF EXISTS attachments_file_size_nonnegative,
  ADD CONSTRAINT attachments_file_size_nonnegative
    CHECK (file_size >= 0) NOT VALID,
  DROP CONSTRAINT IF EXISTS attachments_retirement_complete,
  ADD CONSTRAINT attachments_retirement_complete
    CHECK (
      (
        retired_at IS NULL
        AND retired_by IS NULL
        AND retirement_reason IS NULL
        AND replaced_by_attachment_id IS NULL
      )
      OR
      (
        retired_at IS NOT NULL
        AND retired_by IS NOT NULL
        AND retirement_reason IS NOT NULL
        AND btrim(retirement_reason) <> ''
      )
    ) NOT VALID,
  DROP CONSTRAINT IF EXISTS attachments_replacement_not_self,
  ADD CONSTRAINT attachments_replacement_not_self
    CHECK (replaced_by_attachment_id IS NULL OR replaced_by_attachment_id <> id) NOT VALID;

ALTER TABLE inquiry_attachments
  DROP CONSTRAINT IF EXISTS inquiry_attachments_sha256_required,
  ADD CONSTRAINT inquiry_attachments_sha256_required
    CHECK (sha256 IS NOT NULL AND sha256 ~ '^[0-9a-f]{64}$') NOT VALID,
  DROP CONSTRAINT IF EXISTS inquiry_attachments_stored_path_safe,
  ADD CONSTRAINT inquiry_attachments_stored_path_safe
    CHECK (
      btrim(stored_path) <> ''
      AND stored_path !~ '(^[\\/]|^[A-Za-z]:[\\/]|(^|[\\/])\.\.([\\/]|$))'
    ) NOT VALID,
  DROP CONSTRAINT IF EXISTS inquiry_attachments_file_size_nonnegative,
  ADD CONSTRAINT inquiry_attachments_file_size_nonnegative
    CHECK (file_size >= 0) NOT VALID;

ALTER TABLE attachments
  DROP CONSTRAINT IF EXISTS attachments_source_inquiry_attachment_fk,
  ADD CONSTRAINT attachments_source_inquiry_attachment_fk
    FOREIGN KEY (source_inquiry_attachment_id)
    REFERENCES inquiry_attachments(id) ON DELETE RESTRICT,
  DROP CONSTRAINT IF EXISTS attachments_retired_by_fk,
  ADD CONSTRAINT attachments_retired_by_fk
    FOREIGN KEY (retired_by)
    REFERENCES users(id) ON DELETE RESTRICT,
  DROP CONSTRAINT IF EXISTS attachments_replaced_by_attachment_fk,
  ADD CONSTRAINT attachments_replaced_by_attachment_fk
    FOREIGN KEY (replaced_by_attachment_id)
    REFERENCES attachments(id) ON DELETE RESTRICT;

ALTER TABLE attachments
  DROP CONSTRAINT IF EXISTS attachments_opportunity_material_version_fk,
  ADD CONSTRAINT attachments_opportunity_material_version_fk
    FOREIGN KEY (opportunity_material_version_id)
    REFERENCES opportunity_material_versions(id) ON DELETE RESTRICT;

CREATE INDEX IF NOT EXISTS attachments_source_inquiry_attachment_idx
  ON attachments(source_inquiry_attachment_id)
  WHERE source_inquiry_attachment_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS attachments_active_opportunity_idx
  ON attachments(opportunity_id, uploaded_at DESC, id DESC)
  WHERE retired_at IS NULL;

CREATE INDEX IF NOT EXISTS attachments_replaced_by_idx
  ON attachments(replaced_by_attachment_id)
  WHERE replaced_by_attachment_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS opportunity_attachment_events (
  id bigserial PRIMARY KEY,
  attachment_id bigint NOT NULL REFERENCES attachments(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN ('created', 'legacy_hash_verified', 'retired', 'replaced')),
  actor_user_id bigint REFERENCES users(id) ON DELETE RESTRICT,
  related_attachment_id bigint REFERENCES attachments(id) ON DELETE RESTRICT,
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT opportunity_attachment_events_reason_check CHECK (
    reason IS NULL OR btrim(reason) <> ''
  ),
  CONSTRAINT opportunity_attachment_events_related_check CHECK (
    (event_type = 'replaced' AND related_attachment_id IS NOT NULL)
    OR (event_type <> 'replaced' AND related_attachment_id IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS opportunity_attachment_events_attachment_idx
  ON opportunity_attachment_events(attachment_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS opportunity_attachment_events_related_idx
  ON opportunity_attachment_events(related_attachment_id)
  WHERE related_attachment_id IS NOT NULL;

CREATE OR REPLACE FUNCTION bestcrm_protect_opportunity_attachment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  replacement_opportunity_id bigint;
  replacement_retired_at timestamptz;
  material_opportunity_id bigint;
  source_sha256 char(64);
  hash_backfill_allowed boolean := false;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Opportunity attachments cannot be deleted';
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.retired_at IS NOT NULL
        OR NEW.retired_by IS NOT NULL
        OR NEW.retirement_reason IS NOT NULL
        OR NEW.replaced_by_attachment_id IS NOT NULL THEN
      RAISE EXCEPTION 'Opportunity attachments must be active when created';
    END IF;

    IF NEW.source_inquiry_attachment_id IS NOT NULL THEN
      SELECT sha256
      INTO source_sha256
      FROM inquiry_attachments
      WHERE id = NEW.source_inquiry_attachment_id;

      IF source_sha256 IS NOT NULL AND source_sha256 IS DISTINCT FROM NEW.sha256 THEN
        RAISE EXCEPTION 'Opportunity attachment digest must match its inquiry source';
      END IF;
    END IF;

    RETURN NEW;
  END IF;

  IF NEW.opportunity_id IS DISTINCT FROM OLD.opportunity_id
      OR NEW.category IS DISTINCT FROM OLD.category
      OR NEW.original_name IS DISTINCT FROM OLD.original_name
      OR NEW.stored_path IS DISTINCT FROM OLD.stored_path
      OR NEW.mime_type IS DISTINCT FROM OLD.mime_type
      OR NEW.file_size IS DISTINCT FROM OLD.file_size
      OR NEW.uploaded_by IS DISTINCT FROM OLD.uploaded_by
      OR NEW.uploaded_at IS DISTINCT FROM OLD.uploaded_at
      OR NEW.source_inquiry_attachment_id IS DISTINCT FROM OLD.source_inquiry_attachment_id THEN
    RAISE EXCEPTION 'Opportunity attachment identity is immutable';
  END IF;

  IF NEW.sha256 IS DISTINCT FROM OLD.sha256 THEN
    IF OLD.sha256 IS NULL
        AND NEW.sha256 ~ '^[0-9a-f]{64}$'
        AND current_setting('bestcrm.attachment_hash_backfill', true) = 'enabled' THEN
      hash_backfill_allowed := true;
    END IF;

    IF NOT hash_backfill_allowed THEN
      RAISE EXCEPTION 'Opportunity attachment digest is immutable';
    END IF;
  END IF;

  IF NEW.opportunity_material_version_id IS DISTINCT FROM OLD.opportunity_material_version_id THEN
    IF OLD.opportunity_material_version_id IS NOT NULL
        OR NEW.opportunity_material_version_id IS NULL THEN
      RAISE EXCEPTION 'Opportunity attachment material version can only be bound once';
    END IF;

    SELECT opportunity_id
    INTO material_opportunity_id
    FROM opportunity_material_versions
    WHERE id = NEW.opportunity_material_version_id;

    IF material_opportunity_id IS DISTINCT FROM NEW.opportunity_id THEN
      RAISE EXCEPTION 'Opportunity attachment material version must belong to the same opportunity';
    END IF;
  END IF;

  IF NEW.retired_at IS DISTINCT FROM OLD.retired_at
      OR NEW.retired_by IS DISTINCT FROM OLD.retired_by
      OR NEW.retirement_reason IS DISTINCT FROM OLD.retirement_reason
      OR NEW.replaced_by_attachment_id IS DISTINCT FROM OLD.replaced_by_attachment_id THEN
    IF OLD.retired_at IS NOT NULL
        OR OLD.retired_by IS NOT NULL
        OR OLD.retirement_reason IS NOT NULL
        OR OLD.replaced_by_attachment_id IS NOT NULL
        OR NEW.retired_at IS NULL
        OR NEW.retired_by IS NULL
        OR NEW.retirement_reason IS NULL
        OR btrim(NEW.retirement_reason) = '' THEN
      RAISE EXCEPTION 'Opportunity attachment retirement is immutable and must be complete';
    END IF;

    IF NEW.replaced_by_attachment_id IS NOT NULL THEN
      IF NEW.replaced_by_attachment_id = NEW.id THEN
        RAISE EXCEPTION 'Opportunity attachment cannot replace itself';
      END IF;

      SELECT opportunity_id, retired_at
      INTO replacement_opportunity_id, replacement_retired_at
      FROM attachments
      WHERE id = NEW.replaced_by_attachment_id
      FOR SHARE;

      IF replacement_opportunity_id IS NULL
          OR replacement_opportunity_id IS DISTINCT FROM NEW.opportunity_id
          OR replacement_retired_at IS NOT NULL THEN
        RAISE EXCEPTION 'Replacement attachment must be active and belong to the same opportunity';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS attachments_integrity_guard ON attachments;
CREATE TRIGGER attachments_integrity_guard
BEFORE INSERT OR UPDATE OR DELETE ON attachments
FOR EACH ROW
EXECUTE FUNCTION bestcrm_protect_opportunity_attachment();

CREATE OR REPLACE FUNCTION bestcrm_record_opportunity_attachment_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO opportunity_attachment_events (
      attachment_id,
      event_type,
      actor_user_id
    ) VALUES (
      NEW.id,
      'created',
      NEW.uploaded_by
    );
    RETURN NEW;
  END IF;

  IF OLD.sha256 IS NULL AND NEW.sha256 IS NOT NULL THEN
    INSERT INTO opportunity_attachment_events (
      attachment_id,
      event_type
    ) VALUES (
      NEW.id,
      'legacy_hash_verified'
    );
  END IF;

  IF OLD.retired_at IS NULL AND NEW.retired_at IS NOT NULL THEN
    INSERT INTO opportunity_attachment_events (
      attachment_id,
      event_type,
      actor_user_id,
      reason
    ) VALUES (
      NEW.id,
      'retired',
      NEW.retired_by,
      NEW.retirement_reason
    );

    IF NEW.replaced_by_attachment_id IS NOT NULL THEN
      INSERT INTO opportunity_attachment_events (
        attachment_id,
        event_type,
        actor_user_id,
        related_attachment_id,
        reason
      ) VALUES (
        NEW.id,
        'replaced',
        NEW.retired_by,
        NEW.replaced_by_attachment_id,
        NEW.retirement_reason
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS attachments_event_audit ON attachments;
CREATE TRIGGER attachments_event_audit
AFTER INSERT OR UPDATE ON attachments
FOR EACH ROW
EXECUTE FUNCTION bestcrm_record_opportunity_attachment_event();

CREATE OR REPLACE FUNCTION bestcrm_protect_inquiry_attachment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF current_setting('bestcrm.inquiry_attachment_purge', true) = 'enabled' THEN
      RETURN OLD;
    END IF;
    RAISE EXCEPTION 'Inquiry attachments can only be deleted by the guarded purge workflow';
  END IF;

  IF OLD.sha256 IS NULL
      AND NEW.sha256 ~ '^[0-9a-f]{64}$'
      AND current_setting('bestcrm.attachment_hash_backfill', true) = 'enabled'
      AND NEW.inquiry_id IS NOT DISTINCT FROM OLD.inquiry_id
      AND NEW.source_index IS NOT DISTINCT FROM OLD.source_index
      AND NEW.original_name IS NOT DISTINCT FROM OLD.original_name
      AND NEW.stored_path IS NOT DISTINCT FROM OLD.stored_path
      AND NEW.mime_type IS NOT DISTINCT FROM OLD.mime_type
      AND NEW.file_size IS NOT DISTINCT FROM OLD.file_size
      AND NEW.cid IS NOT DISTINCT FROM OLD.cid
      AND NEW.uploaded_at IS NOT DISTINCT FROM OLD.uploaded_at THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Inquiry attachment identity is immutable';
END;
$$;

DROP TRIGGER IF EXISTS inquiry_attachments_integrity_guard ON inquiry_attachments;
CREATE TRIGGER inquiry_attachments_integrity_guard
BEFORE UPDATE OR DELETE ON inquiry_attachments
FOR EACH ROW
EXECUTE FUNCTION bestcrm_protect_inquiry_attachment();

CREATE OR REPLACE FUNCTION bestcrm_protect_opportunity_attachment_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Opportunity attachment events are append-only';
END;
$$;

DROP TRIGGER IF EXISTS opportunity_attachment_events_append_only_guard
  ON opportunity_attachment_events;
CREATE TRIGGER opportunity_attachment_events_append_only_guard
BEFORE UPDATE OR DELETE ON opportunity_attachment_events
FOR EACH ROW
EXECUTE FUNCTION bestcrm_protect_opportunity_attachment_event();
