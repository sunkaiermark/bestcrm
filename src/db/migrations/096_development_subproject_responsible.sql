-- A subproject has one accountable project member. Existing plans remain
-- unassigned until the project owner explicitly identifies their owner.
ALTER TABLE development_project_items
  ADD COLUMN responsible_user_id bigint REFERENCES users(id) ON DELETE RESTRICT;

ALTER TABLE development_project_items
  ADD CONSTRAINT development_project_item_responsible_kind_check
  CHECK (item_kind = 'subproject' OR responsible_user_id IS NULL);

CREATE INDEX development_project_items_responsible_idx
  ON development_project_items (responsible_user_id, planned_start_on, id)
  WHERE item_kind = 'subproject' AND responsible_user_id IS NOT NULL;

CREATE OR REPLACE FUNCTION bestcrm_guard_development_subproject_responsible()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.item_kind = 'concept_gate' THEN
    IF NEW.responsible_user_id IS NOT NULL THEN
      RAISE EXCEPTION 'Concept gate cannot have a subproject responsible user';
    END IF;
    RETURN NEW;
  END IF;

  -- Legacy subprojects may remain unassigned until the owner chooses a real
  -- responsible member. An assignment, once made, cannot be cleared.
  IF TG_OP = 'UPDATE' THEN
    IF NEW.responsible_user_id IS NOT DISTINCT FROM OLD.responsible_user_id THEN
      RETURN NEW;
    END IF;
  END IF;
  IF NEW.responsible_user_id IS NULL THEN
    RAISE EXCEPTION 'Subproject responsible user is required';
  END IF;

  PERFORM 1
  FROM development_project_memberships membership
  JOIN users employee ON employee.id = membership.user_id
  WHERE membership.project_id = NEW.project_id
    AND membership.user_id = NEW.responsible_user_id
    AND membership.added_at <= now()
    AND membership.ended_at IS NULL
    AND employee.is_active = true
  FOR SHARE OF membership, employee;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Subproject responsible user must be an active project member';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER development_project_items_responsible_guard
  BEFORE INSERT OR UPDATE OF responsible_user_id ON development_project_items
  FOR EACH ROW EXECUTE FUNCTION bestcrm_guard_development_subproject_responsible();

CREATE OR REPLACE FUNCTION bestcrm_guard_development_responsible_membership_end()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.ended_at IS NULL AND NEW.ended_at IS NOT NULL AND EXISTS (
    SELECT 1 FROM development_project_items item
    WHERE item.project_id = OLD.project_id
      AND item.item_kind = 'subproject'
      AND item.responsible_user_id = OLD.user_id
  ) THEN
    RAISE EXCEPTION 'Reassign subprojects before ending project membership';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER development_project_member_responsibility_guard
  BEFORE UPDATE OF ended_at ON development_project_memberships
  FOR EACH ROW EXECUTE FUNCTION bestcrm_guard_development_responsible_membership_end();

-- Keep the existing append-only project timeline, including both sides of a
-- reassignment. The row-version guard remains in the previous migration.
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
    IF TG_OP = 'INSERT' THEN
      event_name := 'plan_item_created';
    ELSIF NEW.responsible_user_id IS DISTINCT FROM OLD.responsible_user_id THEN
      event_name := 'subproject_responsible_changed';
    ELSE
      event_name := 'plan_item_updated';
    END IF;
    event_metadata := jsonb_build_object('itemId', NEW.id, 'itemKind', NEW.item_kind,
      'plannedStart', NEW.planned_start_on, 'plannedEnd', NEW.planned_end_on,
      'responsibleUserId', NEW.responsible_user_id, 'rowVersion', NEW.row_version);
    IF TG_OP = 'UPDATE' THEN
      event_metadata := event_metadata || jsonb_build_object('previousStart', OLD.planned_start_on,
        'previousEnd', OLD.planned_end_on,
        'previousResponsibleUserId', OLD.responsible_user_id);
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
