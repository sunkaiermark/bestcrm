-- Phase B: append-only opportunity contact history and activity index.
-- Existing specialist tables remain authoritative; this migration only adds
-- durable identities, typed links, transaction-local indexing, and audit state.

CREATE TABLE opportunity_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id bigint NOT NULL REFERENCES opportunities(id) ON DELETE RESTRICT,
  contact_id bigint NOT NULL REFERENCES contacts(id) ON DELETE RESTRICT,
  role_code text NOT NULL DEFAULT 'primary' CHECK (role_code ~ '^[a-z][a-z0-9_]{0,39}$'),
  is_primary boolean NOT NULL DEFAULT false,
  valid_from timestamptz NOT NULL DEFAULT now(),
  valid_to timestamptz,
  contact_name_snapshot text NOT NULL,
  contact_title_snapshot text NOT NULL DEFAULT '',
  contact_email_snapshot text NOT NULL DEFAULT '',
  contact_phone_snapshot text NOT NULL DEFAULT '',
  created_by bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT opportunity_contacts_validity_check CHECK (valid_to IS NULL OR valid_to > valid_from)
);

CREATE UNIQUE INDEX opportunity_contacts_current_primary_idx
  ON opportunity_contacts(opportunity_id)
  WHERE is_primary AND valid_to IS NULL;
CREATE INDEX opportunity_contacts_opportunity_history_idx
  ON opportunity_contacts(opportunity_id, valid_from DESC, id);
CREATE INDEX opportunity_contacts_contact_history_idx
  ON opportunity_contacts(contact_id, valid_from DESC, id);

CREATE OR REPLACE FUNCTION bestcrm_validate_opportunity_contact()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  opportunity_customer_id bigint;
  contact_customer_id bigint;
BEGIN
  SELECT customer_id INTO opportunity_customer_id
  FROM opportunities WHERE id = NEW.opportunity_id;
  SELECT customer_id INTO contact_customer_id
  FROM contacts WHERE id = NEW.contact_id;

  IF opportunity_customer_id IS NULL OR contact_customer_id IS NULL
      OR opportunity_customer_id IS DISTINCT FROM contact_customer_id THEN
    RAISE EXCEPTION 'Opportunity contacts must belong to the opportunity customer';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER opportunity_contacts_customer_guard
BEFORE INSERT ON opportunity_contacts
FOR EACH ROW EXECUTE FUNCTION bestcrm_validate_opportunity_contact();

CREATE OR REPLACE FUNCTION bestcrm_protect_opportunity_contact_history()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Opportunity contact history cannot be deleted';
  END IF;
  IF NEW.opportunity_id IS DISTINCT FROM OLD.opportunity_id
      OR NEW.contact_id IS DISTINCT FROM OLD.contact_id
      OR NEW.role_code IS DISTINCT FROM OLD.role_code
      OR NEW.is_primary IS DISTINCT FROM OLD.is_primary
      OR NEW.valid_from IS DISTINCT FROM OLD.valid_from
      OR NEW.contact_name_snapshot IS DISTINCT FROM OLD.contact_name_snapshot
      OR NEW.contact_title_snapshot IS DISTINCT FROM OLD.contact_title_snapshot
      OR NEW.contact_email_snapshot IS DISTINCT FROM OLD.contact_email_snapshot
      OR NEW.contact_phone_snapshot IS DISTINCT FROM OLD.contact_phone_snapshot
      OR NEW.created_by IS DISTINCT FROM OLD.created_by
      OR NEW.created_at IS DISTINCT FROM OLD.created_at
      OR OLD.valid_to IS NOT NULL
      OR NEW.valid_to IS NULL
      OR NEW.valid_to <= OLD.valid_from THEN
    RAISE EXCEPTION 'Opportunity contact history is immutable except for closing a current relationship';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER opportunity_contacts_history_guard
BEFORE UPDATE OR DELETE ON opportunity_contacts
FOR EACH ROW EXECUTE FUNCTION bestcrm_protect_opportunity_contact_history();

INSERT INTO opportunity_contacts (
  opportunity_id, contact_id, role_code, is_primary, valid_from,
  contact_name_snapshot, contact_title_snapshot, contact_email_snapshot,
  contact_phone_snapshot, created_by, created_at
)
SELECT
  opportunity.id,
  contact.id,
  'primary',
  true,
  opportunity.created_at,
  contact.name,
  COALESCE(contact.title, ''),
  COALESCE(contact.email, ''),
  COALESCE(contact.phone, ''),
  opportunity.salesperson_id,
  now()
FROM opportunities opportunity
JOIN contacts contact ON contact.id = opportunity.primary_contact_id
WHERE NOT EXISTS (
  SELECT 1 FROM opportunity_contacts relationship
  WHERE relationship.opportunity_id = opportunity.id
    AND relationship.is_primary
    AND relationship.valid_to IS NULL
);

CREATE OR REPLACE FUNCTION bestcrm_sync_opportunity_primary_contact()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  change_time timestamptz := clock_timestamp();
  contact_row contacts%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.primary_contact_id IS NOT DISTINCT FROM OLD.primary_contact_id THEN
    RETURN NEW;
  END IF;

  UPDATE opportunity_contacts
  SET valid_to = change_time
  WHERE opportunity_id = NEW.id AND is_primary AND valid_to IS NULL;

  IF NEW.primary_contact_id IS NOT NULL THEN
    SELECT * INTO STRICT contact_row FROM contacts WHERE id = NEW.primary_contact_id;
    INSERT INTO opportunity_contacts (
      opportunity_id, contact_id, role_code, is_primary, valid_from,
      contact_name_snapshot, contact_title_snapshot, contact_email_snapshot,
      contact_phone_snapshot, created_by
    ) VALUES (
      NEW.id, contact_row.id, 'primary', true, change_time,
      contact_row.name, COALESCE(contact_row.title, ''),
      COALESCE(contact_row.email, ''), COALESCE(contact_row.phone, ''),
      NEW.salesperson_id
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER opportunities_primary_contact_history
AFTER INSERT OR UPDATE OF primary_contact_id ON opportunities
FOR EACH ROW EXECUTE FUNCTION bestcrm_sync_opportunity_primary_contact();

CREATE TABLE activity_types (
  code text PRIMARY KEY CHECK (code ~ '^[a-z][a-z0-9_]{0,39}$'),
  label_en text NOT NULL CHECK (btrim(label_en) <> ''),
  label_zh text NOT NULL CHECK (btrim(label_zh) <> ''),
  category text NOT NULL CHECK (category IN ('communication', 'work', 'document', 'process', 'decision')),
  snapshot_schema_version integer NOT NULL DEFAULT 1 CHECK (snapshot_schema_version > 0),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO activity_types (code, label_en, label_zh, category) VALUES
  ('email', 'Email', '邮件', 'communication'),
  ('meeting', 'Meeting', '会议', 'communication'),
  ('call', 'Call', '电话', 'communication'),
  ('channel_message', 'Channel message', '即时消息', 'communication'),
  ('note', 'Note', '记录', 'work'),
  ('task', 'Task', '任务', 'work'),
  ('file', 'File', '文件', 'document'),
  ('workflow', 'Workflow', '流程', 'process'),
  ('approval', 'Approval', '审批', 'decision'),
  ('technical', 'Technical', '技术', 'document'),
  ('quotation', 'Quotation', '报价', 'document'),
  ('contract', 'Contract', '合同', 'decision'),
  ('ownership', 'Ownership', '负责人', 'process'),
  ('outcome', 'Outcome', '结果', 'decision');

CREATE TABLE opportunity_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  opportunity_id bigint NOT NULL REFERENCES opportunities(id) ON DELETE RESTRICT,
  type_code text NOT NULL REFERENCES activity_types(code) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'recorded' CHECK (btrim(status) <> ''),
  direction text NOT NULL DEFAULT 'internal' CHECK (direction IN ('inbound', 'outbound', 'internal')),
  occurred_at timestamptz NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  actor_user_id bigint REFERENCES users(id) ON DELETE RESTRICT,
  owner_user_id bigint REFERENCES users(id) ON DELETE RESTRICT,
  subject text NOT NULL DEFAULT '',
  summary text NOT NULL DEFAULT '',
  visibility text NOT NULL DEFAULT 'opportunity_team'
    CHECK (visibility IN ('opportunity_team', 'technical', 'commercial', 'management')),
  source_system text NOT NULL CHECK (btrim(source_system) <> ''),
  source_external_key text NOT NULL CHECK (btrim(source_external_key) <> ''),
  correlation_id uuid,
  parent_activity_id uuid REFERENCES opportunity_activities(id) ON DELETE RESTRICT,
  supersedes_activity_id uuid REFERENCES opportunity_activities(id) ON DELETE RESTRICT,
  snapshot_schema_version integer NOT NULL DEFAULT 1 CHECK (snapshot_schema_version > 0),
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(snapshot) = 'object'),
  UNIQUE (source_system, source_external_key),
  CONSTRAINT opportunity_activities_parent_self_check CHECK (parent_activity_id IS NULL OR parent_activity_id <> id),
  CONSTRAINT opportunity_activities_supersedes_self_check CHECK (supersedes_activity_id IS NULL OR supersedes_activity_id <> id)
);

CREATE INDEX opportunity_activities_timeline_idx
  ON opportunity_activities(opportunity_id, occurred_at DESC, recorded_at DESC, id);
CREATE INDEX opportunity_activities_type_idx
  ON opportunity_activities(type_code, occurred_at DESC, id);
CREATE INDEX opportunity_activities_actor_idx
  ON opportunity_activities(actor_user_id, occurred_at DESC, id)
  WHERE actor_user_id IS NOT NULL;
CREATE INDEX opportunity_activities_owner_idx
  ON opportunity_activities(owner_user_id, occurred_at DESC, id)
  WHERE owner_user_id IS NOT NULL;

CREATE TABLE opportunity_activity_links (
  id bigserial PRIMARY KEY,
  activity_id uuid NOT NULL REFERENCES opportunity_activities(id) ON DELETE RESTRICT,
  link_role text NOT NULL DEFAULT 'primary' CHECK (link_role IN ('primary', 'revision', 'related')),
  email_message_id bigint REFERENCES email_messages(id) ON DELETE RESTRICT,
  workflow_event_id bigint REFERENCES workflow_events(id) ON DELETE RESTRICT,
  sales_work_plan_id bigint REFERENCES sales_work_plans(id) ON DELETE RESTRICT,
  sales_work_log_id bigint REFERENCES sales_work_logs(id) ON DELETE RESTRICT,
  attachment_id bigint REFERENCES attachments(id) ON DELETE RESTRICT,
  technical_solution_id bigint REFERENCES technical_solutions(id) ON DELETE RESTRICT,
  commercial_quote_id bigint REFERENCES commercial_quotes(id) ON DELETE RESTRICT,
  quotation_package_version_id bigint REFERENCES quotation_package_versions(id) ON DELETE RESTRICT,
  contract_approval_id bigint REFERENCES contract_approvals(id) ON DELETE RESTRICT,
  opportunity_owner_transfer_id bigint REFERENCES opportunity_owner_transfers(id) ON DELETE RESTRICT,
  opportunity_member_event_id bigint REFERENCES opportunity_member_events(id) ON DELETE RESTRICT,
  engineering_contribution_id bigint REFERENCES opportunity_engineering_contributions(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT opportunity_activity_links_one_source_check CHECK (
    num_nonnulls(
      email_message_id, workflow_event_id, sales_work_plan_id, sales_work_log_id,
      attachment_id, technical_solution_id, commercial_quote_id,
      quotation_package_version_id, contract_approval_id,
      opportunity_owner_transfer_id, opportunity_member_event_id,
      engineering_contribution_id
    ) = 1
  )
);

CREATE UNIQUE INDEX opportunity_activity_links_activity_primary_idx
  ON opportunity_activity_links(activity_id) WHERE link_role = 'primary';
CREATE UNIQUE INDEX opportunity_activity_links_email_primary_idx
  ON opportunity_activity_links(email_message_id) WHERE link_role = 'primary' AND email_message_id IS NOT NULL;
CREATE UNIQUE INDEX opportunity_activity_links_workflow_primary_idx
  ON opportunity_activity_links(workflow_event_id) WHERE link_role = 'primary' AND workflow_event_id IS NOT NULL;
CREATE UNIQUE INDEX opportunity_activity_links_plan_primary_idx
  ON opportunity_activity_links(sales_work_plan_id) WHERE link_role = 'primary' AND sales_work_plan_id IS NOT NULL;
CREATE UNIQUE INDEX opportunity_activity_links_log_primary_idx
  ON opportunity_activity_links(sales_work_log_id) WHERE link_role = 'primary' AND sales_work_log_id IS NOT NULL;
CREATE UNIQUE INDEX opportunity_activity_links_attachment_primary_idx
  ON opportunity_activity_links(attachment_id) WHERE link_role = 'primary' AND attachment_id IS NOT NULL;
CREATE UNIQUE INDEX opportunity_activity_links_technical_primary_idx
  ON opportunity_activity_links(technical_solution_id) WHERE link_role = 'primary' AND technical_solution_id IS NOT NULL;
CREATE UNIQUE INDEX opportunity_activity_links_quote_primary_idx
  ON opportunity_activity_links(commercial_quote_id) WHERE link_role = 'primary' AND commercial_quote_id IS NOT NULL;
CREATE UNIQUE INDEX opportunity_activity_links_package_primary_idx
  ON opportunity_activity_links(quotation_package_version_id) WHERE link_role = 'primary' AND quotation_package_version_id IS NOT NULL;
CREATE UNIQUE INDEX opportunity_activity_links_contract_primary_idx
  ON opportunity_activity_links(contract_approval_id) WHERE link_role = 'primary' AND contract_approval_id IS NOT NULL;
CREATE UNIQUE INDEX opportunity_activity_links_transfer_primary_idx
  ON opportunity_activity_links(opportunity_owner_transfer_id) WHERE link_role = 'primary' AND opportunity_owner_transfer_id IS NOT NULL;
CREATE UNIQUE INDEX opportunity_activity_links_member_primary_idx
  ON opportunity_activity_links(opportunity_member_event_id) WHERE link_role = 'primary' AND opportunity_member_event_id IS NOT NULL;
CREATE UNIQUE INDEX opportunity_activity_links_contribution_primary_idx
  ON opportunity_activity_links(engineering_contribution_id) WHERE link_role = 'primary' AND engineering_contribution_id IS NOT NULL;

CREATE TABLE opportunity_activity_participants (
  id bigserial PRIMARY KEY,
  activity_id uuid NOT NULL REFERENCES opportunity_activities(id) ON DELETE RESTRICT,
  participant_role text NOT NULL CHECK (participant_role ~ '^[a-z][a-z0-9_]{0,39}$'),
  participant_key text NOT NULL CHECK (btrim(participant_key) <> ''),
  user_id bigint REFERENCES users(id) ON DELETE RESTRICT,
  contact_id bigint REFERENCES contacts(id) ON DELETE RESTRICT,
  email_address text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT opportunity_activity_participants_one_identity_check
    CHECK (num_nonnulls(user_id, contact_id, email_address) = 1),
  CONSTRAINT opportunity_activity_participants_key_check CHECK (
    (user_id IS NOT NULL AND participant_key = 'user:' || user_id::text)
    OR (contact_id IS NOT NULL AND participant_key = 'contact:' || contact_id::text)
    OR (email_address IS NOT NULL AND btrim(email_address) <> '' AND participant_key = 'email:' || lower(btrim(email_address)))
  ),
  UNIQUE (activity_id, participant_role, participant_key)
);

CREATE INDEX opportunity_activity_participants_contact_idx
  ON opportunity_activity_participants(contact_id, activity_id)
  WHERE contact_id IS NOT NULL;
CREATE INDEX opportunity_activity_participants_user_idx
  ON opportunity_activity_participants(user_id, activity_id)
  WHERE user_id IS NOT NULL;

CREATE TABLE opportunity_activity_backfill_state (
  source_code text PRIMARY KEY CHECK (source_code ~ '^[a-z][a-z0-9_]{0,62}$'),
  high_water_id bigint NOT NULL DEFAULT 0 CHECK (high_water_id >= 0),
  last_source_id bigint NOT NULL DEFAULT 0 CHECK (last_source_id >= 0),
  scanned_count bigint NOT NULL DEFAULT 0 CHECK (scanned_count >= 0),
  indexed_count bigint NOT NULL DEFAULT 0 CHECK (indexed_count >= 0),
  skipped_count bigint NOT NULL DEFAULT 0 CHECK (skipped_count >= 0),
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT opportunity_activity_backfill_cursor_check CHECK (last_source_id <= high_water_id)
);

CREATE OR REPLACE FUNCTION bestcrm_reject_activity_spine_change()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'Opportunity activity spine records are append-only';
END;
$$;

CREATE TRIGGER opportunity_activities_append_only_guard
BEFORE UPDATE OR DELETE ON opportunity_activities
FOR EACH ROW EXECUTE FUNCTION bestcrm_reject_activity_spine_change();
CREATE TRIGGER opportunity_activity_links_append_only_guard
BEFORE UPDATE OR DELETE ON opportunity_activity_links
FOR EACH ROW EXECUTE FUNCTION bestcrm_reject_activity_spine_change();
CREATE TRIGGER opportunity_activity_participants_append_only_guard
BEFORE UPDATE OR DELETE ON opportunity_activity_participants
FOR EACH ROW EXECUTE FUNCTION bestcrm_reject_activity_spine_change();

CREATE OR REPLACE FUNCTION bestcrm_ensure_opportunity_activity(
  p_opportunity_id bigint,
  p_type_code text,
  p_status text,
  p_direction text,
  p_occurred_at timestamptz,
  p_actor_user_id bigint,
  p_owner_user_id bigint,
  p_subject text,
  p_summary text,
  p_visibility text,
  p_source_system text,
  p_source_external_key text,
  p_snapshot jsonb
)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  activity_id uuid;
  existing_opportunity_id bigint;
  existing_type_code text;
BEGIN
  INSERT INTO opportunity_activities (
    opportunity_id, type_code, status, direction, occurred_at,
    actor_user_id, owner_user_id, subject, summary, visibility,
    source_system, source_external_key, snapshot
  ) VALUES (
    p_opportunity_id, p_type_code, p_status, p_direction, p_occurred_at,
    p_actor_user_id, p_owner_user_id, COALESCE(p_subject, ''),
    COALESCE(p_summary, ''), p_visibility, p_source_system,
    p_source_external_key, COALESCE(p_snapshot, '{}'::jsonb)
  )
  ON CONFLICT (source_system, source_external_key) DO NOTHING
  RETURNING id INTO activity_id;

  IF activity_id IS NULL THEN
    SELECT id, opportunity_id, type_code
    INTO activity_id, existing_opportunity_id, existing_type_code
    FROM opportunity_activities
    WHERE source_system = p_source_system
      AND source_external_key = p_source_external_key;

    IF existing_opportunity_id IS DISTINCT FROM p_opportunity_id
        OR existing_type_code IS DISTINCT FROM p_type_code THEN
      RAISE EXCEPTION 'Activity source identity conflicts with opportunity or activity type';
    END IF;
  END IF;
  RETURN activity_id;
END;
$$;

CREATE OR REPLACE FUNCTION bestcrm_add_activity_participant(
  p_activity_id uuid,
  p_participant_role text,
  p_user_id bigint DEFAULT NULL,
  p_contact_id bigint DEFAULT NULL,
  p_email_address text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  participant_key_value text;
  normalized_email text;
BEGIN
  normalized_email := NULLIF(lower(btrim(COALESCE(p_email_address, ''))), '');
  IF num_nonnulls(p_user_id, p_contact_id, normalized_email) <> 1 THEN
    RETURN;
  END IF;
  participant_key_value := CASE
    WHEN p_user_id IS NOT NULL THEN 'user:' || p_user_id::text
    WHEN p_contact_id IS NOT NULL THEN 'contact:' || p_contact_id::text
    ELSE 'email:' || normalized_email
  END;
  INSERT INTO opportunity_activity_participants (
    activity_id, participant_role, participant_key,
    user_id, contact_id, email_address
  ) VALUES (
    p_activity_id, p_participant_role, participant_key_value,
    p_user_id, p_contact_id, normalized_email
  ) ON CONFLICT (activity_id, participant_role, participant_key) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION bestcrm_index_activity_source(p_source_table text, p_source_id bigint)
RETURNS uuid
LANGUAGE plpgsql
AS $$
DECLARE
  source_row record;
  activity_id_value uuid;
  opportunity_id_value bigint;
  type_code_value text;
  status_value text;
  direction_value text := 'internal';
  occurred_at_value timestamptz;
  actor_user_id_value bigint;
  owner_user_id_value bigint;
  contact_id_value bigint;
  participant_email_value text;
  subject_value text;
  summary_value text;
  visibility_value text := 'opportunity_team';
  snapshot_value jsonb := '{}'::jsonb;
BEGIN
  IF p_source_id IS NULL OR p_source_id <= 0 THEN
    RAISE EXCEPTION 'Activity source ID must be a positive integer';
  END IF;

  CASE p_source_table
    WHEN 'workflow_events' THEN
      SELECT * INTO source_row FROM workflow_events WHERE id = p_source_id;
      IF NOT FOUND THEN RETURN NULL; END IF;
      opportunity_id_value := source_row.opportunity_id;
      type_code_value := CASE WHEN source_row.event_type ~* '(won|lost|outcome)' THEN 'outcome' ELSE 'workflow' END;
      status_value := COALESCE(NULLIF(source_row.to_status, ''), source_row.event_type);
      occurred_at_value := source_row.created_at;
      actor_user_id_value := source_row.actor_user_id;
      owner_user_id_value := source_row.target_user_id;
      subject_value := source_row.event_type;
      summary_value := COALESCE(source_row.comment, '');
      snapshot_value := jsonb_strip_nulls(jsonb_build_object(
        'sourceId', source_row.id, 'eventType', source_row.event_type,
        'fromStatus', source_row.from_status, 'toStatus', source_row.to_status,
        'targetUserId', source_row.target_user_id
      ));

    WHEN 'email_messages' THEN
      SELECT message.*, thread.opportunity_id AS linked_opportunity_id,
             thread.contact_id AS linked_contact_id,
             thread.assigned_user_id AS linked_owner_user_id
      INTO source_row
      FROM email_messages message
      JOIN email_threads thread ON thread.id = message.thread_id
      WHERE message.id = p_source_id;
      IF NOT FOUND OR source_row.linked_opportunity_id IS NULL THEN RETURN NULL; END IF;
      opportunity_id_value := source_row.linked_opportunity_id;
      type_code_value := 'email';
      status_value := source_row.delivery_status;
      direction_value := source_row.direction;
      occurred_at_value := COALESCE(source_row.received_at, source_row.sent_at, source_row.created_at);
      actor_user_id_value := source_row.authored_by;
      owner_user_id_value := source_row.linked_owner_user_id;
      contact_id_value := source_row.linked_contact_id;
      participant_email_value := source_row.from_address;
      subject_value := source_row.subject;
      summary_value := CASE
        WHEN source_row.direction = 'inbound' THEN 'Inbound email from ' || source_row.from_address
        ELSE 'Outbound email'
      END;
      snapshot_value := jsonb_strip_nulls(jsonb_build_object(
        'sourceId', source_row.id, 'threadId', source_row.thread_id,
        'direction', source_row.direction, 'deliveryStatus', source_row.delivery_status,
        'fromAddress', source_row.from_address, 'messageId', NULLIF(source_row.message_id, ''),
        'providerMessageId', NULLIF(source_row.provider_message_id, ''),
        'rawEmlSha256', source_row.raw_eml_sha256,
        'archiveDisposition', source_row.archive_disposition
      ));

    WHEN 'sales_work_plans' THEN
      SELECT * INTO source_row FROM sales_work_plans WHERE id = p_source_id;
      IF NOT FOUND OR source_row.opportunity_id IS NULL THEN RETURN NULL; END IF;
      opportunity_id_value := source_row.opportunity_id;
      type_code_value := CASE source_row.activity_type
        WHEN 'call' THEN 'call' WHEN 'email' THEN 'email'
        WHEN 'meeting' THEN 'meeting' WHEN 'visit' THEN 'meeting'
        WHEN 'quotation_followup' THEN 'quotation'
        WHEN 'technical_followup' THEN 'technical'
        WHEN 'contract_followup' THEN 'contract' ELSE 'task' END;
      status_value := source_row.status;
      occurred_at_value := source_row.plan_date::timestamptz;
      actor_user_id_value := source_row.salesperson_user_id;
      owner_user_id_value := source_row.salesperson_user_id;
      contact_id_value := source_row.contact_id;
      subject_value := source_row.subject;
      summary_value := source_row.objective;
      snapshot_value := jsonb_strip_nulls(jsonb_build_object(
        'sourceId', source_row.id, 'activityType', source_row.activity_type,
        'planDate', source_row.plan_date, 'customerId', source_row.customer_id,
        'contactId', source_row.contact_id
      ));

    WHEN 'sales_work_logs' THEN
      SELECT * INTO source_row FROM sales_work_logs WHERE id = p_source_id;
      IF NOT FOUND OR source_row.opportunity_id IS NULL THEN RETURN NULL; END IF;
      opportunity_id_value := source_row.opportunity_id;
      type_code_value := CASE source_row.activity_type
        WHEN 'call' THEN 'call' WHEN 'email' THEN 'email'
        WHEN 'meeting' THEN 'meeting' WHEN 'visit' THEN 'meeting'
        WHEN 'quotation_followup' THEN 'quotation'
        WHEN 'technical_followup' THEN 'technical'
        WHEN 'contract_followup' THEN 'contract' ELSE 'note' END;
      status_value := 'recorded';
      occurred_at_value := source_row.log_date::timestamptz;
      actor_user_id_value := source_row.salesperson_user_id;
      owner_user_id_value := source_row.salesperson_user_id;
      contact_id_value := source_row.contact_id;
      subject_value := source_row.subject;
      summary_value := source_row.result;
      snapshot_value := jsonb_strip_nulls(jsonb_build_object(
        'sourceId', source_row.id, 'activityType', source_row.activity_type,
        'logDate', source_row.log_date, 'customerId', source_row.customer_id,
        'contactId', source_row.contact_id, 'nextPlanDate', source_row.next_plan_date
      ));

    WHEN 'attachments' THEN
      SELECT * INTO source_row FROM attachments WHERE id = p_source_id;
      IF NOT FOUND THEN RETURN NULL; END IF;
      opportunity_id_value := source_row.opportunity_id;
      type_code_value := 'file';
      status_value := 'stored';
      occurred_at_value := source_row.uploaded_at;
      actor_user_id_value := source_row.uploaded_by;
      subject_value := source_row.original_name;
      summary_value := source_row.category;
      snapshot_value := jsonb_strip_nulls(jsonb_build_object(
        'sourceId', source_row.id, 'category', source_row.category,
        'originalName', source_row.original_name, 'mimeType', source_row.mime_type,
        'fileSize', source_row.file_size, 'storedPath', source_row.stored_path
      ));

    WHEN 'technical_solutions' THEN
      SELECT * INTO source_row FROM technical_solutions WHERE id = p_source_id;
      IF NOT FOUND THEN RETURN NULL; END IF;
      opportunity_id_value := source_row.opportunity_id;
      type_code_value := 'technical';
      status_value := source_row.status;
      occurred_at_value := source_row.submitted_at;
      actor_user_id_value := source_row.submitted_by;
      subject_value := 'Technical solution V' || COALESCE(source_row.version_no::text, '?');
      summary_value := source_row.summary;
      visibility_value := 'technical';
      snapshot_value := jsonb_strip_nulls(jsonb_build_object(
        'sourceId', source_row.id, 'versionNo', source_row.version_no,
        'status', source_row.status, 'technicalDraftId', source_row.opportunity_technical_draft_id
      ));

    WHEN 'commercial_quotes' THEN
      SELECT * INTO source_row FROM commercial_quotes WHERE id = p_source_id;
      IF NOT FOUND THEN RETURN NULL; END IF;
      opportunity_id_value := source_row.opportunity_id;
      type_code_value := 'quotation';
      status_value := source_row.status;
      occurred_at_value := source_row.submitted_at;
      actor_user_id_value := source_row.submitted_by;
      subject_value := 'Commercial quote V' || COALESCE(source_row.version_no::text, '?');
      summary_value := COALESCE(source_row.remarks, '');
      visibility_value := 'commercial';
      snapshot_value := jsonb_strip_nulls(jsonb_build_object(
        'sourceId', source_row.id, 'versionNo', source_row.version_no,
        'status', source_row.status, 'totalPrice', source_row.total_price,
        'validityDate', source_row.validity_date
      ));

    WHEN 'quotation_package_versions' THEN
      SELECT * INTO source_row FROM quotation_package_versions WHERE id = p_source_id;
      IF NOT FOUND THEN RETURN NULL; END IF;
      opportunity_id_value := source_row.opportunity_id;
      type_code_value := 'quotation';
      status_value := source_row.status;
      occurred_at_value := source_row.created_at;
      actor_user_id_value := source_row.created_by;
      subject_value := 'Quotation package draft ' || source_row.draft_revision_no::text;
      summary_value := COALESCE(source_row.change_summary, '');
      visibility_value := 'commercial';
      snapshot_value := jsonb_strip_nulls(jsonb_build_object(
        'sourceId', source_row.id, 'draftRevisionNo', source_row.draft_revision_no,
        'versionNo', source_row.version_no, 'status', source_row.status,
        'currency', source_row.currency, 'totalPrice', source_row.total_price,
        'sourcePackageId', source_row.source_package_id
      ));

    WHEN 'contract_approvals' THEN
      SELECT * INTO source_row FROM contract_approvals WHERE id = p_source_id;
      IF NOT FOUND THEN RETURN NULL; END IF;
      opportunity_id_value := source_row.opportunity_id;
      type_code_value := 'contract';
      status_value := source_row.status;
      occurred_at_value := source_row.submitted_at;
      actor_user_id_value := source_row.submitted_by;
      subject_value := 'Contract approval V' || COALESCE(source_row.version_no::text, '?');
      summary_value := 'Current approval step ' || source_row.current_step::text;
      visibility_value := 'management';
      snapshot_value := jsonb_strip_nulls(jsonb_build_object(
        'sourceId', source_row.id, 'versionNo', source_row.version_no,
        'status', source_row.status, 'currentStep', source_row.current_step,
        'quotationPackageVersionId', source_row.quotation_package_version_id
      ));

    WHEN 'opportunity_owner_transfers' THEN
      SELECT * INTO source_row FROM opportunity_owner_transfers WHERE id = p_source_id;
      IF NOT FOUND THEN RETURN NULL; END IF;
      opportunity_id_value := source_row.opportunity_id;
      type_code_value := 'ownership';
      status_value := 'transferred';
      occurred_at_value := source_row.transferred_at;
      actor_user_id_value := source_row.changed_by;
      owner_user_id_value := source_row.to_owner_user_id;
      subject_value := 'Opportunity owner transferred';
      summary_value := source_row.reason;
      visibility_value := 'management';
      snapshot_value := jsonb_build_object(
        'sourceId', source_row.id, 'fromOwnerUserId', source_row.from_owner_user_id,
        'toOwnerUserId', source_row.to_owner_user_id,
        'keepPreviousOwnerAsMember', source_row.keep_previous_owner_as_member
      );

    WHEN 'opportunity_member_events' THEN
      SELECT * INTO source_row FROM opportunity_member_events WHERE id = p_source_id;
      IF NOT FOUND THEN RETURN NULL; END IF;
      opportunity_id_value := source_row.opportunity_id;
      type_code_value := 'ownership';
      status_value := source_row.event_type;
      occurred_at_value := source_row.created_at;
      actor_user_id_value := source_row.actor_user_id;
      owner_user_id_value := source_row.user_id;
      subject_value := 'Opportunity member ' || source_row.event_type;
      summary_value := COALESCE(source_row.task_description, source_row.assignment_scope, '');
      visibility_value := 'management';
      snapshot_value := jsonb_strip_nulls(jsonb_build_object(
        'sourceId', source_row.id, 'memberId', source_row.member_id,
        'userId', source_row.user_id, 'eventType', source_row.event_type,
        'roleCode', source_row.role_code, 'permissionLevel', source_row.permission_level,
        'dueDate', source_row.due_date
      ));

    WHEN 'opportunity_engineering_contributions' THEN
      SELECT * INTO source_row FROM opportunity_engineering_contributions WHERE id = p_source_id;
      IF NOT FOUND THEN RETURN NULL; END IF;
      opportunity_id_value := source_row.opportunity_id;
      type_code_value := 'technical';
      status_value := 'recorded';
      occurred_at_value := source_row.created_at;
      actor_user_id_value := source_row.created_by;
      owner_user_id_value := source_row.contributor_user_id;
      subject_value := 'Engineering contribution';
      summary_value := source_row.contribution_summary;
      visibility_value := 'technical';
      snapshot_value := jsonb_build_object(
        'sourceId', source_row.id, 'contributorUserId', source_row.contributor_user_id
      );

    ELSE
      RAISE EXCEPTION 'Unsupported activity source table: %', p_source_table;
  END CASE;

  activity_id_value := bestcrm_ensure_opportunity_activity(
    opportunity_id_value, type_code_value, status_value, direction_value,
    occurred_at_value, actor_user_id_value, owner_user_id_value,
    subject_value, summary_value, visibility_value,
    p_source_table, p_source_id::text, snapshot_value
  );

  CASE p_source_table
    WHEN 'workflow_events' THEN
      INSERT INTO opportunity_activity_links(activity_id, workflow_event_id) VALUES (activity_id_value, p_source_id) ON CONFLICT DO NOTHING;
    WHEN 'email_messages' THEN
      INSERT INTO opportunity_activity_links(activity_id, email_message_id) VALUES (activity_id_value, p_source_id) ON CONFLICT DO NOTHING;
    WHEN 'sales_work_plans' THEN
      INSERT INTO opportunity_activity_links(activity_id, sales_work_plan_id) VALUES (activity_id_value, p_source_id) ON CONFLICT DO NOTHING;
    WHEN 'sales_work_logs' THEN
      INSERT INTO opportunity_activity_links(activity_id, sales_work_log_id) VALUES (activity_id_value, p_source_id) ON CONFLICT DO NOTHING;
    WHEN 'attachments' THEN
      INSERT INTO opportunity_activity_links(activity_id, attachment_id) VALUES (activity_id_value, p_source_id) ON CONFLICT DO NOTHING;
    WHEN 'technical_solutions' THEN
      INSERT INTO opportunity_activity_links(activity_id, technical_solution_id) VALUES (activity_id_value, p_source_id) ON CONFLICT DO NOTHING;
    WHEN 'commercial_quotes' THEN
      INSERT INTO opportunity_activity_links(activity_id, commercial_quote_id) VALUES (activity_id_value, p_source_id) ON CONFLICT DO NOTHING;
    WHEN 'quotation_package_versions' THEN
      INSERT INTO opportunity_activity_links(activity_id, quotation_package_version_id) VALUES (activity_id_value, p_source_id) ON CONFLICT DO NOTHING;
    WHEN 'contract_approvals' THEN
      INSERT INTO opportunity_activity_links(activity_id, contract_approval_id) VALUES (activity_id_value, p_source_id) ON CONFLICT DO NOTHING;
    WHEN 'opportunity_owner_transfers' THEN
      INSERT INTO opportunity_activity_links(activity_id, opportunity_owner_transfer_id) VALUES (activity_id_value, p_source_id) ON CONFLICT DO NOTHING;
    WHEN 'opportunity_member_events' THEN
      INSERT INTO opportunity_activity_links(activity_id, opportunity_member_event_id) VALUES (activity_id_value, p_source_id) ON CONFLICT DO NOTHING;
    WHEN 'opportunity_engineering_contributions' THEN
      INSERT INTO opportunity_activity_links(activity_id, engineering_contribution_id) VALUES (activity_id_value, p_source_id) ON CONFLICT DO NOTHING;
  END CASE;

  IF NOT EXISTS (
    SELECT 1
    FROM opportunity_activity_links link
    WHERE link.activity_id = activity_id_value
      AND link.link_role = 'primary'
      AND CASE p_source_table
        WHEN 'workflow_events' THEN link.workflow_event_id = p_source_id
        WHEN 'email_messages' THEN link.email_message_id = p_source_id
        WHEN 'sales_work_plans' THEN link.sales_work_plan_id = p_source_id
        WHEN 'sales_work_logs' THEN link.sales_work_log_id = p_source_id
        WHEN 'attachments' THEN link.attachment_id = p_source_id
        WHEN 'technical_solutions' THEN link.technical_solution_id = p_source_id
        WHEN 'commercial_quotes' THEN link.commercial_quote_id = p_source_id
        WHEN 'quotation_package_versions' THEN link.quotation_package_version_id = p_source_id
        WHEN 'contract_approvals' THEN link.contract_approval_id = p_source_id
        WHEN 'opportunity_owner_transfers' THEN link.opportunity_owner_transfer_id = p_source_id
        WHEN 'opportunity_member_events' THEN link.opportunity_member_event_id = p_source_id
        WHEN 'opportunity_engineering_contributions' THEN link.engineering_contribution_id = p_source_id
        ELSE false
      END
  ) THEN
    RAISE EXCEPTION 'Activity primary link conflicts with its source identity';
  END IF;

  PERFORM bestcrm_add_activity_participant(activity_id_value, 'actor', actor_user_id_value, NULL, NULL);
  PERFORM bestcrm_add_activity_participant(activity_id_value, 'owner', owner_user_id_value, NULL, NULL);
  PERFORM bestcrm_add_activity_participant(activity_id_value, 'contact', NULL, contact_id_value, NULL);
  PERFORM bestcrm_add_activity_participant(activity_id_value, 'sender', NULL, NULL, participant_email_value);
  RETURN activity_id_value;
END;
$$;

CREATE OR REPLACE FUNCTION bestcrm_index_activity_source_trigger()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM bestcrm_index_activity_source(TG_TABLE_NAME, NEW.id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER workflow_events_activity_index
AFTER INSERT ON workflow_events FOR EACH ROW EXECUTE FUNCTION bestcrm_index_activity_source_trigger();
CREATE TRIGGER email_messages_activity_index
AFTER INSERT ON email_messages FOR EACH ROW EXECUTE FUNCTION bestcrm_index_activity_source_trigger();
CREATE TRIGGER sales_work_plans_activity_index
AFTER INSERT ON sales_work_plans FOR EACH ROW EXECUTE FUNCTION bestcrm_index_activity_source_trigger();
CREATE TRIGGER sales_work_logs_activity_index
AFTER INSERT ON sales_work_logs FOR EACH ROW EXECUTE FUNCTION bestcrm_index_activity_source_trigger();
CREATE TRIGGER attachments_activity_index
AFTER INSERT ON attachments FOR EACH ROW EXECUTE FUNCTION bestcrm_index_activity_source_trigger();
CREATE TRIGGER technical_solutions_activity_index
AFTER INSERT ON technical_solutions FOR EACH ROW EXECUTE FUNCTION bestcrm_index_activity_source_trigger();
CREATE TRIGGER commercial_quotes_activity_index
AFTER INSERT ON commercial_quotes FOR EACH ROW EXECUTE FUNCTION bestcrm_index_activity_source_trigger();
CREATE TRIGGER quotation_package_versions_activity_index
AFTER INSERT ON quotation_package_versions FOR EACH ROW EXECUTE FUNCTION bestcrm_index_activity_source_trigger();
CREATE TRIGGER contract_approvals_activity_index
AFTER INSERT ON contract_approvals FOR EACH ROW EXECUTE FUNCTION bestcrm_index_activity_source_trigger();
CREATE TRIGGER opportunity_owner_transfers_activity_index
AFTER INSERT ON opportunity_owner_transfers FOR EACH ROW EXECUTE FUNCTION bestcrm_index_activity_source_trigger();
CREATE TRIGGER opportunity_member_events_activity_index
AFTER INSERT ON opportunity_member_events FOR EACH ROW EXECUTE FUNCTION bestcrm_index_activity_source_trigger();
CREATE TRIGGER opportunity_engineering_contributions_activity_index
AFTER INSERT ON opportunity_engineering_contributions FOR EACH ROW EXECUTE FUNCTION bestcrm_index_activity_source_trigger();

CREATE OR REPLACE FUNCTION bestcrm_protect_indexed_source_opportunity()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.opportunity_id IS DISTINCT FROM OLD.opportunity_id
      AND EXISTS (
        SELECT 1
        FROM opportunity_activities activity
        WHERE activity.source_system = TG_TABLE_NAME
          AND activity.source_external_key = NEW.id::text
      ) THEN
    RAISE EXCEPTION 'An indexed activity source cannot be moved to or unlinked from another opportunity';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION bestcrm_index_source_after_opportunity_link()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.opportunity_id IS NOT NULL
      AND NEW.opportunity_id IS DISTINCT FROM OLD.opportunity_id THEN
    PERFORM bestcrm_index_activity_source(TG_TABLE_NAME, NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER workflow_events_activity_opportunity_guard
BEFORE UPDATE OF opportunity_id ON workflow_events FOR EACH ROW EXECUTE FUNCTION bestcrm_protect_indexed_source_opportunity();
CREATE TRIGGER workflow_events_activity_opportunity_link
AFTER UPDATE OF opportunity_id ON workflow_events FOR EACH ROW EXECUTE FUNCTION bestcrm_index_source_after_opportunity_link();
CREATE TRIGGER sales_work_plans_activity_opportunity_guard
BEFORE UPDATE OF opportunity_id ON sales_work_plans FOR EACH ROW EXECUTE FUNCTION bestcrm_protect_indexed_source_opportunity();
CREATE TRIGGER sales_work_plans_activity_opportunity_link
AFTER UPDATE OF opportunity_id ON sales_work_plans FOR EACH ROW EXECUTE FUNCTION bestcrm_index_source_after_opportunity_link();
CREATE TRIGGER sales_work_logs_activity_opportunity_guard
BEFORE UPDATE OF opportunity_id ON sales_work_logs FOR EACH ROW EXECUTE FUNCTION bestcrm_protect_indexed_source_opportunity();
CREATE TRIGGER sales_work_logs_activity_opportunity_link
AFTER UPDATE OF opportunity_id ON sales_work_logs FOR EACH ROW EXECUTE FUNCTION bestcrm_index_source_after_opportunity_link();
CREATE TRIGGER attachments_activity_opportunity_guard
BEFORE UPDATE OF opportunity_id ON attachments FOR EACH ROW EXECUTE FUNCTION bestcrm_protect_indexed_source_opportunity();
CREATE TRIGGER attachments_activity_opportunity_link
AFTER UPDATE OF opportunity_id ON attachments FOR EACH ROW EXECUTE FUNCTION bestcrm_index_source_after_opportunity_link();
CREATE TRIGGER technical_solutions_activity_opportunity_guard
BEFORE UPDATE OF opportunity_id ON technical_solutions FOR EACH ROW EXECUTE FUNCTION bestcrm_protect_indexed_source_opportunity();
CREATE TRIGGER technical_solutions_activity_opportunity_link
AFTER UPDATE OF opportunity_id ON technical_solutions FOR EACH ROW EXECUTE FUNCTION bestcrm_index_source_after_opportunity_link();
CREATE TRIGGER commercial_quotes_activity_opportunity_guard
BEFORE UPDATE OF opportunity_id ON commercial_quotes FOR EACH ROW EXECUTE FUNCTION bestcrm_protect_indexed_source_opportunity();
CREATE TRIGGER commercial_quotes_activity_opportunity_link
AFTER UPDATE OF opportunity_id ON commercial_quotes FOR EACH ROW EXECUTE FUNCTION bestcrm_index_source_after_opportunity_link();
CREATE TRIGGER quotation_package_versions_activity_opportunity_guard
BEFORE UPDATE OF opportunity_id ON quotation_package_versions FOR EACH ROW EXECUTE FUNCTION bestcrm_protect_indexed_source_opportunity();
CREATE TRIGGER quotation_package_versions_activity_opportunity_link
AFTER UPDATE OF opportunity_id ON quotation_package_versions FOR EACH ROW EXECUTE FUNCTION bestcrm_index_source_after_opportunity_link();
CREATE TRIGGER contract_approvals_activity_opportunity_guard
BEFORE UPDATE OF opportunity_id ON contract_approvals FOR EACH ROW EXECUTE FUNCTION bestcrm_protect_indexed_source_opportunity();
CREATE TRIGGER contract_approvals_activity_opportunity_link
AFTER UPDATE OF opportunity_id ON contract_approvals FOR EACH ROW EXECUTE FUNCTION bestcrm_index_source_after_opportunity_link();
CREATE TRIGGER opportunity_owner_transfers_activity_opportunity_guard
BEFORE UPDATE OF opportunity_id ON opportunity_owner_transfers FOR EACH ROW EXECUTE FUNCTION bestcrm_protect_indexed_source_opportunity();
CREATE TRIGGER opportunity_owner_transfers_activity_opportunity_link
AFTER UPDATE OF opportunity_id ON opportunity_owner_transfers FOR EACH ROW EXECUTE FUNCTION bestcrm_index_source_after_opportunity_link();
CREATE TRIGGER opportunity_member_events_activity_opportunity_guard
BEFORE UPDATE OF opportunity_id ON opportunity_member_events FOR EACH ROW EXECUTE FUNCTION bestcrm_protect_indexed_source_opportunity();
CREATE TRIGGER opportunity_member_events_activity_opportunity_link
AFTER UPDATE OF opportunity_id ON opportunity_member_events FOR EACH ROW EXECUTE FUNCTION bestcrm_index_source_after_opportunity_link();
CREATE TRIGGER opportunity_engineering_contributions_activity_opportunity_guard
BEFORE UPDATE OF opportunity_id ON opportunity_engineering_contributions FOR EACH ROW EXECUTE FUNCTION bestcrm_protect_indexed_source_opportunity();
CREATE TRIGGER opportunity_engineering_contributions_activity_opportunity_link
AFTER UPDATE OF opportunity_id ON opportunity_engineering_contributions FOR EACH ROW EXECUTE FUNCTION bestcrm_index_source_after_opportunity_link();

CREATE OR REPLACE FUNCTION bestcrm_index_email_thread_after_opportunity_link()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  message_row record;
BEGIN
  IF NEW.opportunity_id IS NOT DISTINCT FROM OLD.opportunity_id THEN
    RETURN NEW;
  END IF;

  IF NEW.opportunity_id IS NULL AND EXISTS (
    SELECT 1
    FROM email_messages message
    JOIN opportunity_activity_links link ON link.email_message_id = message.id AND link.link_role = 'primary'
    WHERE message.thread_id = NEW.id
  ) THEN
    RAISE EXCEPTION 'An indexed email thread cannot be unlinked from its opportunity';
  END IF;

  IF NEW.opportunity_id IS NOT NULL THEN
    FOR message_row IN SELECT id FROM email_messages WHERE thread_id = NEW.id ORDER BY id LOOP
      PERFORM bestcrm_index_activity_source('email_messages', message_row.id);
    END LOOP;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER email_threads_opportunity_activity_index
AFTER UPDATE OF opportunity_id ON email_threads
FOR EACH ROW EXECUTE FUNCTION bestcrm_index_email_thread_after_opportunity_link();
