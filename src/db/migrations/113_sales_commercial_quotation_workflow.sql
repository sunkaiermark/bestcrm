ALTER TABLE workflow_events
  ADD COLUMN IF NOT EXISTS action_url text NOT NULL DEFAULT '';

ALTER TABLE todos
  ADD COLUMN IF NOT EXISTS action_url text NOT NULL DEFAULT '';

ALTER TABLE work_items
  ADD COLUMN IF NOT EXISTS action_url text NOT NULL DEFAULT '';

ALTER TABLE workflow_events
  DROP CONSTRAINT IF EXISTS workflow_events_action_url_check,
  ADD CONSTRAINT workflow_events_action_url_check CHECK (
    action_url = '' OR (
      char_length(action_url) <= 1000
      AND left(action_url, 1) = '/'
      AND left(action_url, 2) <> '//'
      AND action_url !~ '[[:cntrl:]]'
    )
  );

ALTER TABLE todos
  DROP CONSTRAINT IF EXISTS todos_action_url_check,
  ADD CONSTRAINT todos_action_url_check CHECK (
    action_url = '' OR (
      char_length(action_url) <= 1000
      AND left(action_url, 1) = '/'
      AND left(action_url, 2) <> '//'
      AND action_url !~ '[[:cntrl:]]'
    )
  );

ALTER TABLE work_items
  DROP CONSTRAINT IF EXISTS work_items_action_url_check,
  ADD CONSTRAINT work_items_action_url_check CHECK (
    action_url = '' OR (
      char_length(action_url) <= 1000
      AND left(action_url, 1) = '/'
      AND left(action_url, 2) <> '//'
      AND action_url !~ '[[:cntrl:]]'
    )
  );

COMMENT ON COLUMN workflow_events.action_url IS
  'Optional internal route to the exact frozen business record represented by this event.';
COMMENT ON COLUMN todos.action_url IS
  'Optional internal route opened directly from the assignee workbench.';
COMMENT ON COLUMN work_items.action_url IS
  'Optional internal route opened directly from the assignee workbench.';

-- Migration 107 used an unnamed CHECK constraint to prohibit all self-review.
-- The trigger below now enforces the same separation while allowing only the
-- active MarkYang account, when it is also the assigned Commercial Manager.
DO $$
DECLARE constraint_row record;
BEGIN
  FOR constraint_row IN
    SELECT constraint_name
    FROM information_schema.table_constraints
    WHERE table_schema = current_schema()
      AND table_name = 'sales_commercial_quotation_versions'
      AND constraint_type = 'CHECK'
      AND constraint_name IN (
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'sales_commercial_quotation_versions'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) LIKE '%reviewed_by <> submitted_by%'
      )
  LOOP
    EXECUTE format(
      'ALTER TABLE sales_commercial_quotation_versions DROP CONSTRAINT %I',
      constraint_row.constraint_name
    );
  END LOOP;
END;
$$;

CREATE OR REPLACE FUNCTION bestcrm_guard_sales_commercial_quotation_version()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  source_row record;
  manager_row record;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Formal quotation versions cannot be deleted';
  END IF;

  SELECT
    opportunity.commercial_manager_id,
    manager.username,
    manager.is_active,
    EXISTS (
      SELECT 1
      FROM user_roles assignment
      JOIN roles role ON role.id = assignment.role_id
      WHERE assignment.user_id = opportunity.commercial_manager_id
        AND role.code = 'commercial_manager'
        AND role.is_active = true
    ) AS has_commercial_manager_role
  INTO manager_row
  FROM opportunities opportunity
  LEFT JOIN users manager ON manager.id = opportunity.commercial_manager_id
  WHERE opportunity.id = NEW.opportunity_id;

  IF TG_OP = 'INSERT' THEN
    IF NOT FOUND OR manager_row.commercial_manager_id IS NULL
      OR manager_row.is_active IS DISTINCT FROM true
      OR manager_row.has_commercial_manager_role IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'An active assigned Commercial Manager is required for formal quotation review';
    END IF;
    IF NEW.status <> 'pending' THEN
      RAISE EXCEPTION 'Formal quotation must start as pending review';
    END IF;
    IF manager_row.commercial_manager_id = NEW.submitted_by
      AND manager_row.username IS DISTINCT FROM 'MarkYang' THEN
      RAISE EXCEPTION 'Commercial quotation self-approval is prohibited';
    END IF;
    SELECT draft.opportunity_id, draft.draft_revision_no, draft.source_technical_draft_id,
      draft.source_attachment_id, draft.source_sha256, technical.status AS technical_status,
      technical.draft_revision_no AS technical_revision_no,
      attachment.sha256 AS attachment_sha256, attachment.retired_at
    INTO source_row
    FROM sales_commercial_quotation_drafts draft
    JOIN opportunity_technical_drafts technical ON technical.id = draft.source_technical_draft_id
    JOIN attachments attachment ON attachment.id = draft.source_attachment_id
    WHERE draft.id = NEW.draft_id;
    IF NOT FOUND OR source_row.opportunity_id IS DISTINCT FROM NEW.opportunity_id
      OR source_row.draft_revision_no IS DISTINCT FROM NEW.draft_revision_no
      OR source_row.source_technical_draft_id IS DISTINCT FROM NEW.source_technical_draft_id
      OR source_row.source_attachment_id IS DISTINCT FROM NEW.source_attachment_id
      OR source_row.source_sha256 IS DISTINCT FROM NEW.source_sha256
      OR source_row.technical_status <> 'approved'
      OR source_row.attachment_sha256 IS DISTINCT FROM NEW.source_sha256
      OR source_row.retired_at IS NOT NULL
      OR EXISTS (
        SELECT 1 FROM opportunity_technical_drafts newer
        WHERE newer.opportunity_id = NEW.opportunity_id
          AND newer.source_kind = 'uploaded_file'
          AND newer.status IN ('ready', 'pending', 'approved')
          AND newer.draft_revision_no > source_row.technical_revision_no
      ) THEN
      RAISE EXCEPTION 'Formal quotation requires the exact approved technical source and current draft revision';
    END IF;
    RETURN NEW;
  END IF;

  IF (NEW.opportunity_id, NEW.draft_id, NEW.draft_revision_no, NEW.version_no,
      NEW.quotation_no, NEW.snapshot, NEW.source_technical_draft_id,
      NEW.source_attachment_id, NEW.source_sha256, NEW.submitted_by, NEW.submitted_at)
    IS DISTINCT FROM
     (OLD.opportunity_id, OLD.draft_id, OLD.draft_revision_no, OLD.version_no,
      OLD.quotation_no, OLD.snapshot, OLD.source_technical_draft_id,
      OLD.source_attachment_id, OLD.source_sha256, OLD.submitted_by, OLD.submitted_at) THEN
    RAISE EXCEPTION 'Submitted quotation snapshot is immutable';
  END IF;

  IF OLD.status = 'pending' AND NEW.status IN ('approved', 'rejected') THEN
    IF manager_row.commercial_manager_id IS NULL
      OR manager_row.is_active IS DISTINCT FROM true
      OR manager_row.has_commercial_manager_role IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'An active assigned Commercial Manager is required for formal quotation review';
    END IF;
    IF NEW.reviewed_by IS NULL OR NEW.reviewed_at IS NULL
       OR NEW.signed_by IS NOT NULL OR NEW.pdf_stored_path IS NOT NULL THEN
      RAISE EXCEPTION 'Invalid commercial review';
    END IF;
    IF NEW.reviewed_by IS DISTINCT FROM manager_row.commercial_manager_id THEN
      RAISE EXCEPTION 'The assigned Commercial Manager must review the quotation';
    END IF;
    IF NEW.reviewed_by = OLD.submitted_by
      AND manager_row.username IS DISTINCT FROM 'MarkYang' THEN
      RAISE EXCEPTION 'Commercial quotation self-approval is prohibited';
    END IF;
  ELSIF OLD.status = 'approved' AND NEW.status = 'signed' THEN
    IF (NEW.reviewed_by, NEW.reviewed_at, NEW.review_comment)
       IS DISTINCT FROM (OLD.reviewed_by, OLD.reviewed_at, OLD.review_comment)
       OR NEW.signed_by IS NULL OR NEW.signed_at IS NULL
       OR NEW.pdf_stored_path IS NULL OR NEW.pdf_sha256 IS NULL THEN
      RAISE EXCEPTION 'Invalid personal quotation signing';
    END IF;
    IF (SELECT username FROM users WHERE id = NEW.signed_by) IS DISTINCT FROM 'MarkYang' THEN
      RAISE EXCEPTION 'Only MarkYang may personally issue a formal quotation';
    END IF;
  ELSE
    RAISE EXCEPTION 'Formal quotation status transition is invalid';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION create_workflow_notification()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  notification_id bigint;
  notification_priority text;
  notification_title text;
  notification_body text;
  notification_action_url text;
  opportunity_label text;
  preference notification_preferences%ROWTYPE;
  mark_self_assignment boolean := false;
BEGIN
  IF NEW.target_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.target_user_id = NEW.actor_user_id THEN
    SELECT EXISTS (
      SELECT 1 FROM users
      WHERE id = NEW.target_user_id
        AND username = 'MarkYang'
        AND is_active = true
    ) INTO mark_self_assignment;
    IF NEW.event_type <> 'submit_commercial_quote'
      OR NEW.action_url NOT LIKE '/opportunities/%/commercial-quotation-draft#quotation-version-%'
      OR NOT mark_self_assignment THEN
      RETURN NEW;
    END IF;
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
  notification_action_url := COALESCE(NULLIF(NEW.action_url, ''), concat('/opportunities/', NEW.opportunity_id));

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
    notification_action_url,
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

-- Repair already-submitted frozen versions that predate the integrated formal
-- workflow. Only the latest version per opportunity can become an open review.
CREATE TEMP TABLE bestcrm_pending_formal_quote_backfill ON COMMIT DROP AS
SELECT
  latest.id AS version_id,
  latest.opportunity_id,
  latest.quotation_no,
  latest.submitted_by,
  latest.submitted_at,
  opportunity.status AS from_status,
  opportunity.salesperson_id,
  opportunity.commercial_manager_id,
  format(
    '/opportunities/%s/commercial-quotation-draft#quotation-version-%s',
    latest.opportunity_id,
    latest.id
  ) AS action_url
FROM (
  SELECT DISTINCT ON (version.opportunity_id) version.*
  FROM sales_commercial_quotation_versions version
  ORDER BY version.opportunity_id, version.version_no DESC, version.id DESC
) latest
JOIN opportunities opportunity ON opportunity.id = latest.opportunity_id
JOIN users manager ON manager.id = opportunity.commercial_manager_id
WHERE latest.status = 'pending'
  AND opportunity.archived_at IS NULL
  AND manager.is_active = true
  AND EXISTS (
    SELECT 1
    FROM user_roles assignment
    JOIN roles role ON role.id = assignment.role_id
    WHERE assignment.user_id = manager.id
      AND role.code = 'commercial_manager'
      AND role.is_active = true
  )
  AND (manager.id <> latest.submitted_by OR manager.username = 'MarkYang');

UPDATE opportunities opportunity
SET status = 'commercial_quote_pending', updated_at = now()
FROM bestcrm_pending_formal_quote_backfill pending
WHERE opportunity.id = pending.opportunity_id
  AND opportunity.status IS DISTINCT FROM 'commercial_quote_pending';

UPDATE todos todo
SET status = 'cancelled', completed_at = now()
FROM bestcrm_pending_formal_quote_backfill pending
WHERE todo.opportunity_id = pending.opportunity_id
  AND todo.title = 'Approve commercial quote'
  AND todo.status = 'pending'
  AND todo.assignee_user_id <> pending.commercial_manager_id;

WITH ranked AS (
  SELECT
    todo.id,
    row_number() OVER (
      PARTITION BY todo.opportunity_id, todo.assignee_user_id
      ORDER BY todo.id DESC
    ) AS position
  FROM todos todo
  JOIN bestcrm_pending_formal_quote_backfill pending
    ON pending.opportunity_id = todo.opportunity_id
   AND pending.commercial_manager_id = todo.assignee_user_id
  WHERE todo.title = 'Approve commercial quote'
    AND todo.status = 'pending'
)
UPDATE todos todo
SET status = 'cancelled', completed_at = now()
FROM ranked
WHERE todo.id = ranked.id
  AND ranked.position > 1;

UPDATE todos todo
SET action_url = pending.action_url
FROM bestcrm_pending_formal_quote_backfill pending
WHERE todo.opportunity_id = pending.opportunity_id
  AND todo.assignee_user_id = pending.commercial_manager_id
  AND todo.title = 'Approve commercial quote'
  AND todo.status = 'pending';

INSERT INTO todos (
  opportunity_id,
  assignee_user_id,
  title,
  status,
  due_at,
  created_at,
  action_url
)
SELECT
  pending.opportunity_id,
  pending.commercial_manager_id,
  'Approve commercial quote',
  'pending',
  NULL,
  pending.submitted_at,
  pending.action_url
FROM bestcrm_pending_formal_quote_backfill pending
WHERE NOT EXISTS (
  SELECT 1
  FROM todos todo
  WHERE todo.opportunity_id = pending.opportunity_id
    AND todo.assignee_user_id = pending.commercial_manager_id
    AND todo.title = 'Approve commercial quote'
    AND todo.status = 'pending'
);

UPDATE work_items item
SET
  status = 'cancelled',
  actual_completed_at = now(),
  result_summary = CASE
    WHEN item.result_summary = '' THEN 'Replaced by frozen quotation review task'
    ELSE item.result_summary
  END,
  updated_at = now()
FROM todos todo, bestcrm_pending_formal_quote_backfill pending
WHERE item.source_type = 'workflow_todo'
  AND item.source_record_id = todo.id
  AND todo.opportunity_id = pending.opportunity_id
  AND todo.title = 'Approve commercial quote'
  AND todo.status <> 'pending'
  AND item.status IN ('pending', 'in_progress', 'waiting', 'review_pending');

UPDATE work_items item
SET action_url = pending.action_url, updated_at = now()
FROM todos todo, bestcrm_pending_formal_quote_backfill pending
WHERE item.source_type = 'workflow_todo'
  AND item.source_record_id = todo.id
  AND todo.opportunity_id = pending.opportunity_id
  AND todo.assignee_user_id = pending.commercial_manager_id
  AND todo.title = 'Approve commercial quote'
  AND todo.status = 'pending';

UPDATE work_items item
SET action_url = pending.action_url, updated_at = now()
FROM bestcrm_pending_formal_quote_backfill pending
WHERE item.opportunity_id = pending.opportunity_id
  AND item.assignee_user_id = pending.commercial_manager_id
  AND item.source_type = 'workflow_todo'
  AND item.source_key = 'approve_commercial_quote'
  AND item.status IN ('pending', 'in_progress', 'waiting', 'review_pending');

INSERT INTO work_items (
  business_type,
  business_record_id,
  opportunity_id,
  assignee_user_id,
  created_by_user_id,
  source_type,
  source_record_id,
  source_key,
  role_context,
  title,
  description,
  planned_start_at,
  due_at,
  kpi_code,
  kpi_target,
  status,
  action_url,
  created_at,
  updated_at
)
SELECT
  'opportunity',
  pending.opportunity_id,
  pending.opportunity_id,
  pending.commercial_manager_id,
  pending.submitted_by,
  'workflow_todo',
  todo.id,
  'approve_commercial_quote',
  'commercial',
  'Approve commercial quote',
  concat('Review frozen quotation ', pending.quotation_no),
  pending.submitted_at,
  NULL,
  'review_commercial_quote',
  '',
  'pending',
  pending.action_url,
  pending.submitted_at,
  pending.submitted_at
FROM bestcrm_pending_formal_quote_backfill pending
JOIN todos todo
  ON todo.opportunity_id = pending.opportunity_id
 AND todo.assignee_user_id = pending.commercial_manager_id
 AND todo.title = 'Approve commercial quote'
 AND todo.status = 'pending'
WHERE NOT EXISTS (
  SELECT 1
  FROM work_items item
  WHERE item.source_type = 'workflow_todo'
    AND item.source_record_id = todo.id
)
ON CONFLICT DO NOTHING;

INSERT INTO workflow_events (
  opportunity_id,
  event_type,
  from_status,
  to_status,
  actor_user_id,
  target_user_id,
  comment,
  action_url,
  created_at
)
SELECT
  pending.opportunity_id,
  'submit_commercial_quote',
  pending.from_status,
  'commercial_quote_pending',
  pending.submitted_by,
  pending.commercial_manager_id,
  concat('Formal quotation ', pending.quotation_no, ' submitted for commercial review'),
  pending.action_url,
  pending.submitted_at
FROM bestcrm_pending_formal_quote_backfill pending
WHERE NOT EXISTS (
  SELECT 1
  FROM workflow_events event
  WHERE event.opportunity_id = pending.opportunity_id
    AND event.event_type = 'submit_commercial_quote'
    AND event.action_url = pending.action_url
);
