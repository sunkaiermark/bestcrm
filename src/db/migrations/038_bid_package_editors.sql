CREATE TABLE IF NOT EXISTS bid_package_events (
  id bigserial PRIMARY KEY,
  workspace_id bigint NOT NULL REFERENCES opportunity_bid_workspaces(id) ON DELETE RESTRICT,
  package_type text NOT NULL CHECK (package_type IN ('technical', 'commercial')),
  technical_draft_id bigint REFERENCES opportunity_technical_drafts(id) ON DELETE RESTRICT,
  commercial_draft_id bigint REFERENCES opportunity_commercial_drafts(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (event_type IN (
    'variables_saved', 'section_saved', 'section_added', 'section_omitted',
    'section_restored', 'sections_reordered', 'content_selected',
    'attachment_added', 'attachment_removed', 'library_suggestion_created',
    'assignment_added', 'assignment_removed'
  )),
  section_key text CHECK (section_key IS NULL OR section_key ~ '^[a-z][a-z0-9_]{0,63}$'),
  actor_user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(details) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bid_package_events_source_check CHECK (
    (package_type = 'technical' AND technical_draft_id IS NOT NULL AND commercial_draft_id IS NULL)
    OR (package_type = 'commercial' AND technical_draft_id IS NULL AND commercial_draft_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS bid_package_events_workspace_idx
  ON bid_package_events(workspace_id, package_type, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS bid_package_attachments (
  id bigserial PRIMARY KEY,
  workspace_id bigint NOT NULL REFERENCES opportunity_bid_workspaces(id) ON DELETE RESTRICT,
  package_type text NOT NULL CHECK (package_type IN ('technical', 'commercial')),
  technical_draft_id bigint REFERENCES opportunity_technical_drafts(id) ON DELETE RESTRICT,
  commercial_draft_id bigint REFERENCES opportunity_commercial_drafts(id) ON DELETE RESTRICT,
  section_key text NOT NULL CHECK (section_key ~ '^[a-z][a-z0-9_]{0,63}$'),
  original_name text NOT NULL CHECK (btrim(original_name) <> ''),
  stored_path text NOT NULL CHECK (btrim(stored_path) <> ''),
  mime_type text NOT NULL CHECK (btrim(mime_type) <> ''),
  byte_size bigint NOT NULL CHECK (byte_size > 0),
  sha256 char(64) NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  uploaded_by bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  removed_by bigint REFERENCES users(id) ON DELETE RESTRICT,
  removed_at timestamptz,
  CONSTRAINT bid_package_attachments_source_check CHECK (
    (package_type = 'technical' AND technical_draft_id IS NOT NULL AND commercial_draft_id IS NULL)
    OR (package_type = 'commercial' AND technical_draft_id IS NULL AND commercial_draft_id IS NOT NULL)
  ),
  CONSTRAINT bid_package_attachments_removed_check CHECK (
    (removed_by IS NULL AND removed_at IS NULL)
    OR (removed_by IS NOT NULL AND removed_at IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS bid_package_attachments_workspace_idx
  ON bid_package_attachments(workspace_id, package_type, section_key, uploaded_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS bid_library_suggestions (
  id bigserial PRIMARY KEY,
  workspace_id bigint NOT NULL REFERENCES opportunity_bid_workspaces(id) ON DELETE RESTRICT,
  package_type text NOT NULL CHECK (package_type IN ('technical', 'commercial')),
  technical_draft_id bigint REFERENCES opportunity_technical_drafts(id) ON DELETE RESTRICT,
  commercial_draft_id bigint REFERENCES opportunity_commercial_drafts(id) ON DELETE RESTRICT,
  section_key text NOT NULL CHECK (section_key ~ '^[a-z][a-z0-9_]{0,63}$'),
  target_kind text NOT NULL CHECK (target_kind IN ('content_block', 'template_revision')),
  title text NOT NULL CHECK (btrim(title) <> ''),
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  content_snapshot jsonb NOT NULL CHECK (jsonb_typeof(content_snapshot) = 'object'),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'review_pending', 'accepted', 'rejected')),
  created_by bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bid_library_suggestions_source_check CHECK (
    (package_type = 'technical' AND technical_draft_id IS NOT NULL AND commercial_draft_id IS NULL)
    OR (package_type = 'commercial' AND technical_draft_id IS NULL AND commercial_draft_id IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS bid_library_suggestions_workspace_idx
  ON bid_library_suggestions(workspace_id, package_type, created_at DESC, id DESC);

CREATE OR REPLACE FUNCTION validate_bid_package_source()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  workspace_opportunity_id bigint;
  source_opportunity_id bigint;
  source_workspace_id bigint;
BEGIN
  SELECT opportunity_id INTO workspace_opportunity_id
  FROM opportunity_bid_workspaces WHERE id = NEW.workspace_id;

  IF NEW.package_type = 'technical' THEN
    SELECT opportunity_id INTO source_opportunity_id
    FROM opportunity_technical_drafts WHERE id = NEW.technical_draft_id;
  ELSE
    SELECT opportunity_id, workspace_id INTO source_opportunity_id, source_workspace_id
    FROM opportunity_commercial_drafts WHERE id = NEW.commercial_draft_id;
  END IF;

  IF workspace_opportunity_id IS NULL
      OR source_opportunity_id IS DISTINCT FROM workspace_opportunity_id
      OR (NEW.package_type = 'commercial' AND source_workspace_id IS DISTINCT FROM NEW.workspace_id) THEN
    RAISE EXCEPTION 'Bid package source does not belong to its workspace';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bid_package_event_source_guard ON bid_package_events;
CREATE TRIGGER bid_package_event_source_guard
BEFORE INSERT ON bid_package_events
FOR EACH ROW EXECUTE FUNCTION validate_bid_package_source();

DROP TRIGGER IF EXISTS bid_package_attachment_source_guard ON bid_package_attachments;
CREATE TRIGGER bid_package_attachment_source_guard
BEFORE INSERT ON bid_package_attachments
FOR EACH ROW EXECUTE FUNCTION validate_bid_package_source();

DROP TRIGGER IF EXISTS bid_library_suggestion_source_guard ON bid_library_suggestions;
CREATE TRIGGER bid_library_suggestion_source_guard
BEFORE INSERT ON bid_library_suggestions
FOR EACH ROW EXECUTE FUNCTION validate_bid_package_source();

CREATE OR REPLACE FUNCTION protect_bid_package_event()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Bid package events are append-only';
END;
$$;

DROP TRIGGER IF EXISTS bid_package_event_append_only_guard ON bid_package_events;
CREATE TRIGGER bid_package_event_append_only_guard
BEFORE UPDATE OR DELETE ON bid_package_events
FOR EACH ROW EXECUTE FUNCTION protect_bid_package_event();

CREATE OR REPLACE FUNCTION protect_bid_package_attachment()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Bid package attachments cannot be deleted';
  END IF;
  IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
      OR NEW.package_type IS DISTINCT FROM OLD.package_type
      OR NEW.technical_draft_id IS DISTINCT FROM OLD.technical_draft_id
      OR NEW.commercial_draft_id IS DISTINCT FROM OLD.commercial_draft_id
      OR NEW.section_key IS DISTINCT FROM OLD.section_key
      OR NEW.original_name IS DISTINCT FROM OLD.original_name
      OR NEW.stored_path IS DISTINCT FROM OLD.stored_path
      OR NEW.mime_type IS DISTINCT FROM OLD.mime_type
      OR NEW.byte_size IS DISTINCT FROM OLD.byte_size
      OR NEW.sha256 IS DISTINCT FROM OLD.sha256
      OR NEW.uploaded_by IS DISTINCT FROM OLD.uploaded_by
      OR NEW.uploaded_at IS DISTINCT FROM OLD.uploaded_at
      OR (OLD.removed_at IS NOT NULL AND (
        NEW.removed_by IS DISTINCT FROM OLD.removed_by
        OR NEW.removed_at IS DISTINCT FROM OLD.removed_at
      )) THEN
    RAISE EXCEPTION 'Bid package attachment records are immutable except for one soft removal';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bid_package_attachment_guard ON bid_package_attachments;
CREATE TRIGGER bid_package_attachment_guard
BEFORE UPDATE OR DELETE ON bid_package_attachments
FOR EACH ROW EXECUTE FUNCTION protect_bid_package_attachment();

CREATE OR REPLACE FUNCTION protect_bid_library_suggestion()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Bid library suggestions cannot be deleted';
  END IF;
  IF NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
      OR NEW.package_type IS DISTINCT FROM OLD.package_type
      OR NEW.technical_draft_id IS DISTINCT FROM OLD.technical_draft_id
      OR NEW.commercial_draft_id IS DISTINCT FROM OLD.commercial_draft_id
      OR NEW.section_key IS DISTINCT FROM OLD.section_key
      OR NEW.target_kind IS DISTINCT FROM OLD.target_kind
      OR NEW.title IS DISTINCT FROM OLD.title
      OR NEW.reason IS DISTINCT FROM OLD.reason
      OR NEW.content_snapshot IS DISTINCT FROM OLD.content_snapshot
      OR NEW.created_by IS DISTINCT FROM OLD.created_by
      OR NEW.created_at IS DISTINCT FROM OLD.created_at
      OR (OLD.status <> 'draft' AND NEW.status IS DISTINCT FROM OLD.status) THEN
    RAISE EXCEPTION 'Bid library suggestion draft content is immutable';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS bid_library_suggestion_guard ON bid_library_suggestions;
CREATE TRIGGER bid_library_suggestion_guard
BEFORE UPDATE OR DELETE ON bid_library_suggestions
FOR EACH ROW EXECUTE FUNCTION protect_bid_library_suggestion();
