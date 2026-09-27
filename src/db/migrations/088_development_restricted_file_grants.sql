-- P3c authorization ledger only. This migration does not activate any file,
-- expose a download, or give administrators a content-read bypass.
-- Grants bind to a membership row so leaving and rejoining a topic never
-- silently restores a former membership's access.
CREATE TABLE development_restricted_file_grants (
  id bigserial PRIMARY KEY,
  material_version_id bigint NOT NULL
    REFERENCES development_material_versions(id) ON DELETE RESTRICT,
  grantee_membership_id bigint NOT NULL
    REFERENCES development_memberships(id) ON DELETE RESTRICT,
  granted_by_owner_user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK (btrim(reason) <> '' AND char_length(reason) <= 4000),
  granted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX development_restricted_file_grants_version_idx
  ON development_restricted_file_grants
  (material_version_id, grantee_membership_id, id DESC);
CREATE TRIGGER development_restricted_file_grants_no_change
  BEFORE UPDATE OR DELETE ON development_restricted_file_grants
  FOR EACH ROW EXECUTE FUNCTION bestcrm_protect_development_history();

CREATE TABLE development_restricted_file_grant_revocations (
  id bigserial PRIMARY KEY,
  grant_id bigint NOT NULL UNIQUE
    REFERENCES development_restricted_file_grants(id) ON DELETE RESTRICT,
  revoked_by_owner_user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK (btrim(reason) <> '' AND char_length(reason) <= 4000),
  revoked_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER development_restricted_file_grant_revocations_no_change
  BEFORE UPDATE OR DELETE ON development_restricted_file_grant_revocations
  FOR EACH ROW EXECUTE FUNCTION bestcrm_protect_development_history();

CREATE OR REPLACE FUNCTION bestcrm_guard_development_restricted_file_grant()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target_topic_id bigint;
  current_owner_id bigint;
  recipient_user_id bigint;
BEGIN
  SELECT material.topic_id INTO target_topic_id
    FROM development_material_versions version
    JOIN development_materials material ON material.id = version.material_id
    WHERE version.id = NEW.material_version_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Research material version not found'; END IF;

  SELECT owner_user_id INTO current_owner_id
    FROM development_topics WHERE id = target_topic_id FOR UPDATE;
  IF current_owner_id IS DISTINCT FROM NEW.granted_by_owner_user_id THEN
    RAISE EXCEPTION 'Only the active topic owner may grant restricted file access';
  END IF;
  PERFORM 1 FROM development_memberships membership
    JOIN users actor ON actor.id = membership.user_id
    WHERE membership.topic_id = target_topic_id
      AND membership.user_id = NEW.granted_by_owner_user_id
      AND membership.added_at <= now() AND membership.ended_at IS NULL
      AND actor.is_active = true
    FOR SHARE OF membership, actor;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Only the active topic owner may grant restricted file access';
  END IF;
  SELECT membership.user_id INTO recipient_user_id
    FROM development_memberships membership
    JOIN users actor ON actor.id = membership.user_id
    WHERE membership.id = NEW.grantee_membership_id
      AND membership.topic_id = target_topic_id
      AND membership.added_at <= now() AND membership.ended_at IS NULL
      AND actor.is_active = true
    FOR SHARE OF membership, actor;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Recipient must be an active member of the same topic';
  END IF;
  IF EXISTS (
    SELECT 1 FROM development_restricted_file_grants prior
    WHERE prior.material_version_id = NEW.material_version_id
      AND prior.grantee_membership_id = NEW.grantee_membership_id
      AND NOT EXISTS (
        SELECT 1 FROM development_restricted_file_grant_revocations revoked
        WHERE revoked.grant_id = prior.id
      )
  ) THEN
    RAISE EXCEPTION 'An active grant already exists for this membership';
  END IF;
  NEW.granted_at := now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER development_restricted_file_grants_guard_insert
  BEFORE INSERT ON development_restricted_file_grants
  FOR EACH ROW EXECUTE FUNCTION bestcrm_guard_development_restricted_file_grant();

CREATE OR REPLACE FUNCTION bestcrm_guard_development_restricted_file_revocation()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target_topic_id bigint;
  current_owner_id bigint;
BEGIN
  SELECT material.topic_id INTO target_topic_id
    FROM development_restricted_file_grants grant_row
    JOIN development_material_versions version
      ON version.id = grant_row.material_version_id
    JOIN development_materials material ON material.id = version.material_id
    WHERE grant_row.id = NEW.grant_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Research file grant not found'; END IF;
  SELECT owner_user_id INTO current_owner_id
    FROM development_topics WHERE id = target_topic_id FOR UPDATE;
  IF current_owner_id IS DISTINCT FROM NEW.revoked_by_owner_user_id THEN
    RAISE EXCEPTION 'Only the active topic owner may revoke restricted file access';
  END IF;
  PERFORM 1 FROM development_memberships membership
    JOIN users actor ON actor.id = membership.user_id
    WHERE membership.topic_id = target_topic_id
      AND membership.user_id = NEW.revoked_by_owner_user_id
      AND membership.added_at <= now() AND membership.ended_at IS NULL
      AND actor.is_active = true
    FOR SHARE OF membership, actor;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Only the active topic owner may revoke restricted file access';
  END IF;
  NEW.revoked_at := now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER development_restricted_file_grant_revocations_guard_insert
  BEFORE INSERT ON development_restricted_file_grant_revocations
  FOR EACH ROW EXECUTE FUNCTION bestcrm_guard_development_restricted_file_revocation();

CREATE OR REPLACE FUNCTION bestcrm_record_development_restricted_file_access()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target_topic_id bigint;
  event_actor_id bigint;
  event_name text;
  event_metadata jsonb;
BEGIN
  IF TG_TABLE_NAME = 'development_restricted_file_grants' THEN
    SELECT material.topic_id INTO target_topic_id
      FROM development_material_versions version
      JOIN development_materials material ON material.id = version.material_id
      WHERE version.id = NEW.material_version_id;
    event_actor_id := NEW.granted_by_owner_user_id;
    event_name := 'restricted_file_access_granted';
    event_metadata := jsonb_build_object('grantId', NEW.id,
      'materialVersionId', NEW.material_version_id,
      'granteeMembershipId', NEW.grantee_membership_id);
  ELSIF TG_TABLE_NAME = 'development_restricted_file_grant_revocations' THEN
    SELECT material.topic_id INTO target_topic_id
      FROM development_restricted_file_grants grant_row
      JOIN development_material_versions version
        ON version.id = grant_row.material_version_id
      JOIN development_materials material ON material.id = version.material_id
      WHERE grant_row.id = NEW.grant_id;
    event_actor_id := NEW.revoked_by_owner_user_id;
    event_name := 'restricted_file_access_revoked';
    event_metadata := jsonb_build_object('grantId', NEW.grant_id,
      'revocationId', NEW.id);
  ELSE
    RAISE EXCEPTION 'Unexpected research access ledger';
  END IF;
  INSERT INTO development_events (topic_id, event_type, actor_user_id, metadata)
  VALUES (target_topic_id, event_name, event_actor_id, event_metadata);
  RETURN NEW;
END;
$$;
CREATE TRIGGER development_restricted_file_grants_created_event
  AFTER INSERT ON development_restricted_file_grants
  FOR EACH ROW EXECUTE FUNCTION bestcrm_record_development_restricted_file_access();
CREATE TRIGGER development_restricted_file_grant_revocations_created_event
  AFTER INSERT ON development_restricted_file_grant_revocations
  FOR EACH ROW EXECUTE FUNCTION bestcrm_record_development_restricted_file_access();

-- This answers only whether an explicit grant is currently valid. It is not
-- a complete file-read decision: the caller must also check file activation,
-- classification, and the user's current topic membership.
CREATE OR REPLACE FUNCTION bestcrm_development_has_restricted_file_grant(
  p_material_version_id bigint, p_user_id bigint
) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM development_restricted_file_grants grant_row
    JOIN development_memberships membership
      ON membership.id = grant_row.grantee_membership_id
    JOIN users actor ON actor.id = membership.user_id
    JOIN development_material_versions version
      ON version.id = grant_row.material_version_id
    JOIN development_materials material ON material.id = version.material_id
    WHERE grant_row.material_version_id = p_material_version_id
      AND membership.user_id = p_user_id
      AND membership.topic_id = material.topic_id
      AND membership.added_at <= now() AND membership.ended_at IS NULL
      AND actor.is_active = true
      AND NOT EXISTS (
        SELECT 1 FROM development_restricted_file_grant_revocations revoked
        WHERE revoked.grant_id = grant_row.id
      )
  );
$$;
