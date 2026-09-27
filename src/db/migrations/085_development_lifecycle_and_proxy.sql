-- P2 policy resolution: an administrator records a dated, topic-scoped
-- replacement technical manager. Lifecycle changes are separately requested
-- by the topic owner and approved/rejected by an administrator.
CREATE OR REPLACE FUNCTION bestcrm_development_has_active_role(actor_id bigint, role_code text)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM users actor
    JOIN user_roles assignment ON assignment.user_id = actor.id
    JOIN roles role ON role.id = assignment.role_id
    WHERE actor.id = actor_id AND actor.is_active = true
      AND role.code = role_code AND role.is_active = true
  );
$$;

CREATE TABLE development_reviewer_delegations (
  id bigserial PRIMARY KEY,
  topic_id bigint NOT NULL REFERENCES development_topics(id) ON DELETE RESTRICT,
  absent_manager_user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  proxy_manager_user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  valid_from timestamptz NOT NULL,
  valid_until timestamptz NOT NULL,
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  recorded_by_admin_user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL UNIQUE CHECK (btrim(idempotency_key) <> ''),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CHECK (absent_manager_user_id <> proxy_manager_user_id),
  CHECK (valid_until > valid_from)
);
CREATE INDEX development_reviewer_delegations_active_idx
  ON development_reviewer_delegations (topic_id, proxy_manager_user_id, valid_until DESC);
CREATE TRIGGER development_reviewer_delegations_no_change
  BEFORE UPDATE OR DELETE ON development_reviewer_delegations
  FOR EACH ROW EXECUTE FUNCTION bestcrm_protect_development_history();

CREATE TABLE development_reviewer_delegation_revocations (
  id bigserial PRIMARY KEY,
  delegation_id bigint NOT NULL UNIQUE
    REFERENCES development_reviewer_delegations(id) ON DELETE RESTRICT,
  revoked_by_admin_user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  idempotency_key text NOT NULL UNIQUE CHECK (btrim(idempotency_key) <> ''),
  revoked_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER development_reviewer_delegation_revocations_no_change
  BEFORE UPDATE OR DELETE ON development_reviewer_delegation_revocations
  FOR EACH ROW EXECUTE FUNCTION bestcrm_protect_development_history();

CREATE OR REPLACE FUNCTION bestcrm_guard_development_reviewer_delegation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.valid_until <= now() THEN
    RAISE EXCEPTION 'Reviewer delegation term must end in the future';
  END IF;
  IF NOT bestcrm_development_has_active_role(NEW.recorded_by_admin_user_id, 'administrator') THEN
    RAISE EXCEPTION 'Only an active administrator may record a reviewer delegation';
  END IF;
  IF NOT bestcrm_development_has_active_role(NEW.absent_manager_user_id, 'technical_manager')
      OR NOT bestcrm_development_has_active_role(NEW.proxy_manager_user_id, 'technical_manager') THEN
    RAISE EXCEPTION 'Both delegated reviewers must be active technical managers';
  END IF;
  PERFORM 1 FROM development_topics WHERE id = NEW.topic_id FOR UPDATE;
  IF NOT EXISTS (
    SELECT 1 FROM development_memberships membership
    WHERE membership.topic_id = NEW.topic_id
      AND membership.user_id = NEW.absent_manager_user_id
      AND membership.ended_at IS NULL
  ) THEN
    RAISE EXCEPTION 'The absent technical manager must be assigned to the topic';
  END IF;
  IF EXISTS (
    SELECT 1 FROM development_reviewer_delegations existing
    WHERE existing.topic_id = NEW.topic_id
      AND existing.absent_manager_user_id = NEW.absent_manager_user_id
      AND existing.valid_from < NEW.valid_until
      AND existing.valid_until > NEW.valid_from
      AND NOT EXISTS (
        SELECT 1 FROM development_reviewer_delegation_revocations revoked
        WHERE revoked.delegation_id = existing.id
      )
  ) THEN
    RAISE EXCEPTION 'Overlapping active delegation for this technical manager';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER development_reviewer_delegations_guard_insert
  BEFORE INSERT ON development_reviewer_delegations
  FOR EACH ROW EXECUTE FUNCTION bestcrm_guard_development_reviewer_delegation();

CREATE OR REPLACE FUNCTION bestcrm_guard_development_reviewer_revocation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT bestcrm_development_has_active_role(NEW.revoked_by_admin_user_id, 'administrator') THEN
    RAISE EXCEPTION 'Only an active administrator may revoke a reviewer delegation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER development_reviewer_delegation_revocations_guard_insert
  BEFORE INSERT ON development_reviewer_delegation_revocations
  FOR EACH ROW EXECUTE FUNCTION bestcrm_guard_development_reviewer_revocation();

ALTER TABLE development_concept_decisions
  ADD COLUMN delegation_id bigint
    REFERENCES development_reviewer_delegations(id) ON DELETE RESTRICT;

CREATE OR REPLACE FUNCTION bestcrm_guard_development_concept_decision()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target record;
  latest_revision_id bigint;
  active_delegation_id bigint;
BEGIN
  IF NOT bestcrm_development_has_active_role(NEW.decided_by_user_id, 'technical_manager') THEN
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
  IF NOT FOUND THEN RAISE EXCEPTION 'Concept submission not found'; END IF;
  IF NEW.decision_code NOT IN ('approved', 'revise_required') THEN
    RAISE EXCEPTION 'Concept pause and stop decisions are managed by administrator lifecycle approval';
  END IF;
  SELECT id INTO latest_revision_id FROM development_concept_revisions
    WHERE topic_id = target.topic_id ORDER BY revision_no DESC LIMIT 1;
  IF target.revision_id <> latest_revision_id OR target.phase <> 'concept_review' THEN
    RAISE EXCEPTION 'Only the current submitted concept may be decided';
  END IF;
  SELECT delegation.id INTO active_delegation_id
    FROM development_reviewer_delegations delegation
    WHERE delegation.topic_id = target.topic_id
      AND delegation.proxy_manager_user_id = NEW.decided_by_user_id
      AND delegation.valid_from <= now() AND delegation.valid_until > now()
      AND bestcrm_development_has_active_role(
        delegation.absent_manager_user_id, 'technical_manager'
      )
      AND EXISTS (
        SELECT 1 FROM development_memberships membership
        WHERE membership.topic_id = delegation.topic_id
          AND membership.user_id = delegation.absent_manager_user_id
          AND membership.ended_at IS NULL
      )
      AND NOT EXISTS (
        SELECT 1 FROM development_reviewer_delegation_revocations revoked
        WHERE revoked.delegation_id = delegation.id
      )
    ORDER BY delegation.id DESC LIMIT 1;
  IF NEW.delegation_id IS NOT NULL THEN
    IF NEW.delegation_id IS DISTINCT FROM active_delegation_id THEN
      RAISE EXCEPTION 'Reviewer delegation is invalid or expired';
    END IF;
  ELSIF NOT EXISTS (
    SELECT 1 FROM development_memberships membership
    WHERE membership.topic_id = target.topic_id
      AND membership.user_id = NEW.decided_by_user_id
      AND membership.ended_at IS NULL
  ) THEN
    IF active_delegation_id IS NULL THEN
      RAISE EXCEPTION 'Concept reviewer must be a topic member or appointed proxy';
    END IF;
    NEW.delegation_id := active_delegation_id;
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

CREATE TABLE development_lifecycle_requests (
  id bigserial PRIMARY KEY,
  topic_id bigint NOT NULL REFERENCES development_topics(id) ON DELETE RESTRICT,
  action_code text NOT NULL CHECK (action_code IN ('pause', 'stop', 'resume')),
  from_phase text NOT NULL,
  resume_to_phase text NOT NULL,
  topic_row_version bigint NOT NULL CHECK (topic_row_version > 0),
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  requested_by_user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL UNIQUE CHECK (btrim(idempotency_key) <> ''),
  requested_at timestamptz NOT NULL DEFAULT now(),
  CHECK (resume_to_phase NOT IN ('paused', 'stopped', 'concluded'))
);
CREATE INDEX development_lifecycle_requests_topic_recent_idx
  ON development_lifecycle_requests (topic_id, requested_at DESC, id DESC);
CREATE TRIGGER development_lifecycle_requests_no_change
  BEFORE UPDATE OR DELETE ON development_lifecycle_requests
  FOR EACH ROW EXECUTE FUNCTION bestcrm_protect_development_history();

CREATE TABLE development_lifecycle_decisions (
  id bigserial PRIMARY KEY,
  request_id bigint NOT NULL UNIQUE REFERENCES development_lifecycle_requests(id) ON DELETE RESTRICT,
  decision_code text NOT NULL CHECK (decision_code IN ('approved', 'rejected')),
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  decided_by_admin_user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  is_self_approval boolean NOT NULL DEFAULT false,
  self_approval_reason text NOT NULL DEFAULT '',
  idempotency_key text NOT NULL UNIQUE CHECK (btrim(idempotency_key) <> ''),
  decided_at timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT is_self_approval OR btrim(self_approval_reason) <> '')
);
CREATE TRIGGER development_lifecycle_decisions_no_change
  BEFORE UPDATE OR DELETE ON development_lifecycle_decisions
  FOR EACH ROW EXECUTE FUNCTION bestcrm_protect_development_history();

CREATE OR REPLACE FUNCTION bestcrm_guard_development_lifecycle_request()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  current_topic record;
  last_transition record;
BEGIN
  SELECT * INTO current_topic FROM development_topics WHERE id = NEW.topic_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Development topic not found'; END IF;
  IF current_topic.owner_user_id <> NEW.requested_by_user_id OR NOT EXISTS (
    SELECT 1 FROM development_memberships membership
    JOIN users actor ON actor.id = membership.user_id
    WHERE membership.topic_id = NEW.topic_id
      AND membership.user_id = NEW.requested_by_user_id
      AND membership.ended_at IS NULL AND actor.is_active = true
  ) THEN
    RAISE EXCEPTION 'Only the active topic owner may request lifecycle changes';
  END IF;
  IF NEW.from_phase <> current_topic.phase OR
      NEW.topic_row_version <> current_topic.row_version THEN
    RAISE EXCEPTION 'Lifecycle request is based on an outdated topic phase';
  END IF;
  IF EXISTS (
    SELECT 1 FROM development_lifecycle_requests pending
    WHERE pending.topic_id = NEW.topic_id AND NOT EXISTS (
      SELECT 1 FROM development_lifecycle_decisions decision
      WHERE decision.request_id = pending.id
    )
  ) THEN
    RAISE EXCEPTION 'Another lifecycle request is pending';
  END IF;
  SELECT request.action_code, request.resume_to_phase
    INTO last_transition
    FROM development_lifecycle_requests request
    JOIN development_lifecycle_decisions decision ON decision.request_id = request.id
    WHERE request.topic_id = NEW.topic_id AND decision.decision_code = 'approved'
    ORDER BY decision.id DESC LIMIT 1;
  IF NEW.action_code = 'resume' THEN
    IF current_topic.phase NOT IN ('paused', 'stopped') OR
        last_transition.action_code IS NULL OR
        last_transition.action_code NOT IN ('pause', 'stop') OR
        NEW.resume_to_phase <> last_transition.resume_to_phase THEN
      RAISE EXCEPTION 'Only paused or stopped topics may resume their recorded phase';
    END IF;
  ELSIF NEW.action_code = 'stop' AND current_topic.phase = 'paused' THEN
    IF last_transition.action_code IS NULL OR
        NEW.resume_to_phase <> last_transition.resume_to_phase THEN
      RAISE EXCEPTION 'Stop must preserve the pre-pause recovery phase';
    END IF;
  ELSIF NEW.action_code IN ('pause', 'stop') THEN
    IF current_topic.phase IN ('paused', 'stopped', 'concluded') OR
        NEW.resume_to_phase <> current_topic.phase THEN
      RAISE EXCEPTION 'Topic cannot pause or stop from this phase';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER development_lifecycle_requests_guard_insert
  BEFORE INSERT ON development_lifecycle_requests
  FOR EACH ROW EXECUTE FUNCTION bestcrm_guard_development_lifecycle_request();

CREATE OR REPLACE FUNCTION bestcrm_guard_development_lifecycle_decision()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  request record;
  current_topic record;
BEGIN
  IF NOT bestcrm_development_has_active_role(NEW.decided_by_admin_user_id, 'administrator') THEN
    RAISE EXCEPTION 'Only an active administrator may decide a lifecycle request';
  END IF;
  SELECT * INTO request FROM development_lifecycle_requests WHERE id = NEW.request_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lifecycle request not found'; END IF;
  SELECT * INTO current_topic FROM development_topics WHERE id = request.topic_id FOR UPDATE;
  IF NEW.decision_code = 'approved' AND (
      current_topic.phase <> request.from_phase OR
      current_topic.row_version <> request.topic_row_version) THEN
    RAISE EXCEPTION 'Lifecycle request is stale';
  END IF;
  NEW.is_self_approval := request.requested_by_user_id = NEW.decided_by_admin_user_id;
  IF NEW.is_self_approval AND btrim(NEW.self_approval_reason) = '' THEN
    RAISE EXCEPTION 'Administrator self-approval requires a recorded reason';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER development_lifecycle_decisions_guard_insert
  BEFORE INSERT ON development_lifecycle_decisions
  FOR EACH ROW EXECUTE FUNCTION bestcrm_guard_development_lifecycle_decision();

CREATE OR REPLACE FUNCTION bestcrm_guard_development_lifecycle_phase()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.phase IN ('paused', 'stopped') THEN
      RAISE EXCEPTION 'Lifecycle approval is required before pausing or stopping a topic';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.phase = OLD.phase OR
      (NEW.phase NOT IN ('paused', 'stopped') AND OLD.phase NOT IN ('paused', 'stopped')) THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM development_lifecycle_requests request
    JOIN development_lifecycle_decisions decision ON decision.request_id = request.id
    WHERE request.topic_id = NEW.id
      AND request.from_phase = OLD.phase
      AND request.topic_row_version = OLD.row_version
      AND decision.decision_code = 'approved'
      AND (
        (request.action_code = 'pause' AND NEW.phase = 'paused') OR
        (request.action_code = 'stop' AND NEW.phase = 'stopped') OR
        (request.action_code = 'resume' AND NEW.phase = request.resume_to_phase)
      )
  ) THEN
    RAISE EXCEPTION 'Approved lifecycle request is required for this phase change';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER development_topics_lifecycle_gate
  BEFORE INSERT OR UPDATE ON development_topics
  FOR EACH ROW EXECUTE FUNCTION bestcrm_guard_development_lifecycle_phase();

CREATE OR REPLACE FUNCTION bestcrm_apply_development_lifecycle_decision()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  request record;
  next_phase text;
BEGIN
  IF NEW.decision_code <> 'approved' THEN RETURN NEW; END IF;
  SELECT * INTO request FROM development_lifecycle_requests WHERE id = NEW.request_id;
  next_phase := CASE request.action_code
    WHEN 'pause' THEN 'paused'
    WHEN 'stop' THEN 'stopped'
    ELSE request.resume_to_phase
  END;
  UPDATE development_topics
  SET phase = next_phase, row_version = row_version + 1,
      updated_by_user_id = NEW.decided_by_admin_user_id, updated_at = now()
  WHERE id = request.topic_id;
  RETURN NEW;
END;
$$;
CREATE TRIGGER development_lifecycle_decisions_apply
  AFTER INSERT ON development_lifecycle_decisions
  FOR EACH ROW EXECUTE FUNCTION bestcrm_apply_development_lifecycle_decision();

CREATE OR REPLACE FUNCTION bestcrm_record_development_policy_event()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  event_topic_id bigint;
  event_actor_id bigint;
  event_name text;
  event_metadata jsonb;
BEGIN
  CASE TG_TABLE_NAME
    WHEN 'development_reviewer_delegations' THEN
      event_topic_id := NEW.topic_id;
      event_actor_id := NEW.recorded_by_admin_user_id;
      event_name := 'reviewer_proxy_appointed';
      event_metadata := jsonb_build_object('delegationId', NEW.id,
        'absentManagerUserId', NEW.absent_manager_user_id,
        'proxyManagerUserId', NEW.proxy_manager_user_id,
        'validFrom', NEW.valid_from, 'validUntil', NEW.valid_until);
    WHEN 'development_reviewer_delegation_revocations' THEN
      SELECT topic_id INTO event_topic_id FROM development_reviewer_delegations
      WHERE id = NEW.delegation_id;
      event_actor_id := NEW.revoked_by_admin_user_id;
      event_name := 'reviewer_proxy_revoked';
      event_metadata := jsonb_build_object('delegationId', NEW.delegation_id);
    WHEN 'development_lifecycle_requests' THEN
      event_topic_id := NEW.topic_id;
      event_actor_id := NEW.requested_by_user_id;
      event_name := 'lifecycle_requested';
      event_metadata := jsonb_build_object('requestId', NEW.id,
        'actionCode', NEW.action_code, 'fromPhase', NEW.from_phase,
        'resumeToPhase', NEW.resume_to_phase);
    WHEN 'development_lifecycle_decisions' THEN
      SELECT topic_id INTO event_topic_id FROM development_lifecycle_requests
      WHERE id = NEW.request_id;
      event_actor_id := NEW.decided_by_admin_user_id;
      event_name := 'lifecycle_decided';
      event_metadata := jsonb_build_object('requestId', NEW.request_id,
        'decisionCode', NEW.decision_code, 'isSelfApproval', NEW.is_self_approval);
    ELSE
      RAISE EXCEPTION 'Unexpected development policy event source';
  END CASE;
  INSERT INTO development_events (topic_id, event_type, actor_user_id, metadata)
  VALUES (event_topic_id, event_name, event_actor_id, event_metadata);
  RETURN NEW;
END;
$$;
CREATE TRIGGER development_reviewer_delegations_created_event
  AFTER INSERT ON development_reviewer_delegations
  FOR EACH ROW EXECUTE FUNCTION bestcrm_record_development_policy_event();
CREATE TRIGGER development_reviewer_delegation_revocations_created_event
  AFTER INSERT ON development_reviewer_delegation_revocations
  FOR EACH ROW EXECUTE FUNCTION bestcrm_record_development_policy_event();
CREATE TRIGGER development_lifecycle_requests_created_event
  AFTER INSERT ON development_lifecycle_requests
  FOR EACH ROW EXECUTE FUNCTION bestcrm_record_development_policy_event();
CREATE TRIGGER development_lifecycle_decisions_created_event
  AFTER INSERT ON development_lifecycle_decisions
  FOR EACH ROW EXECUTE FUNCTION bestcrm_record_development_policy_event();
