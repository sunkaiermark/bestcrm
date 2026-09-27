-- P1 only: no routes or production data backfill. NPD identities are independent
-- of opportunity numbers and of CRM product-category codes.
CREATE SEQUENCE development_topic_number_seq AS bigint START WITH 1;

CREATE TABLE development_topics (
  id bigserial PRIMARY KEY,
  topic_no text NOT NULL DEFAULT ('NPD-' || nextval('development_topic_number_seq')::text)
    UNIQUE CHECK (topic_no ~ '^NPD-[1-9][0-9]*$'),
  title text NOT NULL CHECK (btrim(title) <> '' AND char_length(title) <= 200),
  source_type text NOT NULL CHECK (source_type IN (
    'customer_idea', 'opportunity_requirement', 'product_upgrade',
    'internal_research', 'implementation_feedback'
  )),
  problem_statement text NOT NULL DEFAULT '' CHECK (char_length(problem_statement) <= 20000),
  phase text NOT NULL DEFAULT 'idea' CHECK (phase IN (
    'idea', 'exploration', 'concept_review', 'detailed_design',
    'verification', 'concluded', 'paused', 'stopped'
  )),
  result text CHECK (result IN ('success', 'partial_success', 'failure', 'undetermined')),
  owner_user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_by_user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by_user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  row_version bigint NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER SEQUENCE development_topic_number_seq OWNED BY development_topics.topic_no;
CREATE INDEX development_topics_owner_phase_idx
  ON development_topics (owner_user_id, phase, updated_at DESC, id DESC);

CREATE TABLE development_topic_directions (
  id bigserial PRIMARY KEY,
  topic_id bigint NOT NULL REFERENCES development_topics(id) ON DELETE RESTRICT,
  direction_code text NOT NULL CHECK (direction_code IN (
    'process_technology', 'key_equipment', 'implementation_support'
  )),
  added_by_user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  added_at timestamptz NOT NULL DEFAULT now(),
  removed_by_user_id bigint REFERENCES users(id) ON DELETE RESTRICT,
  removed_at timestamptz,
  CHECK ((removed_at IS NULL) = (removed_by_user_id IS NULL)),
  CHECK (removed_at IS NULL OR removed_at >= added_at)
);
CREATE UNIQUE INDEX development_topic_directions_active_pair_idx
  ON development_topic_directions (topic_id, direction_code)
  WHERE removed_at IS NULL;
CREATE INDEX development_topic_directions_code_idx
  ON development_topic_directions (direction_code, topic_id)
  WHERE removed_at IS NULL;

CREATE TABLE development_memberships (
  id bigserial PRIMARY KEY,
  topic_id bigint NOT NULL REFERENCES development_topics(id) ON DELETE RESTRICT,
  user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  responsibility_code text NOT NULL CHECK (btrim(responsibility_code) <> ''),
  added_by_user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  added_at timestamptz NOT NULL DEFAULT now(),
  ended_by_user_id bigint REFERENCES users(id) ON DELETE RESTRICT,
  ended_at timestamptz,
  CHECK ((ended_at IS NULL) = (ended_by_user_id IS NULL)),
  CHECK (ended_at IS NULL OR ended_at >= added_at)
);
CREATE UNIQUE INDEX development_memberships_active_topic_user_idx
  ON development_memberships (topic_id, user_id) WHERE ended_at IS NULL;
CREATE INDEX development_memberships_user_active_idx
  ON development_memberships (user_id, topic_id) WHERE ended_at IS NULL;

CREATE TABLE development_opportunity_links (
  id bigserial PRIMARY KEY,
  topic_id bigint NOT NULL REFERENCES development_topics(id) ON DELETE RESTRICT,
  opportunity_id bigint NOT NULL REFERENCES opportunities(id) ON DELETE RESTRICT,
  link_reason text NOT NULL DEFAULT '',
  linked_by_user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  linked_at timestamptz NOT NULL DEFAULT now(),
  unlinked_by_user_id bigint REFERENCES users(id) ON DELETE RESTRICT,
  unlinked_at timestamptz,
  CHECK ((unlinked_at IS NULL) = (unlinked_by_user_id IS NULL)),
  CHECK (unlinked_at IS NULL OR unlinked_at >= linked_at)
);
CREATE UNIQUE INDEX development_opportunity_links_active_pair_idx
  ON development_opportunity_links (topic_id, opportunity_id)
  WHERE unlinked_at IS NULL;
CREATE INDEX development_opportunity_links_opportunity_active_idx
  ON development_opportunity_links (opportunity_id, topic_id)
  WHERE unlinked_at IS NULL;

-- A concept revision is a sealed snapshot. Submission and decision are
-- separate immutable facts; no editable "approved" flag is stored on it.
CREATE TABLE development_concept_revisions (
  id bigserial PRIMARY KEY,
  topic_id bigint NOT NULL REFERENCES development_topics(id) ON DELETE RESTRICT,
  revision_no integer NOT NULL CHECK (revision_no > 0),
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  snapshot_sha256 char(64) NOT NULL CHECK (snapshot_sha256 ~ '^[0-9a-f]{64}$'),
  authored_by_user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  authored_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (topic_id, revision_no)
);
CREATE INDEX development_concept_revisions_topic_recent_idx
  ON development_concept_revisions (topic_id, revision_no DESC);

CREATE TABLE development_concept_submissions (
  id bigserial PRIMARY KEY,
  revision_id bigint NOT NULL UNIQUE REFERENCES development_concept_revisions(id) ON DELETE RESTRICT,
  submitted_by_user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  submitted_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE development_concept_decisions (
  id bigserial PRIMARY KEY,
  submission_id bigint NOT NULL UNIQUE REFERENCES development_concept_submissions(id) ON DELETE RESTRICT,
  decision_code text NOT NULL CHECK (decision_code IN (
    'approved', 'revise_required'
  )),
  reason text NOT NULL CHECK (btrim(reason) <> ''),
  decided_by_user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  idempotency_key text NOT NULL UNIQUE CHECK (btrim(idempotency_key) <> ''),
  decided_at timestamptz NOT NULL DEFAULT now()
);

-- This is a second line of defense. P2 must still enforce object visibility,
-- current revision, self-review policy, and role at the service boundary.
CREATE OR REPLACE FUNCTION bestcrm_require_development_technical_manager()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM users actor
    JOIN user_roles assignment ON assignment.user_id = actor.id
    JOIN roles role ON role.id = assignment.role_id
    WHERE actor.id = NEW.decided_by_user_id
      AND actor.is_active = true
      AND role.code = 'technical_manager'
      AND role.is_active = true
  ) THEN
    RAISE EXCEPTION 'Only an active technical manager may decide a development concept';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER development_concept_decisions_technical_manager
  BEFORE INSERT ON development_concept_decisions
  FOR EACH ROW EXECUTE FUNCTION bestcrm_require_development_technical_manager();

CREATE TABLE development_events (
  id bigserial PRIMARY KEY,
  topic_id bigint NOT NULL REFERENCES development_topics(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (btrim(event_type) <> ''),
  actor_user_id bigint REFERENCES users(id) ON DELETE RESTRICT,
  concept_revision_id bigint REFERENCES development_concept_revisions(id) ON DELETE RESTRICT,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX development_events_topic_recent_idx
  ON development_events (topic_id, created_at DESC, id DESC);

CREATE OR REPLACE FUNCTION bestcrm_protect_development_history()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Development revision and event history is immutable';
END;
$$;
CREATE TRIGGER development_concept_revisions_no_change
  BEFORE UPDATE OR DELETE ON development_concept_revisions
  FOR EACH ROW EXECUTE FUNCTION bestcrm_protect_development_history();
CREATE TRIGGER development_concept_submissions_no_change
  BEFORE UPDATE OR DELETE ON development_concept_submissions
  FOR EACH ROW EXECUTE FUNCTION bestcrm_protect_development_history();
CREATE TRIGGER development_concept_decisions_no_change
  BEFORE UPDATE OR DELETE ON development_concept_decisions
  FOR EACH ROW EXECUTE FUNCTION bestcrm_protect_development_history();
CREATE TRIGGER development_events_no_change
  BEFORE UPDATE OR DELETE ON development_events
  FOR EACH ROW EXECUTE FUNCTION bestcrm_protect_development_history();

CREATE OR REPLACE FUNCTION bestcrm_guard_development_topic_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Development topics cannot be deleted';
  END IF;
  IF NEW.id IS DISTINCT FROM OLD.id
      OR NEW.topic_no IS DISTINCT FROM OLD.topic_no
      OR NEW.source_type IS DISTINCT FROM OLD.source_type
      OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id
      OR NEW.created_at IS DISTINCT FROM OLD.created_at
      OR NEW.row_version <> OLD.row_version + 1
      OR NEW.updated_at < OLD.updated_at THEN
    RAISE EXCEPTION 'Development topic identity is immutable and updates require the next row version';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER development_topics_guard_change
  BEFORE UPDATE OR DELETE ON development_topics
  FOR EACH ROW EXECUTE FUNCTION bestcrm_guard_development_topic_change();

CREATE OR REPLACE FUNCTION bestcrm_guard_development_relation_change()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Development relationships cannot be deleted';
  END IF;
  IF TG_TABLE_NAME = 'development_topic_directions' THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.topic_id IS DISTINCT FROM OLD.topic_id
        OR NEW.direction_code IS DISTINCT FROM OLD.direction_code
        OR NEW.added_by_user_id IS DISTINCT FROM OLD.added_by_user_id
        OR NEW.added_at IS DISTINCT FROM OLD.added_at
        OR OLD.removed_at IS NOT NULL OR NEW.removed_at IS NULL
        OR NEW.removed_by_user_id IS NULL THEN
      RAISE EXCEPTION 'A development direction can only be ended once';
    END IF;
  ELSIF TG_TABLE_NAME = 'development_memberships' THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.topic_id IS DISTINCT FROM OLD.topic_id
        OR NEW.user_id IS DISTINCT FROM OLD.user_id
        OR NEW.responsibility_code IS DISTINCT FROM OLD.responsibility_code
        OR NEW.added_by_user_id IS DISTINCT FROM OLD.added_by_user_id
        OR NEW.added_at IS DISTINCT FROM OLD.added_at
        OR OLD.ended_at IS NOT NULL OR NEW.ended_at IS NULL
        OR NEW.ended_by_user_id IS NULL THEN
      RAISE EXCEPTION 'A development membership can only be ended once';
    END IF;
  ELSIF TG_TABLE_NAME = 'development_opportunity_links' THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.topic_id IS DISTINCT FROM OLD.topic_id
        OR NEW.opportunity_id IS DISTINCT FROM OLD.opportunity_id
        OR NEW.link_reason IS DISTINCT FROM OLD.link_reason
        OR NEW.linked_by_user_id IS DISTINCT FROM OLD.linked_by_user_id
        OR NEW.linked_at IS DISTINCT FROM OLD.linked_at
        OR OLD.unlinked_at IS NOT NULL OR NEW.unlinked_at IS NULL
        OR NEW.unlinked_by_user_id IS NULL THEN
      RAISE EXCEPTION 'A development opportunity link can only be ended once';
    END IF;
  ELSE
    RAISE EXCEPTION 'Unexpected development relationship: %', TG_TABLE_NAME;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER development_topic_directions_guard_change
  BEFORE UPDATE OR DELETE ON development_topic_directions
  FOR EACH ROW EXECUTE FUNCTION bestcrm_guard_development_relation_change();
CREATE TRIGGER development_memberships_guard_change
  BEFORE UPDATE OR DELETE ON development_memberships
  FOR EACH ROW EXECUTE FUNCTION bestcrm_guard_development_relation_change();
CREATE TRIGGER development_opportunity_links_guard_change
  BEFORE UPDATE OR DELETE ON development_opportunity_links
  FOR EACH ROW EXECUTE FUNCTION bestcrm_guard_development_relation_change();

CREATE OR REPLACE FUNCTION bestcrm_record_development_creation()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  event_topic_id bigint;
  event_revision_id bigint;
  event_actor_id bigint;
  event_name text;
  event_metadata jsonb := '{}'::jsonb;
BEGIN
  CASE TG_TABLE_NAME
    WHEN 'development_topics' THEN
      event_topic_id := NEW.id;
      event_actor_id := NEW.created_by_user_id;
      event_name := 'topic_created';
    WHEN 'development_topic_directions' THEN
      event_topic_id := NEW.topic_id;
      event_actor_id := NEW.added_by_user_id;
      event_name := 'direction_added';
      event_metadata := jsonb_build_object('directionId', NEW.id, 'directionCode', NEW.direction_code);
    WHEN 'development_memberships' THEN
      event_topic_id := NEW.topic_id;
      event_actor_id := NEW.added_by_user_id;
      event_name := 'member_added';
      event_metadata := jsonb_build_object('membershipId', NEW.id, 'userId', NEW.user_id, 'responsibilityCode', NEW.responsibility_code);
    WHEN 'development_opportunity_links' THEN
      event_topic_id := NEW.topic_id;
      event_actor_id := NEW.linked_by_user_id;
      event_name := 'opportunity_linked';
      event_metadata := jsonb_build_object('linkId', NEW.id, 'opportunityId', NEW.opportunity_id);
    WHEN 'development_concept_revisions' THEN
      event_topic_id := NEW.topic_id;
      event_revision_id := NEW.id;
      event_actor_id := NEW.authored_by_user_id;
      event_name := 'concept_revision_created';
      event_metadata := jsonb_build_object('revisionNo', NEW.revision_no, 'sha256', NEW.snapshot_sha256);
    WHEN 'development_concept_submissions' THEN
      SELECT topic_id, id INTO event_topic_id, event_revision_id
        FROM development_concept_revisions WHERE id = NEW.revision_id;
      event_actor_id := NEW.submitted_by_user_id;
      event_name := 'concept_submitted';
    WHEN 'development_concept_decisions' THEN
      SELECT revision.topic_id, revision.id INTO event_topic_id, event_revision_id
        FROM development_concept_submissions submission
        JOIN development_concept_revisions revision ON revision.id = submission.revision_id
        WHERE submission.id = NEW.submission_id;
      event_actor_id := NEW.decided_by_user_id;
      event_name := 'concept_decided';
      event_metadata := jsonb_build_object('decisionCode', NEW.decision_code);
    ELSE
      RAISE EXCEPTION 'Unexpected development event source: %', TG_TABLE_NAME;
  END CASE;

  INSERT INTO development_events (
    topic_id, event_type, actor_user_id, concept_revision_id, metadata
  ) VALUES (
    event_topic_id, event_name, event_actor_id, event_revision_id, event_metadata
  );
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION bestcrm_record_development_change()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  event_topic_id bigint;
  event_name text;
  event_actor_id bigint;
  event_metadata jsonb;
BEGIN
  CASE TG_TABLE_NAME
    WHEN 'development_topics' THEN
      event_topic_id := NEW.id;
      event_name := 'topic_updated';
      event_actor_id := NEW.updated_by_user_id;
      event_metadata := jsonb_build_object(
        'previousPhase', OLD.phase, 'phase', NEW.phase,
        'previousResult', OLD.result, 'result', NEW.result,
        'previousOwnerUserId', OLD.owner_user_id, 'ownerUserId', NEW.owner_user_id,
        'rowVersion', NEW.row_version
      );
    WHEN 'development_topic_directions' THEN
      event_topic_id := NEW.topic_id;
      event_name := 'direction_removed';
      event_actor_id := NEW.removed_by_user_id;
      event_metadata := jsonb_build_object('directionId', NEW.id, 'directionCode', NEW.direction_code);
    WHEN 'development_memberships' THEN
      event_topic_id := NEW.topic_id;
      event_name := 'member_removed';
      event_actor_id := NEW.ended_by_user_id;
      event_metadata := jsonb_build_object('membershipId', NEW.id, 'userId', NEW.user_id);
    WHEN 'development_opportunity_links' THEN
      event_topic_id := NEW.topic_id;
      event_name := 'opportunity_unlinked';
      event_actor_id := NEW.unlinked_by_user_id;
      event_metadata := jsonb_build_object('linkId', NEW.id, 'opportunityId', NEW.opportunity_id);
    ELSE
      RAISE EXCEPTION 'Unexpected development change source: %', TG_TABLE_NAME;
  END CASE;
  INSERT INTO development_events (topic_id, event_type, actor_user_id, metadata)
  VALUES (event_topic_id, event_name, event_actor_id, event_metadata);
  RETURN NEW;
END;
$$;

CREATE TRIGGER development_topics_created_event
  AFTER INSERT ON development_topics
  FOR EACH ROW EXECUTE FUNCTION bestcrm_record_development_creation();
CREATE TRIGGER development_topic_directions_created_event
  AFTER INSERT ON development_topic_directions
  FOR EACH ROW EXECUTE FUNCTION bestcrm_record_development_creation();
CREATE TRIGGER development_memberships_created_event
  AFTER INSERT ON development_memberships
  FOR EACH ROW EXECUTE FUNCTION bestcrm_record_development_creation();
CREATE TRIGGER development_opportunity_links_created_event
  AFTER INSERT ON development_opportunity_links
  FOR EACH ROW EXECUTE FUNCTION bestcrm_record_development_creation();
CREATE TRIGGER development_concept_revisions_created_event
  AFTER INSERT ON development_concept_revisions
  FOR EACH ROW EXECUTE FUNCTION bestcrm_record_development_creation();
CREATE TRIGGER development_concept_submissions_created_event
  AFTER INSERT ON development_concept_submissions
  FOR EACH ROW EXECUTE FUNCTION bestcrm_record_development_creation();
CREATE TRIGGER development_concept_decisions_created_event
  AFTER INSERT ON development_concept_decisions
  FOR EACH ROW EXECUTE FUNCTION bestcrm_record_development_creation();
CREATE TRIGGER development_topics_updated_event
  AFTER UPDATE ON development_topics
  FOR EACH ROW EXECUTE FUNCTION bestcrm_record_development_change();
CREATE TRIGGER development_topic_directions_removed_event
  AFTER UPDATE ON development_topic_directions
  FOR EACH ROW EXECUTE FUNCTION bestcrm_record_development_change();
CREATE TRIGGER development_memberships_removed_event
  AFTER UPDATE ON development_memberships
  FOR EACH ROW EXECUTE FUNCTION bestcrm_record_development_change();
CREATE TRIGGER development_opportunity_links_unlinked_event
  AFTER UPDATE ON development_opportunity_links
  FOR EACH ROW EXECUTE FUNCTION bestcrm_record_development_change();
