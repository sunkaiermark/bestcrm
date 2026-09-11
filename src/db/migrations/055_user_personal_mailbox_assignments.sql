CREATE TABLE IF NOT EXISTS user_personal_mailbox_assignments (
  id bigserial PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  mailbox_address text NOT NULL CHECK (
    mailbox_address = lower(btrim(mailbox_address))
    AND mailbox_address ~ '^[^[:space:]@<>]+@sunkaier[.]com$'
    AND mailbox_address <> 'sales@sunkaier.com'
  ),
  assigned_by bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  unassigned_by bigint REFERENCES users(id) ON DELETE RESTRICT,
  unassigned_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT user_personal_mailbox_assignments_end_state_check CHECK (
    (unassigned_by IS NULL AND unassigned_at IS NULL)
    OR (unassigned_by IS NOT NULL AND unassigned_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS user_personal_mailbox_active_user_idx
  ON user_personal_mailbox_assignments(user_id)
  WHERE unassigned_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS user_personal_mailbox_active_address_idx
  ON user_personal_mailbox_assignments(mailbox_address)
  WHERE unassigned_at IS NULL;

CREATE INDEX IF NOT EXISTS user_personal_mailbox_history_idx
  ON user_personal_mailbox_assignments(user_id, assigned_at DESC, id DESC);

CREATE OR REPLACE FUNCTION bestcrm_protect_personal_mailbox_assignment()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Personal mailbox assignments cannot be deleted';
  END IF;

  IF OLD.unassigned_at IS NOT NULL
      OR NEW.user_id IS DISTINCT FROM OLD.user_id
      OR NEW.mailbox_address IS DISTINCT FROM OLD.mailbox_address
      OR NEW.assigned_by IS DISTINCT FROM OLD.assigned_by
      OR NEW.assigned_at IS DISTINCT FROM OLD.assigned_at
      OR NEW.created_at IS DISTINCT FROM OLD.created_at
      OR NEW.unassigned_at IS NULL
      OR NEW.unassigned_by IS NULL THEN
    RAISE EXCEPTION 'Personal mailbox assignment history is immutable';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS user_personal_mailbox_assignments_no_change
  ON user_personal_mailbox_assignments;
CREATE TRIGGER user_personal_mailbox_assignments_no_change
BEFORE UPDATE OR DELETE ON user_personal_mailbox_assignments
FOR EACH ROW EXECUTE FUNCTION bestcrm_protect_personal_mailbox_assignment();
