-- A published technical asset is an explicit, immutable internal release of
-- an independently endorsed, exact outcome revision. It grants no access to
-- research originals and no customer-facing use permission.
-- Existing blocked revisions stay blocked. New revisions may be internally
-- visible to current topic members after the explicit confidentiality policy.
ALTER TABLE development_outcome_revisions
  DROP CONSTRAINT development_outcome_revisions_access_policy_state_check;
ALTER TABLE development_outcome_revisions
  ADD CONSTRAINT development_outcome_revisions_access_policy_state_check
  CHECK (access_policy_state IN ('blocked_pending_policy', 'topic_internal'));
ALTER TABLE development_outcome_revisions
  ALTER COLUMN access_policy_state SET DEFAULT 'topic_internal';

CREATE TABLE development_assets (
  id bigserial PRIMARY KEY,
  candidate_review_id bigint NOT NULL UNIQUE
    REFERENCES development_asset_candidate_reviews(id) ON DELETE RESTRICT,
  outcome_revision_id bigint NOT NULL UNIQUE
    REFERENCES development_outcome_revisions(id) ON DELETE RESTRICT,
  publication_reason text NOT NULL
    CHECK (btrim(publication_reason) <> '' AND char_length(publication_reason) <= 4000),
  published_by_user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  published_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX development_assets_recent_idx ON development_assets (published_at DESC, id DESC);
CREATE TRIGGER development_assets_no_change
  BEFORE UPDATE OR DELETE ON development_assets
  FOR EACH ROW EXECUTE FUNCTION bestcrm_protect_development_history();

CREATE TABLE development_asset_withdrawals (
  id bigserial PRIMARY KEY,
  asset_id bigint NOT NULL UNIQUE REFERENCES development_assets(id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK (btrim(reason) <> '' AND char_length(reason) <= 4000),
  withdrawn_by_user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  withdrawn_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER development_asset_withdrawals_no_change
  BEFORE UPDATE OR DELETE ON development_asset_withdrawals
  FOR EACH ROW EXECUTE FUNCTION bestcrm_protect_development_history();

CREATE OR REPLACE FUNCTION bestcrm_guard_development_internal_asset()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target record;
  current_revision_id bigint;
  actor_id bigint;
  target_topic_id bigint;
BEGIN
  IF TG_TABLE_NAME = 'development_assets' THEN
    SELECT revision.topic_id, revision.id AS revision_id,
      revision.authored_by_user_id, candidate.proposed_by_user_id,
      revision.access_policy_state, review.decision_code
    INTO target
    FROM development_asset_candidate_reviews review
    JOIN development_asset_candidates candidate ON candidate.id = review.candidate_id
    JOIN development_outcome_revisions revision ON revision.id = candidate.outcome_revision_id
    WHERE review.id = NEW.candidate_review_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Asset review not found'; END IF;
    IF target.revision_id <> NEW.outcome_revision_id THEN
      RAISE EXCEPTION 'Asset review and outcome revision must match';
    END IF;
    target_topic_id := target.topic_id;
    actor_id := NEW.published_by_user_id;
    PERFORM 1 FROM development_topics WHERE id = target_topic_id FOR UPDATE;
    SELECT id INTO current_revision_id FROM development_outcome_revisions
      WHERE topic_id = target_topic_id ORDER BY revision_no DESC LIMIT 1;
    IF target.decision_code <> 'endorsed' OR current_revision_id <> target.revision_id
      OR target.access_policy_state <> 'topic_internal' THEN
      RAISE EXCEPTION 'Current independently endorsed outcome is required for publication';
    END IF;
    IF actor_id IN (target.authored_by_user_id, target.proposed_by_user_id) THEN
      RAISE EXCEPTION 'Outcome author or candidate proposer cannot publish their own asset';
    END IF;
  ELSIF TG_TABLE_NAME = 'development_asset_withdrawals' THEN
    SELECT revision.topic_id INTO target_topic_id
    FROM development_assets asset
    JOIN development_outcome_revisions revision ON revision.id = asset.outcome_revision_id
    WHERE asset.id = NEW.asset_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'Development asset not found'; END IF;
    actor_id := NEW.withdrawn_by_user_id;
    PERFORM 1 FROM development_topics WHERE id = target_topic_id FOR UPDATE;
  ELSE
    RAISE EXCEPTION 'Unexpected development asset action';
  END IF;

  PERFORM 1 FROM users actor
    JOIN user_roles assignment ON assignment.user_id = actor.id
    JOIN roles role ON role.id = assignment.role_id
    JOIN development_memberships membership ON membership.user_id = actor.id
    WHERE actor.id = actor_id AND actor.is_active = true
      AND role.code = 'technical_manager' AND role.is_active = true
      AND membership.topic_id = target_topic_id
      AND membership.added_at <= now() AND membership.ended_at IS NULL
    FOR SHARE OF actor, assignment, role, membership;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Publisher must be an active technical manager and active topic member';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER development_assets_guard_insert
  BEFORE INSERT ON development_assets
  FOR EACH ROW EXECUTE FUNCTION bestcrm_guard_development_internal_asset();
CREATE TRIGGER development_asset_withdrawals_guard_insert
  BEFORE INSERT ON development_asset_withdrawals
  FOR EACH ROW EXECUTE FUNCTION bestcrm_guard_development_internal_asset();

CREATE OR REPLACE FUNCTION bestcrm_record_development_internal_asset_event()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target_topic_id bigint;
  actor_id bigint;
  event_name text;
  event_metadata jsonb;
BEGIN
  IF TG_TABLE_NAME = 'development_assets' THEN
    SELECT topic_id INTO target_topic_id FROM development_outcome_revisions
      WHERE id = NEW.outcome_revision_id;
    actor_id := NEW.published_by_user_id;
    event_name := 'internal_asset_published';
    event_metadata := jsonb_build_object('assetId', NEW.id,
      'outcomeRevisionId', NEW.outcome_revision_id);
  ELSE
    SELECT revision.topic_id INTO target_topic_id
    FROM development_assets asset
    JOIN development_outcome_revisions revision ON revision.id = asset.outcome_revision_id
    WHERE asset.id = NEW.asset_id;
    actor_id := NEW.withdrawn_by_user_id;
    event_name := 'internal_asset_withdrawn';
    event_metadata := jsonb_build_object('assetId', NEW.asset_id,
      'withdrawalId', NEW.id);
  END IF;
  INSERT INTO development_events (topic_id, event_type, actor_user_id, metadata)
  VALUES (target_topic_id, event_name, actor_id, event_metadata);
  RETURN NEW;
END;
$$;
CREATE TRIGGER development_assets_created_event
  AFTER INSERT ON development_assets
  FOR EACH ROW EXECUTE FUNCTION bestcrm_record_development_internal_asset_event();
CREATE TRIGGER development_asset_withdrawals_created_event
  AFTER INSERT ON development_asset_withdrawals
  FOR EACH ROW EXECUTE FUNCTION bestcrm_record_development_internal_asset_event();
