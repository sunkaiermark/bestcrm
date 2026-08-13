CREATE OR REPLACE FUNCTION create_workflow_secondary_notifications()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  notification_id bigint;
  notification_title text;
  opportunity_label text;
  recipient_user_id bigint;
  preference notification_preferences%ROWTYPE;
BEGIN
  IF NEW.event_type NOT IN ('approve_initiation', 'approve_technical_solution') THEN
    RETURN NEW;
  END IF;

  SELECT
    salesperson_id,
    concat_ws(' - ', opportunity_no, title)
  INTO recipient_user_id, opportunity_label
  FROM opportunities
  WHERE id = NEW.opportunity_id;

  IF recipient_user_id IS NULL
    OR recipient_user_id = NEW.actor_user_id
    OR recipient_user_id = NEW.target_user_id THEN
    RETURN NEW;
  END IF;

  notification_title := CASE NEW.event_type
    WHEN 'approve_initiation' THEN '商机已立项并指派报价工程师'
    WHEN 'approve_technical_solution' THEN '技术方案已批准'
  END;

  INSERT INTO notifications (
    user_id,
    event_type,
    priority,
    title,
    body,
    action_url,
    source_type,
    source_id,
    actor_user_id,
    created_at
  )
  VALUES (
    recipient_user_id,
    NEW.event_type,
    'normal',
    notification_title,
    concat(notification_title, '：', COALESCE(opportunity_label, concat('商机 #', NEW.opportunity_id))),
    concat('/opportunities/', NEW.opportunity_id),
    'workflow_event',
    NEW.id,
    NEW.actor_user_id,
    NEW.created_at
  )
  ON CONFLICT (user_id, source_type, source_id) DO NOTHING
  RETURNING id INTO notification_id;

  IF notification_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO preference
  FROM notification_preferences
  WHERE user_id = recipient_user_id;

  IF COALESCE(preference.web_push_enabled, true) THEN
    INSERT INTO notification_deliveries (notification_id, channel, available_after)
    VALUES (notification_id, 'web_push', NEW.created_at)
    ON CONFLICT DO NOTHING;
  END IF;

  IF COALESCE(preference.email_enabled, true) THEN
    INSERT INTO notification_deliveries (notification_id, channel, available_after)
    VALUES (
      notification_id,
      'email',
      NEW.created_at + make_interval(mins => COALESCE(preference.email_delay_minutes, 15))
    )
    ON CONFLICT DO NOTHING;
  END IF;

  PERFORM pg_notify('bestcrm_notifications', recipient_user_id::text);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS workflow_event_secondary_notification_trigger ON workflow_events;

CREATE TRIGGER workflow_event_secondary_notification_trigger
AFTER INSERT ON workflow_events
FOR EACH ROW
EXECUTE FUNCTION create_workflow_secondary_notifications();
