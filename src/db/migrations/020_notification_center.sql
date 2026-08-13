CREATE TABLE IF NOT EXISTS notification_preferences (
  user_id bigint PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  realtime_enabled boolean NOT NULL DEFAULT true,
  web_push_enabled boolean NOT NULL DEFAULT true,
  email_enabled boolean NOT NULL DEFAULT true,
  sms_enabled boolean NOT NULL DEFAULT true,
  email_delay_minutes integer NOT NULL DEFAULT 15 CHECK (email_delay_minutes BETWEEN 0 AND 1440),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notifications (
  id bigserial PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  priority text NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal', 'high', 'critical')),
  title text NOT NULL,
  body text NOT NULL,
  action_url text NOT NULL DEFAULT '',
  source_type text NOT NULL,
  source_id bigint NOT NULL,
  actor_user_id bigint REFERENCES users(id) ON DELETE SET NULL,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, source_type, source_id)
);

CREATE INDEX IF NOT EXISTS notifications_user_created_idx
  ON notifications(user_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS notifications_user_unread_idx
  ON notifications(user_id, created_at DESC, id DESC)
  WHERE read_at IS NULL;

CREATE TABLE IF NOT EXISTS notification_deliveries (
  id bigserial PRIMARY KEY,
  notification_id bigint NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  channel text NOT NULL CHECK (channel IN ('web_push', 'email', 'sms')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'skipped')),
  available_after timestamptz NOT NULL DEFAULT now(),
  attempts integer NOT NULL DEFAULT 0,
  provider_message_id text,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (notification_id, channel)
);

CREATE INDEX IF NOT EXISTS notification_deliveries_due_idx
  ON notification_deliveries(status, available_after, id)
  WHERE status IN ('pending', 'processing', 'failed');

CREATE TABLE IF NOT EXISTS web_push_subscriptions (
  id bigserial PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint text NOT NULL UNIQUE,
  p256dh text NOT NULL,
  auth text NOT NULL,
  user_agent text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE INDEX IF NOT EXISTS web_push_subscriptions_user_idx
  ON web_push_subscriptions(user_id, updated_at DESC)
  WHERE revoked_at IS NULL;

CREATE OR REPLACE FUNCTION create_workflow_notification()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  notification_id bigint;
  notification_priority text;
  notification_title text;
  notification_body text;
  opportunity_label text;
  preference notification_preferences%ROWTYPE;
BEGIN
  IF NEW.target_user_id IS NULL OR NEW.target_user_id = NEW.actor_user_id THEN
    RETURN NEW;
  END IF;

  SELECT concat_ws(' - ', opportunity_no, title)
  INTO opportunity_label
  FROM opportunities
  WHERE id = NEW.opportunity_id;

  notification_priority := CASE
    WHEN NEW.event_type IN (
      'mark_lost', 'mark_won', 'submit_contract_approval',
      'approve_contract', 'reject_contract'
    ) THEN 'critical'
    WHEN NEW.event_type LIKE 'reject_%' THEN 'high'
    ELSE 'normal'
  END;

  notification_title := CASE NEW.event_type
    WHEN 'submit_initiation' THEN '商机立项待审批'
    WHEN 'approve_initiation' THEN '商机已立项'
    WHEN 'reject_initiation' THEN '商机立项被退回'
    WHEN 'change_quotation_engineer' THEN '报价工程师任务已变更'
    WHEN 'add_requirement_update' THEN '客户需求已更新'
    WHEN 'submit_technical_solution' THEN '技术方案待审批'
    WHEN 'approve_technical_solution' THEN '技术方案已批准'
    WHEN 'reject_technical_solution' THEN '技术方案被退回'
    WHEN 'submit_commercial_quote' THEN '商务报价待审批'
    WHEN 'approve_commercial_quote' THEN '商务报价已批准'
    WHEN 'reject_commercial_quote' THEN '商务报价被退回'
    WHEN 'mark_lost' THEN '商机已标记为失败'
    WHEN 'mark_won' THEN '商机已标记为赢单'
    WHEN 'submit_contract_approval' THEN '合同待审批'
    WHEN 'approve_contract' THEN '合同已批准'
    WHEN 'reject_contract' THEN '合同被退回'
    ELSE '商机流程有新动作'
  END;
  notification_body := concat(notification_title, '：', COALESCE(opportunity_label, concat('商机 #', NEW.opportunity_id)));

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
    NEW.target_user_id,
    NEW.event_type,
    notification_priority,
    notification_title,
    notification_body,
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
  WHERE user_id = NEW.target_user_id;

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

  IF notification_priority = 'critical' AND COALESCE(preference.sms_enabled, true) THEN
    INSERT INTO notification_deliveries (notification_id, channel, available_after)
    VALUES (notification_id, 'sms', NEW.created_at)
    ON CONFLICT DO NOTHING;
  END IF;

  PERFORM pg_notify('bestcrm_notifications', NEW.target_user_id::text);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS workflow_event_notification_trigger ON workflow_events;

CREATE TRIGGER workflow_event_notification_trigger
AFTER INSERT ON workflow_events
FOR EACH ROW
EXECUTE FUNCTION create_workflow_notification();
