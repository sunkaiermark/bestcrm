-- Keep the original acquisition fact independent from later sales ownership.
-- Lead lifecycle is an organisational layer only; it must not create or alter
-- an opportunity without the existing sales-manager approval path.
ALTER TABLE inquiries
  ADD COLUMN IF NOT EXISTS source_attribution_channel text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS source_attribution_owner_user_id bigint REFERENCES users(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS source_attribution_owner_label text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS source_attribution_note text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS lead_lifecycle_state text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS lead_next_follow_up_on date,
  ADD COLUMN IF NOT EXISTS lead_last_followed_up_at timestamptz,
  ADD COLUMN IF NOT EXISTS lead_lifecycle_reason text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS lead_related_inquiry_id bigint REFERENCES inquiries(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS lead_archived_at timestamptz;

UPDATE inquiries
SET
  source_attribution_channel = CASE
    WHEN btrim(source_attribution_channel) <> '' THEN source_attribution_channel
    WHEN btrim(source_channel) <> '' THEN source_channel
    ELSE source
  END,
  source_attribution_owner_user_id = CASE
    WHEN source_attribution_owner_user_id IS NOT NULL THEN source_attribution_owner_user_id
    WHEN source = 'manual' AND created_by IS NOT NULL THEN created_by
    ELSE NULL
  END,
  source_attribution_owner_label = CASE
    WHEN btrim(source_attribution_owner_label) <> '' THEN source_attribution_owner_label
    WHEN source = 'website' THEN '官网表单'
    WHEN source = 'email' THEN '邮件询盘'
    WHEN source = 'chatwoot' THEN '在线客服'
    WHEN source = 'manual' THEN '人工提交'
    ELSE '其他来源'
  END
WHERE NOT (
  submission_type = 'sales_lead'
  AND (status = 'converted' OR converted_opportunity_id IS NOT NULL)
);

ALTER TABLE inquiries
  DROP CONSTRAINT IF EXISTS inquiries_lead_lifecycle_state_check;

ALTER TABLE inquiries
  ADD CONSTRAINT inquiries_lead_lifecycle_state_check
  CHECK (lead_lifecycle_state IN ('active', 'nurture', 'closed', 'duplicate'));

ALTER TABLE inquiries
  ADD CONSTRAINT inquiries_lead_related_inquiry_not_self_check
  CHECK (lead_related_inquiry_id IS NULL OR lead_related_inquiry_id <> id);

CREATE INDEX IF NOT EXISTS inquiries_lead_lifecycle_follow_up_idx
  ON inquiries(lead_lifecycle_state, lead_next_follow_up_on, id DESC)
  WHERE lead_lifecycle_state = 'nurture';

CREATE INDEX IF NOT EXISTS inquiries_company_name_lookup_idx
  ON inquiries(lower(btrim(company_name)), id DESC)
  WHERE btrim(company_name) <> '';

CREATE TABLE IF NOT EXISTS inquiry_lead_follow_up_events (
  id bigserial PRIMARY KEY,
  inquiry_id bigint NOT NULL REFERENCES inquiries(id) ON DELETE RESTRICT,
  actor_user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  note text NOT NULL CHECK (char_length(btrim(note)) BETWEEN 1 AND 2000),
  next_follow_up_on date,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inquiry_lead_follow_up_events_inquiry_idx
  ON inquiry_lead_follow_up_events(inquiry_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS inquiry_lead_management_events (
  id bigserial PRIMARY KEY,
  inquiry_id bigint NOT NULL REFERENCES inquiries(id) ON DELETE RESTRICT,
  actor_user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  from_state text NOT NULL CHECK (from_state IN ('active', 'nurture', 'closed', 'duplicate')),
  to_state text NOT NULL CHECK (to_state IN ('active', 'nurture', 'closed', 'duplicate')),
  reason text NOT NULL DEFAULT '',
  related_inquiry_id bigint REFERENCES inquiries(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inquiry_lead_management_events_inquiry_idx
  ON inquiry_lead_management_events(inquiry_id, created_at DESC, id DESC);

CREATE OR REPLACE FUNCTION bestcrm_protect_inquiry_lead_management_event()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Lead management events are immutable';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS inquiry_lead_management_events_no_change ON inquiry_lead_management_events;
CREATE TRIGGER inquiry_lead_management_events_no_change
BEFORE UPDATE OR DELETE ON inquiry_lead_management_events
FOR EACH ROW EXECUTE FUNCTION bestcrm_protect_inquiry_lead_management_event();

CREATE OR REPLACE FUNCTION bestcrm_protect_inquiry_source_attribution()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.source_attribution_channel := COALESCE(NULLIF(btrim(NEW.source_attribution_channel), ''), NEW.source_channel, NEW.source, 'other');
    IF NEW.source_attribution_owner_user_id IS NULL AND NEW.source = 'manual' THEN
      NEW.source_attribution_owner_user_id := NEW.created_by;
    END IF;
    NEW.source_attribution_owner_label := COALESCE(
      NULLIF(btrim(NEW.source_attribution_owner_label), ''),
      CASE NEW.source
        WHEN 'website' THEN '官网表单'
        WHEN 'email' THEN '邮件询盘'
        WHEN 'chatwoot' THEN '在线客服'
        WHEN 'manual' THEN '人工提交'
        ELSE '其他来源'
      END
    );
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE'
     AND (
       OLD.source_attribution_channel IS DISTINCT FROM NEW.source_attribution_channel
       OR OLD.source_attribution_owner_user_id IS DISTINCT FROM NEW.source_attribution_owner_user_id
       OR OLD.source_attribution_owner_label IS DISTINCT FROM NEW.source_attribution_owner_label
       OR OLD.source_attribution_note IS DISTINCT FROM NEW.source_attribution_note
     ) THEN
    RAISE EXCEPTION 'Inquiry source attribution is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS inquiries_source_attribution_no_change ON inquiries;
CREATE TRIGGER inquiries_source_attribution_no_change
BEFORE INSERT OR UPDATE ON inquiries
FOR EACH ROW EXECUTE FUNCTION bestcrm_protect_inquiry_source_attribution();

COMMENT ON COLUMN inquiries.source_attribution_channel IS
  'Immutable original lead acquisition channel; not the current sales owner.';
COMMENT ON COLUMN inquiries.source_attribution_owner_user_id IS
  'Immutable internal contributor credited with the original lead, when applicable.';
COMMENT ON COLUMN inquiries.lead_lifecycle_state IS
  'Lead organisation state. It never substitutes for sales-manager opportunity approval.';
