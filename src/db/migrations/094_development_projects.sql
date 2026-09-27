-- Independent NPD planning projects. These are not contract delivery projects
-- and do not consume opportunity or development-topic numbers.
CREATE SEQUENCE development_project_number_seq AS bigint START WITH 1;

CREATE TABLE development_projects (
  id bigserial PRIMARY KEY,
  project_no text NOT NULL DEFAULT ('RDP-' || nextval('development_project_number_seq')::text)
    UNIQUE CHECK (project_no ~ '^RDP-[1-9][0-9]*$'),
  title text NOT NULL CHECK (btrim(title) <> '' AND char_length(title) <= 200),
  objective text NOT NULL DEFAULT '' CHECK (char_length(objective) <= 10000),
  planned_start_on date NOT NULL,
  planned_end_on date NOT NULL,
  owner_user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_by_user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by_user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  row_version bigint NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (planned_start_on <= planned_end_on)
);
ALTER SEQUENCE development_project_number_seq OWNED BY development_projects.project_no;
CREATE INDEX development_projects_owner_updated_idx
  ON development_projects (owner_user_id, updated_at DESC, id DESC);

CREATE TABLE development_project_memberships (
  id bigserial PRIMARY KEY,
  project_id bigint NOT NULL REFERENCES development_projects(id) ON DELETE RESTRICT,
  user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  added_by_user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  added_at timestamptz NOT NULL DEFAULT now(),
  ended_by_user_id bigint REFERENCES users(id) ON DELETE RESTRICT,
  ended_at timestamptz,
  CHECK ((ended_at IS NULL) = (ended_by_user_id IS NULL)),
  CHECK (ended_at IS NULL OR ended_at >= added_at)
);
CREATE UNIQUE INDEX development_project_memberships_active_idx
  ON development_project_memberships (project_id, user_id) WHERE ended_at IS NULL;
CREATE INDEX development_project_memberships_user_active_idx
  ON development_project_memberships (user_id, project_id) WHERE ended_at IS NULL;

-- A concept gate is a zero-duration planning milestone. Its approval state is
-- derived from the linked topic's current technical-manager decision; the
-- project owner cannot mark it approved in this table.
CREATE TABLE development_project_items (
  id bigserial PRIMARY KEY,
  project_id bigint NOT NULL REFERENCES development_projects(id) ON DELETE RESTRICT,
  item_kind text NOT NULL CHECK (item_kind IN ('subproject', 'concept_gate')),
  ordinal integer NOT NULL CHECK (ordinal > 0),
  title text NOT NULL CHECK (btrim(title) <> '' AND char_length(title) <= 200),
  planned_start_on date NOT NULL,
  planned_end_on date NOT NULL,
  gate_topic_id bigint REFERENCES development_topics(id) ON DELETE RESTRICT,
  created_by_user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by_user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  row_version bigint NOT NULL DEFAULT 1 CHECK (row_version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (planned_start_on <= planned_end_on),
  CHECK ((item_kind = 'concept_gate' AND gate_topic_id IS NOT NULL
      AND planned_start_on = planned_end_on)
    OR (item_kind = 'subproject' AND gate_topic_id IS NULL)),
  UNIQUE (project_id, item_kind, ordinal),
  UNIQUE (project_id, id)
);
CREATE INDEX development_project_items_schedule_idx
  ON development_project_items (project_id, planned_start_on, id);
CREATE UNIQUE INDEX development_project_items_one_gate_per_topic_idx
  ON development_project_items (project_id, gate_topic_id)
  WHERE item_kind = 'concept_gate';

CREATE OR REPLACE FUNCTION bestcrm_guard_development_project_dates()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  project_start date;
  project_end date;
BEGIN
  IF TG_TABLE_NAME = 'development_projects' THEN
    IF EXISTS (
      SELECT 1 FROM development_project_items item
      WHERE item.project_id = NEW.id
        AND (item.planned_start_on < NEW.planned_start_on
          OR item.planned_end_on > NEW.planned_end_on)
    ) THEN
      RAISE EXCEPTION 'Development project dates must contain every plan item';
    END IF;
  ELSE
    SELECT project.planned_start_on, project.planned_end_on
    INTO project_start, project_end
    FROM development_projects project WHERE project.id = NEW.project_id FOR SHARE;
    IF NEW.planned_start_on < project_start OR NEW.planned_end_on > project_end THEN
      RAISE EXCEPTION 'Development plan item must fit within project dates';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER development_projects_dates_guard
  BEFORE UPDATE ON development_projects
  FOR EACH ROW EXECUTE FUNCTION bestcrm_guard_development_project_dates();
CREATE TRIGGER development_project_items_dates_guard
  BEFORE INSERT OR UPDATE ON development_project_items
  FOR EACH ROW EXECUTE FUNCTION bestcrm_guard_development_project_dates();

-- One topic may contribute to several subprojects, but exactly one of its
-- active links in a project is primary (enforced on writes by the service).
CREATE TABLE development_project_topic_links (
  id bigserial PRIMARY KEY,
  project_id bigint NOT NULL REFERENCES development_projects(id) ON DELETE RESTRICT,
  item_id bigint NOT NULL,
  topic_id bigint NOT NULL REFERENCES development_topics(id) ON DELETE RESTRICT,
  is_primary boolean NOT NULL DEFAULT false,
  linked_by_user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  linked_at timestamptz NOT NULL DEFAULT now(),
  ended_by_user_id bigint REFERENCES users(id) ON DELETE RESTRICT,
  ended_at timestamptz,
  FOREIGN KEY (project_id, item_id) REFERENCES development_project_items(project_id, id)
    ON DELETE RESTRICT,
  CHECK ((ended_at IS NULL) = (ended_by_user_id IS NULL)),
  CHECK (ended_at IS NULL OR ended_at >= linked_at)
);
CREATE UNIQUE INDEX development_project_topic_links_active_pair_idx
  ON development_project_topic_links (item_id, topic_id) WHERE ended_at IS NULL;
CREATE UNIQUE INDEX development_project_topic_links_one_primary_idx
  ON development_project_topic_links (project_id, topic_id)
  WHERE ended_at IS NULL AND is_primary = true;
CREATE INDEX development_project_topic_links_topic_idx
  ON development_project_topic_links (topic_id, project_id) WHERE ended_at IS NULL;

CREATE TABLE development_project_dependencies (
  id bigserial PRIMARY KEY,
  project_id bigint NOT NULL REFERENCES development_projects(id) ON DELETE RESTRICT,
  predecessor_item_id bigint NOT NULL,
  successor_item_id bigint NOT NULL,
  relation_code text NOT NULL CHECK (relation_code IN ('FS', 'SS', 'FF', 'SF')),
  lag_calendar_days integer NOT NULL DEFAULT 0
    CHECK (lag_calendar_days BETWEEN -365 AND 365),
  linked_by_user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  linked_at timestamptz NOT NULL DEFAULT now(),
  ended_by_user_id bigint REFERENCES users(id) ON DELETE RESTRICT,
  ended_at timestamptz,
  FOREIGN KEY (project_id, predecessor_item_id)
    REFERENCES development_project_items(project_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (project_id, successor_item_id)
    REFERENCES development_project_items(project_id, id) ON DELETE RESTRICT,
  CHECK (predecessor_item_id <> successor_item_id),
  CHECK ((ended_at IS NULL) = (ended_by_user_id IS NULL)),
  CHECK (ended_at IS NULL OR ended_at >= linked_at)
);
CREATE UNIQUE INDEX development_project_dependencies_active_pair_idx
  ON development_project_dependencies (predecessor_item_id, successor_item_id)
  WHERE ended_at IS NULL;
CREATE INDEX development_project_dependencies_successor_idx
  ON development_project_dependencies (project_id, successor_item_id)
  WHERE ended_at IS NULL;

CREATE TABLE development_project_events (
  id bigserial PRIMARY KEY,
  project_id bigint NOT NULL REFERENCES development_projects(id) ON DELETE RESTRICT,
  event_type text NOT NULL CHECK (btrim(event_type) <> ''),
  actor_user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(metadata) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX development_project_events_recent_idx
  ON development_project_events (project_id, created_at DESC, id DESC);
CREATE TRIGGER development_project_events_no_change
  BEFORE UPDATE OR DELETE ON development_project_events
  FOR EACH ROW EXECUTE FUNCTION bestcrm_protect_development_history();

CREATE OR REPLACE FUNCTION bestcrm_guard_development_project_history()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Development project history cannot be deleted';
  END IF;
  IF TG_TABLE_NAME = 'development_projects' THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.project_no IS DISTINCT FROM OLD.project_no
        OR NEW.owner_user_id IS DISTINCT FROM OLD.owner_user_id
        OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id
        OR NEW.created_at IS DISTINCT FROM OLD.created_at
        OR NEW.row_version <> OLD.row_version + 1 THEN
      RAISE EXCEPTION 'Development project identity is immutable';
    END IF;
  ELSIF TG_TABLE_NAME = 'development_project_items' THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.project_id IS DISTINCT FROM OLD.project_id
        OR NEW.item_kind IS DISTINCT FROM OLD.item_kind
        OR NEW.ordinal IS DISTINCT FROM OLD.ordinal
        OR NEW.gate_topic_id IS DISTINCT FROM OLD.gate_topic_id
        OR NEW.created_by_user_id IS DISTINCT FROM OLD.created_by_user_id
        OR NEW.created_at IS DISTINCT FROM OLD.created_at
        OR NEW.row_version <> OLD.row_version + 1 THEN
      RAISE EXCEPTION 'Development plan item identity is immutable';
    END IF;
  ELSIF TG_TABLE_NAME = 'development_project_memberships' THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.project_id IS DISTINCT FROM OLD.project_id
        OR NEW.user_id IS DISTINCT FROM OLD.user_id
        OR NEW.added_by_user_id IS DISTINCT FROM OLD.added_by_user_id
        OR NEW.added_at IS DISTINCT FROM OLD.added_at
        OR OLD.ended_at IS NOT NULL OR NEW.ended_at IS NULL
        OR NEW.ended_by_user_id IS NULL THEN
      RAISE EXCEPTION 'Development project membership can only be ended once';
    END IF;
  ELSIF TG_TABLE_NAME = 'development_project_topic_links' THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.project_id IS DISTINCT FROM OLD.project_id
        OR NEW.item_id IS DISTINCT FROM OLD.item_id
        OR NEW.topic_id IS DISTINCT FROM OLD.topic_id
        OR NEW.is_primary IS DISTINCT FROM OLD.is_primary
        OR NEW.linked_by_user_id IS DISTINCT FROM OLD.linked_by_user_id
        OR NEW.linked_at IS DISTINCT FROM OLD.linked_at
        OR OLD.ended_at IS NOT NULL OR NEW.ended_at IS NULL
        OR NEW.ended_by_user_id IS NULL THEN
      RAISE EXCEPTION 'Development project topic link can only be ended once';
    END IF;
  ELSIF TG_TABLE_NAME = 'development_project_dependencies' THEN
    IF NEW.id IS DISTINCT FROM OLD.id OR NEW.project_id IS DISTINCT FROM OLD.project_id
        OR NEW.predecessor_item_id IS DISTINCT FROM OLD.predecessor_item_id
        OR NEW.successor_item_id IS DISTINCT FROM OLD.successor_item_id
        OR NEW.relation_code IS DISTINCT FROM OLD.relation_code
        OR NEW.lag_calendar_days IS DISTINCT FROM OLD.lag_calendar_days
        OR NEW.linked_by_user_id IS DISTINCT FROM OLD.linked_by_user_id
        OR NEW.linked_at IS DISTINCT FROM OLD.linked_at
        OR OLD.ended_at IS NOT NULL OR NEW.ended_at IS NULL
        OR NEW.ended_by_user_id IS NULL THEN
      RAISE EXCEPTION 'Development project dependency can only be ended once';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER development_projects_history_guard
  BEFORE UPDATE OR DELETE ON development_projects
  FOR EACH ROW EXECUTE FUNCTION bestcrm_guard_development_project_history();
CREATE TRIGGER development_project_items_history_guard
  BEFORE UPDATE OR DELETE ON development_project_items
  FOR EACH ROW EXECUTE FUNCTION bestcrm_guard_development_project_history();
CREATE TRIGGER development_project_memberships_history_guard
  BEFORE UPDATE OR DELETE ON development_project_memberships
  FOR EACH ROW EXECUTE FUNCTION bestcrm_guard_development_project_history();
CREATE TRIGGER development_project_topic_links_history_guard
  BEFORE UPDATE OR DELETE ON development_project_topic_links
  FOR EACH ROW EXECUTE FUNCTION bestcrm_guard_development_project_history();
CREATE TRIGGER development_project_dependencies_history_guard
  BEFORE UPDATE OR DELETE ON development_project_dependencies
  FOR EACH ROW EXECUTE FUNCTION bestcrm_guard_development_project_history();

CREATE OR REPLACE FUNCTION bestcrm_guard_development_dependency_cycle()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  -- Serialize inserts for a project, including direct SQL writers, then reject
  -- a path back to the predecessor. A dependency never crosses projects.
  PERFORM 1 FROM development_projects WHERE id = NEW.project_id FOR UPDATE;
  IF EXISTS (
    WITH RECURSIVE reachable(item_id) AS (
      SELECT NEW.successor_item_id
      UNION
      SELECT dependency.successor_item_id
      FROM development_project_dependencies dependency
      JOIN reachable ON reachable.item_id = dependency.predecessor_item_id
      WHERE dependency.project_id = NEW.project_id AND dependency.ended_at IS NULL
    )
    SELECT 1 FROM reachable WHERE item_id = NEW.predecessor_item_id
  ) THEN
    RAISE EXCEPTION 'Development project dependency cycle is not allowed';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER development_project_dependencies_no_cycle
  BEFORE INSERT ON development_project_dependencies
  FOR EACH ROW EXECUTE FUNCTION bestcrm_guard_development_dependency_cycle();

CREATE OR REPLACE FUNCTION bestcrm_require_development_subproject_link()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM development_project_items item
    WHERE item.id = NEW.item_id AND item.project_id = NEW.project_id
      AND item.item_kind = 'subproject'
  ) THEN
    RAISE EXCEPTION 'Only a subproject may link a development topic';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER development_project_topic_links_subproject_only
  BEFORE INSERT ON development_project_topic_links
  FOR EACH ROW EXECUTE FUNCTION bestcrm_require_development_subproject_link();

CREATE OR REPLACE FUNCTION bestcrm_record_development_project_event()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  event_project_id bigint;
  event_actor_id bigint;
  event_name text;
  event_metadata jsonb := '{}'::jsonb;
BEGIN
  IF TG_TABLE_NAME = 'development_projects' THEN
    event_project_id := NEW.id;
    event_actor_id := CASE WHEN TG_OP = 'INSERT' THEN NEW.created_by_user_id ELSE NEW.updated_by_user_id END;
    event_name := CASE WHEN TG_OP = 'INSERT' THEN 'project_created' ELSE 'project_updated' END;
    IF TG_OP = 'UPDATE' THEN
      event_metadata := jsonb_build_object('previousStart', OLD.planned_start_on,
        'previousEnd', OLD.planned_end_on, 'plannedStart', NEW.planned_start_on,
        'plannedEnd', NEW.planned_end_on, 'rowVersion', NEW.row_version);
    END IF;
  ELSIF TG_TABLE_NAME = 'development_project_items' THEN
    event_project_id := NEW.project_id;
    event_actor_id := CASE WHEN TG_OP = 'INSERT' THEN NEW.created_by_user_id ELSE NEW.updated_by_user_id END;
    event_name := CASE WHEN TG_OP = 'INSERT' THEN 'plan_item_created' ELSE 'plan_item_updated' END;
    event_metadata := jsonb_build_object('itemId', NEW.id, 'itemKind', NEW.item_kind,
      'plannedStart', NEW.planned_start_on, 'plannedEnd', NEW.planned_end_on,
      'rowVersion', NEW.row_version);
    IF TG_OP = 'UPDATE' THEN
      event_metadata := event_metadata || jsonb_build_object('previousStart', OLD.planned_start_on,
        'previousEnd', OLD.planned_end_on);
    END IF;
  ELSIF TG_TABLE_NAME = 'development_project_memberships' THEN
    event_project_id := NEW.project_id;
    event_actor_id := CASE WHEN TG_OP = 'INSERT' THEN NEW.added_by_user_id ELSE NEW.ended_by_user_id END;
    event_name := CASE WHEN TG_OP = 'INSERT' THEN 'project_member_added' ELSE 'project_member_ended' END;
    event_metadata := jsonb_build_object('userId', NEW.user_id, 'membershipId', NEW.id);
  ELSIF TG_TABLE_NAME = 'development_project_topic_links' THEN
    event_project_id := NEW.project_id;
    event_actor_id := CASE WHEN TG_OP = 'INSERT' THEN NEW.linked_by_user_id ELSE NEW.ended_by_user_id END;
    event_name := CASE WHEN TG_OP = 'INSERT' THEN 'subproject_topic_linked' ELSE 'subproject_topic_unlinked' END;
    event_metadata := jsonb_build_object('itemId', NEW.item_id, 'topicId', NEW.topic_id,
      'isPrimary', NEW.is_primary, 'linkId', NEW.id);
  ELSIF TG_TABLE_NAME = 'development_project_dependencies' THEN
    event_project_id := NEW.project_id;
    event_actor_id := CASE WHEN TG_OP = 'INSERT' THEN NEW.linked_by_user_id ELSE NEW.ended_by_user_id END;
    event_name := CASE WHEN TG_OP = 'INSERT' THEN 'dependency_added' ELSE 'dependency_ended' END;
    event_metadata := jsonb_build_object('dependencyId', NEW.id,
      'predecessorItemId', NEW.predecessor_item_id,
      'successorItemId', NEW.successor_item_id,
      'relationCode', NEW.relation_code, 'lagCalendarDays', NEW.lag_calendar_days);
  ELSE
    RAISE EXCEPTION 'Unexpected development project event source: %', TG_TABLE_NAME;
  END IF;
  INSERT INTO development_project_events (project_id, event_type, actor_user_id, metadata)
  VALUES (event_project_id, event_name, event_actor_id, event_metadata);
  RETURN NEW;
END;
$$;
CREATE TRIGGER development_projects_event
  AFTER INSERT OR UPDATE ON development_projects
  FOR EACH ROW EXECUTE FUNCTION bestcrm_record_development_project_event();
CREATE TRIGGER development_project_items_event
  AFTER INSERT OR UPDATE ON development_project_items
  FOR EACH ROW EXECUTE FUNCTION bestcrm_record_development_project_event();
CREATE TRIGGER development_project_memberships_event
  AFTER INSERT OR UPDATE ON development_project_memberships
  FOR EACH ROW EXECUTE FUNCTION bestcrm_record_development_project_event();
CREATE TRIGGER development_project_topic_links_event
  AFTER INSERT OR UPDATE ON development_project_topic_links
  FOR EACH ROW EXECUTE FUNCTION bestcrm_record_development_project_event();
CREATE TRIGGER development_project_dependencies_event
  AFTER INSERT OR UPDATE ON development_project_dependencies
  FOR EACH ROW EXECUTE FUNCTION bestcrm_record_development_project_event();
