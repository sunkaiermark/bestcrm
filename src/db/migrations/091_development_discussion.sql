-- Topic discussion is internal, append-only evidence. It never grants access
-- to research files or to an opportunity linked to the topic.
ALTER TABLE development_events
  ADD CONSTRAINT development_discussion_comment_shape CHECK (
    event_type <> 'discussion_comment' OR (
      actor_user_id IS NOT NULL
      AND concept_revision_id IS NULL
      AND coalesce(jsonb_typeof(metadata->'body') = 'string', false)
      AND btrim(metadata->>'body') <> ''
      AND char_length(metadata->>'body') <= 4000
      AND metadata - 'body' = '{}'::jsonb
    )
  );

CREATE OR REPLACE FUNCTION bestcrm_guard_development_discussion()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.event_type = 'discussion_comment' THEN
    PERFORM 1
    FROM development_memberships membership
    JOIN users actor ON actor.id = membership.user_id
    WHERE membership.topic_id = NEW.topic_id
      AND membership.user_id = NEW.actor_user_id
      AND membership.added_at <= now()
      AND membership.ended_at IS NULL
      AND actor.is_active = true
    FOR SHARE OF membership, actor;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Only an active topic member may add discussion';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER development_discussion_member_guard
  BEFORE INSERT ON development_events
  FOR EACH ROW EXECUTE FUNCTION bestcrm_guard_development_discussion();
