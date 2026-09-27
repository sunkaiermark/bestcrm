-- P3a metadata foundation only. There is deliberately no published asset,
-- download permission, or file-upload route. The sole access-policy value is
-- a fail-closed sentinel until the confidentiality and file policies are set.
CREATE TABLE development_materials (
  id bigserial PRIMARY KEY,
  topic_id bigint NOT NULL REFERENCES development_topics(id) ON DELETE RESTRICT,
  title text NOT NULL CHECK (btrim(title) <> '' AND char_length(title) <= 200),
  category_code text NOT NULL CHECK (btrim(category_code) <> '' AND char_length(category_code) <= 64),
  source_reference text NOT NULL DEFAULT '' CHECK (char_length(source_reference) <= 2000),
  created_by_user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX development_materials_topic_created_idx
  ON development_materials (topic_id, created_at DESC, id DESC);
CREATE TRIGGER development_materials_no_change
  BEFORE UPDATE OR DELETE ON development_materials
  FOR EACH ROW EXECUTE FUNCTION bestcrm_protect_development_history();

CREATE TABLE development_material_versions (
  id bigserial PRIMARY KEY,
  material_id bigint NOT NULL REFERENCES development_materials(id) ON DELETE RESTRICT,
  version_no integer NOT NULL CHECK (version_no > 0),
  original_filename text NOT NULL CHECK (btrim(original_filename) <> '' AND char_length(original_filename) <= 255),
  stored_path text NOT NULL CHECK (
    stored_path LIKE 'development/%' AND stored_path NOT LIKE '%..%'
    AND position(chr(92) in stored_path) = 0
  ),
  mime_type text NOT NULL CHECK (btrim(mime_type) <> '' AND char_length(mime_type) <= 255),
  file_size bigint NOT NULL CHECK (file_size > 0),
  sha256 char(64) NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  access_policy_state text NOT NULL DEFAULT 'blocked_pending_policy'
    CHECK (access_policy_state = 'blocked_pending_policy'),
  recorded_by_user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (material_id, version_no),
  UNIQUE (stored_path)
);
CREATE INDEX development_material_versions_material_recent_idx
  ON development_material_versions (material_id, version_no DESC);
CREATE TRIGGER development_material_versions_no_change
  BEFORE UPDATE OR DELETE ON development_material_versions
  FOR EACH ROW EXECUTE FUNCTION bestcrm_protect_development_history();

CREATE TABLE development_outcome_revisions (
  id bigserial PRIMARY KEY,
  topic_id bigint NOT NULL REFERENCES development_topics(id) ON DELETE RESTRICT,
  revision_no integer NOT NULL CHECK (revision_no > 0),
  outcome_kind text NOT NULL CHECK (outcome_kind IN ('technical_result', 'lesson_learned')),
  title text NOT NULL CHECK (btrim(title) <> '' AND char_length(title) <= 200),
  finding text NOT NULL CHECK (btrim(finding) <> '' AND char_length(finding) <= 20000),
  applicability text NOT NULL CHECK (btrim(applicability) <> '' AND char_length(applicability) <= 10000),
  limitations text NOT NULL CHECK (btrim(limitations) <> '' AND char_length(limitations) <= 10000),
  evidence_references jsonb NOT NULL DEFAULT '[]'::jsonb
    CHECK (jsonb_typeof(evidence_references) = 'array'),
  access_policy_state text NOT NULL DEFAULT 'blocked_pending_policy'
    CHECK (access_policy_state = 'blocked_pending_policy'),
  authored_by_user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  authored_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (topic_id, revision_no)
);
CREATE INDEX development_outcome_revisions_topic_recent_idx
  ON development_outcome_revisions (topic_id, revision_no DESC);
CREATE TRIGGER development_outcome_revisions_no_change
  BEFORE UPDATE OR DELETE ON development_outcome_revisions
  FOR EACH ROW EXECUTE FUNCTION bestcrm_protect_development_history();

CREATE TABLE development_asset_candidates (
  id bigserial PRIMARY KEY,
  outcome_revision_id bigint NOT NULL UNIQUE
    REFERENCES development_outcome_revisions(id) ON DELETE RESTRICT,
  rationale text NOT NULL CHECK (btrim(rationale) <> '' AND char_length(rationale) <= 4000),
  proposed_by_user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  proposed_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER development_asset_candidates_no_change
  BEFORE UPDATE OR DELETE ON development_asset_candidates
  FOR EACH ROW EXECUTE FUNCTION bestcrm_protect_development_history();

CREATE OR REPLACE FUNCTION bestcrm_development_require_active_member(p_topic_id bigint, p_actor_id bigint)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM development_memberships membership
    JOIN users actor ON actor.id = membership.user_id
    WHERE membership.topic_id = p_topic_id AND membership.user_id = p_actor_id
      AND membership.ended_at IS NULL AND actor.is_active = true
  );
$$;

CREATE OR REPLACE FUNCTION bestcrm_guard_development_p3_draft()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target_topic_id bigint;
  current_number integer;
  current_revision_id bigint;
BEGIN
  CASE TG_TABLE_NAME
    WHEN 'development_materials' THEN
      target_topic_id := NEW.topic_id;
      PERFORM 1 FROM development_topics WHERE id = target_topic_id FOR UPDATE;
      IF NOT bestcrm_development_require_active_member(target_topic_id, NEW.created_by_user_id) THEN
        RAISE EXCEPTION 'Only an active topic member may register research material';
      END IF;
    WHEN 'development_material_versions' THEN
      SELECT topic_id INTO target_topic_id FROM development_materials
        WHERE id = NEW.material_id FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'Research material not found'; END IF;
      SELECT max(version_no) INTO current_number FROM development_material_versions
        WHERE material_id = NEW.material_id;
      IF NEW.version_no <> coalesce(current_number, 0) + 1 THEN
        RAISE EXCEPTION 'Research material version must be sequential';
      END IF;
      IF NOT bestcrm_development_require_active_member(target_topic_id, NEW.recorded_by_user_id) THEN
        RAISE EXCEPTION 'Only an active topic member may register a research material version';
      END IF;
    WHEN 'development_outcome_revisions' THEN
      target_topic_id := NEW.topic_id;
      PERFORM 1 FROM development_topics WHERE id = target_topic_id FOR UPDATE;
      SELECT max(revision_no) INTO current_number FROM development_outcome_revisions
        WHERE topic_id = target_topic_id;
      IF NEW.revision_no <> coalesce(current_number, 0) + 1 THEN
        RAISE EXCEPTION 'Outcome revision must be sequential';
      END IF;
      IF NOT bestcrm_development_require_active_member(target_topic_id, NEW.authored_by_user_id) THEN
        RAISE EXCEPTION 'Only an active topic member may author an outcome revision';
      END IF;
    WHEN 'development_asset_candidates' THEN
      SELECT topic_id INTO target_topic_id FROM development_outcome_revisions
        WHERE id = NEW.outcome_revision_id;
      IF NOT FOUND THEN RAISE EXCEPTION 'Outcome revision not found'; END IF;
      PERFORM 1 FROM development_topics WHERE id = target_topic_id FOR UPDATE;
      SELECT id INTO current_revision_id FROM development_outcome_revisions
        WHERE topic_id = target_topic_id ORDER BY revision_no DESC LIMIT 1;
      IF NEW.outcome_revision_id <> current_revision_id THEN
        RAISE EXCEPTION 'Only the current outcome revision may become an asset candidate';
      END IF;
      IF NOT bestcrm_development_require_active_member(target_topic_id, NEW.proposed_by_user_id) THEN
        RAISE EXCEPTION 'Only an active topic member may propose an asset candidate';
      END IF;
    ELSE
      RAISE EXCEPTION 'Unexpected development draft source';
  END CASE;
  RETURN NEW;
END;
$$;
CREATE TRIGGER development_materials_guard_insert
  BEFORE INSERT ON development_materials
  FOR EACH ROW EXECUTE FUNCTION bestcrm_guard_development_p3_draft();
CREATE TRIGGER development_material_versions_guard_insert
  BEFORE INSERT ON development_material_versions
  FOR EACH ROW EXECUTE FUNCTION bestcrm_guard_development_p3_draft();
CREATE TRIGGER development_outcome_revisions_guard_insert
  BEFORE INSERT ON development_outcome_revisions
  FOR EACH ROW EXECUTE FUNCTION bestcrm_guard_development_p3_draft();
CREATE TRIGGER development_asset_candidates_guard_insert
  BEFORE INSERT ON development_asset_candidates
  FOR EACH ROW EXECUTE FUNCTION bestcrm_guard_development_p3_draft();

CREATE OR REPLACE FUNCTION bestcrm_record_development_p3_draft_event()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target_topic_id bigint;
  actor_id bigint;
  event_name text;
  event_metadata jsonb;
BEGIN
  CASE TG_TABLE_NAME
    WHEN 'development_materials' THEN
      target_topic_id := NEW.topic_id;
      actor_id := NEW.created_by_user_id;
      event_name := 'research_material_registered';
      event_metadata := jsonb_build_object('materialId', NEW.id);
    WHEN 'development_material_versions' THEN
      SELECT topic_id INTO target_topic_id FROM development_materials WHERE id = NEW.material_id;
      actor_id := NEW.recorded_by_user_id;
      event_name := 'research_material_version_registered';
      event_metadata := jsonb_build_object('materialId', NEW.material_id,
        'versionId', NEW.id, 'versionNo', NEW.version_no, 'sha256', NEW.sha256);
    WHEN 'development_outcome_revisions' THEN
      target_topic_id := NEW.topic_id;
      actor_id := NEW.authored_by_user_id;
      event_name := 'outcome_revision_created';
      event_metadata := jsonb_build_object('outcomeRevisionId', NEW.id,
        'revisionNo', NEW.revision_no, 'outcomeKind', NEW.outcome_kind);
    WHEN 'development_asset_candidates' THEN
      SELECT topic_id INTO target_topic_id FROM development_outcome_revisions
        WHERE id = NEW.outcome_revision_id;
      actor_id := NEW.proposed_by_user_id;
      event_name := 'asset_candidate_proposed';
      event_metadata := jsonb_build_object('candidateId', NEW.id,
        'outcomeRevisionId', NEW.outcome_revision_id);
    ELSE
      RAISE EXCEPTION 'Unexpected development draft event source';
  END CASE;
  INSERT INTO development_events (topic_id, event_type, actor_user_id, metadata)
  VALUES (target_topic_id, event_name, actor_id, event_metadata);
  RETURN NEW;
END;
$$;
CREATE TRIGGER development_materials_created_event
  AFTER INSERT ON development_materials
  FOR EACH ROW EXECUTE FUNCTION bestcrm_record_development_p3_draft_event();
CREATE TRIGGER development_material_versions_created_event
  AFTER INSERT ON development_material_versions
  FOR EACH ROW EXECUTE FUNCTION bestcrm_record_development_p3_draft_event();
CREATE TRIGGER development_outcome_revisions_created_event
  AFTER INSERT ON development_outcome_revisions
  FOR EACH ROW EXECUTE FUNCTION bestcrm_record_development_p3_draft_event();
CREATE TRIGGER development_asset_candidates_created_event
  AFTER INSERT ON development_asset_candidates
  FOR EACH ROW EXECUTE FUNCTION bestcrm_record_development_p3_draft_event();
