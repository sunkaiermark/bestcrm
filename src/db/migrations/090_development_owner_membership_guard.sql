-- P4: an active topic owner must remain an active member of that topic.
-- Ownership transfer is a separate, not-yet-enabled workflow.
CREATE OR REPLACE FUNCTION bestcrm_guard_development_owner_membership()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.ended_at IS NULL AND NEW.ended_at IS NOT NULL AND EXISTS (
    SELECT 1 FROM development_topics topic
    WHERE topic.id = OLD.topic_id AND topic.owner_user_id = OLD.user_id
  ) THEN
    RAISE EXCEPTION 'Development topic owner membership cannot be ended';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER development_owner_membership_no_end
  BEFORE UPDATE ON development_memberships
  FOR EACH ROW EXECUTE FUNCTION bestcrm_guard_development_owner_membership();
