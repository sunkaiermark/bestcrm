-- P3c: immutable file identity, a hard per-topic quota, and fail-closed read
-- decisions. A material version is never readable merely because it exists:
-- a separately recorded clean-scan activation is required.
CREATE OR REPLACE FUNCTION bestcrm_guard_development_material_capacity()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target_topic_id bigint;
  total_bytes bigint;
  expected_path_pattern text;
BEGIN
  SELECT topic_id INTO target_topic_id FROM development_materials
    WHERE id = NEW.material_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Research material not found'; END IF;
  PERFORM 1 FROM development_topics WHERE id = target_topic_id FOR UPDATE;
  IF NEW.file_size > 104857600 THEN
    RAISE EXCEPTION 'Research file exceeds the 100 MiB per-file limit';
  END IF;
  expected_path_pattern := '^development/' || target_topic_id::text ||
    '/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
  IF NEW.stored_path !~ expected_path_pattern THEN
    RAISE EXCEPTION 'Research file path must be a private topic-scoped UUID';
  END IF;
  -- AFTER ROW triggers see every row in a multi-row INSERT. The topic lock
  -- serializes concurrent uploads to different materials in this same topic.
  SELECT coalesce(sum(version.file_size), 0)::bigint INTO total_bytes
    FROM development_material_versions version
    JOIN development_materials material ON material.id = version.material_id
    WHERE material.topic_id = target_topic_id;
  IF total_bytes > 1073741824 THEN
    RAISE EXCEPTION 'Research topic exceeds the 1 GiB cumulative version quota';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER development_material_versions_capacity_guard
  AFTER INSERT ON development_material_versions
  FOR EACH ROW EXECUTE FUNCTION bestcrm_guard_development_material_capacity();

CREATE TABLE development_material_file_activations (
  id bigserial PRIMARY KEY,
  material_version_id bigint NOT NULL UNIQUE
    REFERENCES development_material_versions(id) ON DELETE RESTRICT,
  access_class text NOT NULL CHECK (access_class IN ('internal', 'restricted')),
  scan_verdict text NOT NULL DEFAULT 'clean' CHECK (scan_verdict = 'clean'),
  scan_engine text NOT NULL CHECK (btrim(scan_engine) <> '' AND char_length(scan_engine) <= 100),
  scan_engine_version text NOT NULL DEFAULT '' CHECK (char_length(scan_engine_version) <= 100),
  scan_signature_version text NOT NULL DEFAULT '' CHECK (char_length(scan_signature_version) <= 100),
  scan_completed_at timestamptz NOT NULL,
  activated_by_user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  activated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX development_material_file_activations_class_idx
  ON development_material_file_activations (access_class, material_version_id);
CREATE TRIGGER development_material_file_activations_no_change
  BEFORE UPDATE OR DELETE ON development_material_file_activations
  FOR EACH ROW EXECUTE FUNCTION bestcrm_protect_development_history();

CREATE OR REPLACE FUNCTION bestcrm_guard_development_material_file_activation()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target record;
BEGIN
  SELECT version.recorded_by_user_id, material.topic_id,
         version.file_size, version.sha256, version.stored_path
    INTO target
    FROM development_material_versions version
    JOIN development_materials material ON material.id = version.material_id
    WHERE version.id = NEW.material_version_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Research material version not found'; END IF;
  PERFORM 1 FROM development_topics WHERE id = target.topic_id FOR UPDATE;
  IF NEW.activated_by_user_id <> target.recorded_by_user_id THEN
    RAISE EXCEPTION 'Only the recorded uploader may activate the research file';
  END IF;
  PERFORM 1 FROM development_memberships membership
    JOIN users actor ON actor.id = membership.user_id
    WHERE membership.topic_id = target.topic_id
      AND membership.user_id = NEW.activated_by_user_id
      AND membership.added_at <= now() AND membership.ended_at IS NULL
      AND actor.is_active = true
    FOR SHARE OF membership, actor;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Research file activation requires an active topic member';
  END IF;
  IF NEW.scan_completed_at > now() + interval '5 minutes' THEN
    RAISE EXCEPTION 'Research file scan timestamp is invalid';
  END IF;
  NEW.activated_at := now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER development_material_file_activations_guard_insert
  BEFORE INSERT ON development_material_file_activations
  FOR EACH ROW EXECUTE FUNCTION bestcrm_guard_development_material_file_activation();

CREATE OR REPLACE FUNCTION bestcrm_development_can_read_material_version(
  p_material_version_id bigint, p_user_id bigint
) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM development_material_file_activations activation
    JOIN development_material_versions version
      ON version.id = activation.material_version_id
    JOIN development_materials material ON material.id = version.material_id
    JOIN development_memberships membership
      ON membership.topic_id = material.topic_id AND membership.user_id = p_user_id
    JOIN users actor ON actor.id = membership.user_id
    WHERE activation.material_version_id = p_material_version_id
      AND membership.added_at <= now() AND membership.ended_at IS NULL
      AND actor.is_active = true
      AND (
        activation.access_class = 'internal'
        OR version.recorded_by_user_id = p_user_id
        OR bestcrm_development_has_restricted_file_grant(p_material_version_id, p_user_id)
      )
  );
$$;

CREATE TABLE development_material_file_accesses (
  id bigserial PRIMARY KEY,
  material_version_id bigint NOT NULL
    REFERENCES development_material_versions(id) ON DELETE RESTRICT,
  access_kind text NOT NULL CHECK (access_kind IN ('download', 'preview')),
  accessed_by_user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  accessed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX development_material_file_accesses_version_idx
  ON development_material_file_accesses
  (material_version_id, accessed_at DESC, id DESC);
CREATE TRIGGER development_material_file_accesses_no_change
  BEFORE UPDATE OR DELETE ON development_material_file_accesses
  FOR EACH ROW EXECUTE FUNCTION bestcrm_protect_development_history();

CREATE OR REPLACE FUNCTION bestcrm_guard_development_material_file_access()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target_topic_id bigint;
BEGIN
  SELECT material.topic_id INTO target_topic_id
    FROM development_material_versions version
    JOIN development_materials material ON material.id = version.material_id
    WHERE version.id = NEW.material_version_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Research material version not found'; END IF;
  -- Grant/revocation operations lock this same topic FOR UPDATE. A download
  -- audit cannot commit using an authorization that was revoked concurrently.
  PERFORM 1 FROM development_topics WHERE id = target_topic_id FOR SHARE;
  PERFORM 1 FROM development_memberships membership
    JOIN users actor ON actor.id = membership.user_id
    WHERE membership.topic_id = target_topic_id
      AND membership.user_id = NEW.accessed_by_user_id
      AND membership.added_at <= now() AND membership.ended_at IS NULL
      AND actor.is_active = true
    FOR SHARE OF membership, actor;
  IF NOT FOUND OR NOT bestcrm_development_can_read_material_version(
      NEW.material_version_id, NEW.accessed_by_user_id) THEN
    RAISE EXCEPTION 'Research file access is not authorized';
  END IF;
  NEW.accessed_at := now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER development_material_file_accesses_guard_insert
  BEFORE INSERT ON development_material_file_accesses
  FOR EACH ROW EXECUTE FUNCTION bestcrm_guard_development_material_file_access();

CREATE OR REPLACE FUNCTION bestcrm_record_development_material_file_event()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target_topic_id bigint;
  event_name text;
  event_actor_id bigint;
  event_metadata jsonb;
BEGIN
  SELECT material.topic_id INTO target_topic_id
    FROM development_material_versions version
    JOIN development_materials material ON material.id = version.material_id
    WHERE version.id = NEW.material_version_id;
  IF TG_TABLE_NAME = 'development_material_file_activations' THEN
    event_name := 'research_file_activated';
    event_actor_id := NEW.activated_by_user_id;
    event_metadata := jsonb_build_object('materialVersionId', NEW.material_version_id,
      'accessClass', NEW.access_class);
  ELSIF TG_TABLE_NAME = 'development_material_file_accesses' THEN
    event_name := 'research_file_accessed';
    event_actor_id := NEW.accessed_by_user_id;
    event_metadata := jsonb_build_object('materialVersionId', NEW.material_version_id,
      'accessKind', NEW.access_kind);
  ELSE
    RAISE EXCEPTION 'Unexpected research file event source';
  END IF;
  INSERT INTO development_events (topic_id, event_type, actor_user_id, metadata)
  VALUES (target_topic_id, event_name, event_actor_id, event_metadata);
  RETURN NEW;
END;
$$;
CREATE TRIGGER development_material_file_activations_created_event
  AFTER INSERT ON development_material_file_activations
  FOR EACH ROW EXECUTE FUNCTION bestcrm_record_development_material_file_event();
CREATE TRIGGER development_material_file_accesses_created_event
  AFTER INSERT ON development_material_file_accesses
  FOR EACH ROW EXECUTE FUNCTION bestcrm_record_development_material_file_event();
