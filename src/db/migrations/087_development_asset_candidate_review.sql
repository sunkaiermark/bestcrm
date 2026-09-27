-- P3b: record an independent review of a precise asset candidate.
-- An endorsed review is not a published asset, a file access grant, or
-- permission to use the underlying research in a customer opportunity.
CREATE TABLE development_asset_candidate_reviews (
  id bigserial PRIMARY KEY,
  candidate_id bigint NOT NULL UNIQUE
    REFERENCES development_asset_candidates(id) ON DELETE RESTRICT,
  decision_code text NOT NULL CHECK (decision_code IN ('endorsed', 'revision_required')),
  reason text NOT NULL CHECK (btrim(reason) <> '' AND char_length(reason) <= 4000),
  reviewed_by_user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reviewed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX development_asset_candidate_reviews_reviewer_idx
  ON development_asset_candidate_reviews (reviewed_by_user_id, reviewed_at DESC, id DESC);
CREATE TRIGGER development_asset_candidate_reviews_no_change
  BEFORE UPDATE OR DELETE ON development_asset_candidate_reviews
  FOR EACH ROW EXECUTE FUNCTION bestcrm_protect_development_history();

CREATE OR REPLACE FUNCTION bestcrm_guard_development_asset_candidate_review()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target record;
  latest_revision_id bigint;
BEGIN
  SELECT candidate.outcome_revision_id, candidate.proposed_by_user_id,
         revision.topic_id, revision.authored_by_user_id
    INTO target
    FROM development_asset_candidates candidate
    JOIN development_outcome_revisions revision
      ON revision.id = candidate.outcome_revision_id
    WHERE candidate.id = NEW.candidate_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Development asset candidate not found'; END IF;

  -- Outcome revision creation uses this same topic lock. A review cannot
  -- succeed against a revision made stale concurrently by a new revision.
  PERFORM 1 FROM development_topics WHERE id = target.topic_id FOR UPDATE;
  SELECT id INTO latest_revision_id FROM development_outcome_revisions
    WHERE topic_id = target.topic_id ORDER BY revision_no DESC LIMIT 1;
  IF target.outcome_revision_id <> latest_revision_id THEN
    RAISE EXCEPTION 'Only the current outcome revision may be reviewed';
  END IF;
  IF NEW.reviewed_by_user_id IN (
      target.authored_by_user_id, target.proposed_by_user_id) THEN
    RAISE EXCEPTION 'An outcome author or candidate proposer cannot review their own work';
  END IF;

  -- Lock the current role and membership rows until this review commits.
  -- A P2 proxy appointment is deliberately not an alternative to membership.
  PERFORM 1 FROM users actor
    JOIN user_roles assignment ON assignment.user_id = actor.id
    JOIN roles role ON role.id = assignment.role_id
    JOIN development_memberships membership ON membership.user_id = actor.id
    WHERE actor.id = NEW.reviewed_by_user_id AND actor.is_active = true
      AND role.code = 'technical_manager' AND role.is_active = true
      AND membership.topic_id = target.topic_id
      AND membership.added_at <= now() AND membership.ended_at IS NULL
    FOR SHARE OF actor, assignment, role, membership;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Reviewer must be an active technical manager and active topic member';
  END IF;
  NEW.reviewed_at := now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER development_asset_candidate_reviews_guard_insert
  BEFORE INSERT ON development_asset_candidate_reviews
  FOR EACH ROW EXECUTE FUNCTION bestcrm_guard_development_asset_candidate_review();

CREATE OR REPLACE FUNCTION bestcrm_record_development_asset_candidate_review()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target_topic_id bigint;
  target_revision_id bigint;
BEGIN
  SELECT revision.topic_id, revision.id
    INTO target_topic_id, target_revision_id
    FROM development_asset_candidates candidate
    JOIN development_outcome_revisions revision
      ON revision.id = candidate.outcome_revision_id
    WHERE candidate.id = NEW.candidate_id;
  INSERT INTO development_events (topic_id, event_type, actor_user_id, metadata)
  VALUES (target_topic_id, 'asset_candidate_reviewed', NEW.reviewed_by_user_id,
    jsonb_build_object('candidateId', NEW.candidate_id,
      'outcomeRevisionId', target_revision_id, 'decisionCode', NEW.decision_code));
  RETURN NEW;
END;
$$;
CREATE TRIGGER development_asset_candidate_reviews_created_event
  AFTER INSERT ON development_asset_candidate_reviews
  FOR EACH ROW EXECUTE FUNCTION bestcrm_record_development_asset_candidate_review();
