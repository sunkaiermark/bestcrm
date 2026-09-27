-- P2: concept decisions and design eligibility stay inside BESTCRM. They do
-- not create an engineering product, CAD file, BOM, or customer deliverable.
ALTER TABLE development_concept_decisions
  ADD COLUMN is_self_review boolean NOT NULL DEFAULT false,
  ADD COLUMN self_review_reason text NOT NULL DEFAULT '';
ALTER TABLE development_concept_decisions
  ADD CONSTRAINT development_concept_self_review_reason_check
  CHECK (NOT is_self_review OR btrim(self_review_reason) <> '');

CREATE TABLE development_design_handoffs (
  id bigserial PRIMARY KEY,
  topic_id bigint NOT NULL REFERENCES development_topics(id) ON DELETE RESTRICT,
  revision_id bigint NOT NULL UNIQUE REFERENCES development_concept_revisions(id) ON DELETE RESTRICT,
  decision_id bigint NOT NULL UNIQUE REFERENCES development_concept_decisions(id) ON DELETE RESTRICT,
  requested_by_user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL UNIQUE CHECK (btrim(idempotency_key) <> ''),
  requested_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX development_design_handoffs_topic_recent_idx
  ON development_design_handoffs (topic_id, requested_at DESC, id DESC);
CREATE TRIGGER development_design_handoffs_no_change
  BEFORE UPDATE OR DELETE ON development_design_handoffs
  FOR EACH ROW EXECUTE FUNCTION bestcrm_protect_development_history();

CREATE OR REPLACE FUNCTION bestcrm_guard_development_concept_decision()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target record;
  latest_revision_id bigint;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM users actor
    JOIN user_roles assignment ON assignment.user_id = actor.id
    JOIN roles role ON role.id = assignment.role_id
    WHERE actor.id = NEW.decided_by_user_id AND actor.is_active = true
      AND role.code = 'technical_manager' AND role.is_active = true
  ) THEN
    RAISE EXCEPTION 'Only an active technical manager may decide a development concept';
  END IF;
  SELECT revision.id AS revision_id, revision.topic_id,
         revision.authored_by_user_id, submission.submitted_by_user_id,
         topic.phase
    INTO target
    FROM development_concept_submissions submission
    JOIN development_concept_revisions revision ON revision.id = submission.revision_id
    JOIN development_topics topic ON topic.id = revision.topic_id
    WHERE submission.id = NEW.submission_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Concept submission not found';
  END IF;
  IF NEW.decision_code NOT IN ('approved', 'revise_required') THEN
    RAISE EXCEPTION 'Pause and stop decisions are not enabled yet';
  END IF;
  SELECT id INTO latest_revision_id FROM development_concept_revisions
    WHERE topic_id = target.topic_id ORDER BY revision_no DESC LIMIT 1;
  IF target.revision_id <> latest_revision_id OR target.phase <> 'concept_review' THEN
    RAISE EXCEPTION 'Only the current submitted concept may be decided';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM development_memberships membership
    WHERE membership.topic_id = target.topic_id
      AND membership.user_id = NEW.decided_by_user_id
      AND membership.ended_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Concept reviewer must be an active topic member';
  END IF;
  NEW.is_self_review := NEW.decided_by_user_id IN (
    target.authored_by_user_id, target.submitted_by_user_id
  );
  IF NEW.is_self_review AND btrim(NEW.self_review_reason) = '' THEN
    RAISE EXCEPTION 'Self-review requires a recorded reason';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER development_concept_decisions_current_revision
  BEFORE INSERT ON development_concept_decisions
  FOR EACH ROW EXECUTE FUNCTION bestcrm_guard_development_concept_decision();

CREATE OR REPLACE FUNCTION bestcrm_guard_development_revision_after_handoff()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM development_topics
    WHERE id = NEW.topic_id AND phase = 'detailed_design'
  ) THEN
    RAISE EXCEPTION 'Return topic to exploration before creating a new concept revision';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER development_concept_revisions_no_implicit_handoff_reuse
  BEFORE INSERT ON development_concept_revisions
  FOR EACH ROW EXECUTE FUNCTION bestcrm_guard_development_revision_after_handoff();

CREATE OR REPLACE FUNCTION bestcrm_guard_development_design_handoff()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  latest_revision_id bigint;
  approved_decision_id bigint;
  current_phase text;
  current_owner_id bigint;
BEGIN
  SELECT phase, owner_user_id INTO current_phase, current_owner_id
    FROM development_topics WHERE id = NEW.topic_id;
  SELECT id INTO latest_revision_id FROM development_concept_revisions
    WHERE topic_id = NEW.topic_id ORDER BY revision_no DESC LIMIT 1;
  SELECT decision.id INTO approved_decision_id
    FROM development_concept_revisions revision
    JOIN development_concept_submissions submission ON submission.revision_id = revision.id
    JOIN development_concept_decisions decision ON decision.submission_id = submission.id
    WHERE revision.id = NEW.revision_id AND decision.decision_code = 'approved';
  IF current_phase <> 'concept_review' OR NEW.revision_id IS DISTINCT FROM latest_revision_id
      OR NEW.decision_id IS DISTINCT FROM approved_decision_id THEN
    RAISE EXCEPTION 'Current approved concept is required for formal design handoff';
  END IF;
  IF NEW.requested_by_user_id <> current_owner_id OR NOT EXISTS (
    SELECT 1 FROM users actor
    JOIN development_memberships membership ON membership.user_id = actor.id
    WHERE actor.id = NEW.requested_by_user_id AND actor.is_active = true
      AND membership.topic_id = NEW.topic_id AND membership.ended_at IS NULL
  ) THEN
    RAISE EXCEPTION 'Only an active topic owner may request formal design handoff';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER development_design_handoffs_current_approval
  BEFORE INSERT ON development_design_handoffs
  FOR EACH ROW EXECUTE FUNCTION bestcrm_guard_development_design_handoff();

CREATE OR REPLACE FUNCTION bestcrm_guard_development_detailed_design_phase()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.phase <> 'detailed_design' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD.phase = NEW.phase THEN
      RETURN NEW;
    END IF;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM development_concept_revisions revision
    JOIN development_concept_submissions submission ON submission.revision_id = revision.id
    JOIN development_concept_decisions decision ON decision.submission_id = submission.id
    JOIN development_design_handoffs handoff ON handoff.decision_id = decision.id
      AND handoff.revision_id = revision.id AND handoff.topic_id = NEW.id
    WHERE revision.topic_id = NEW.id AND decision.decision_code = 'approved'
      AND revision.id = (
        SELECT id FROM development_concept_revisions
        WHERE topic_id = NEW.id ORDER BY revision_no DESC LIMIT 1
      )
  ) THEN
    RAISE EXCEPTION 'Current approved concept handoff is required for detailed design';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER development_topics_detailed_design_gate
  BEFORE INSERT OR UPDATE ON development_topics
  FOR EACH ROW EXECUTE FUNCTION bestcrm_guard_development_detailed_design_phase();

CREATE OR REPLACE FUNCTION bestcrm_record_development_design_handoff()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO development_events (
    topic_id, event_type, actor_user_id, concept_revision_id, metadata
  ) VALUES (
    NEW.topic_id, 'formal_design_handoff_requested', NEW.requested_by_user_id,
    NEW.revision_id, jsonb_build_object('handoffId', NEW.id, 'decisionId', NEW.decision_id)
  );
  RETURN NEW;
END;
$$;
CREATE TRIGGER development_design_handoffs_created_event
  AFTER INSERT ON development_design_handoffs
  FOR EACH ROW EXECUTE FUNCTION bestcrm_record_development_design_handoff();
