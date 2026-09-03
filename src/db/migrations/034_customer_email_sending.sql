ALTER TABLE users
  ADD COLUMN IF NOT EXISTS email_signature_name text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS email_signature_title text NOT NULL DEFAULT '';

ALTER TABLE email_messages
  ADD COLUMN IF NOT EXISTS reply_to_message_id bigint,
  ADD COLUMN IF NOT EXISTS quotation_package_version_id bigint;

ALTER TABLE email_messages
  DROP CONSTRAINT IF EXISTS email_messages_reply_to_message_fk,
  ADD CONSTRAINT email_messages_reply_to_message_fk
    FOREIGN KEY (reply_to_message_id) REFERENCES email_messages(id) ON DELETE RESTRICT,
  DROP CONSTRAINT IF EXISTS email_messages_quotation_package_fk,
  ADD CONSTRAINT email_messages_quotation_package_fk
    FOREIGN KEY (quotation_package_version_id) REFERENCES quotation_package_versions(id) ON DELETE RESTRICT,
  DROP CONSTRAINT IF EXISTS email_messages_delivery_status_check,
  ADD CONSTRAINT email_messages_delivery_status_check
    CHECK (delivery_status IN ('received', 'draft', 'pending', 'sent', 'failed')),
  DROP CONSTRAINT IF EXISTS email_messages_direction_status_check,
  ADD CONSTRAINT email_messages_direction_status_check CHECK (
    (direction = 'inbound' AND delivery_status = 'received' AND received_at IS NOT NULL)
    OR (direction = 'outbound' AND delivery_status IN ('draft', 'pending', 'sent', 'failed'))
  );

CREATE INDEX IF NOT EXISTS email_messages_reply_to_idx
  ON email_messages(reply_to_message_id)
  WHERE reply_to_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS email_messages_quotation_package_idx
  ON email_messages(quotation_package_version_id)
  WHERE quotation_package_version_id IS NOT NULL;

ALTER TABLE quotation_package_versions
  ADD COLUMN IF NOT EXISTS sent_email_message_id bigint;

ALTER TABLE quotation_package_versions
  DROP CONSTRAINT IF EXISTS quotation_package_versions_sent_email_fk,
  ADD CONSTRAINT quotation_package_versions_sent_email_fk
    FOREIGN KEY (sent_email_message_id) REFERENCES email_messages(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX IF NOT EXISTS quotation_package_versions_sent_email_idx
  ON quotation_package_versions(sent_email_message_id)
  WHERE sent_email_message_id IS NOT NULL;

CREATE OR REPLACE FUNCTION bestcrm_protect_email_message_content()
RETURNS trigger AS $$
BEGIN
  IF OLD.direction = 'inbound' THEN
    RAISE EXCEPTION 'Inbound email messages are immutable';
  END IF;

  IF NEW.thread_id IS DISTINCT FROM OLD.thread_id
    OR NEW.direction IS DISTINCT FROM OLD.direction
    OR NEW.message_id IS DISTINCT FROM OLD.message_id
    OR NEW.in_reply_to IS DISTINCT FROM OLD.in_reply_to
    OR NEW.reference_ids IS DISTINCT FROM OLD.reference_ids
    OR NEW.reply_to_message_id IS DISTINCT FROM OLD.reply_to_message_id
    OR NEW.quotation_package_version_id IS DISTINCT FROM OLD.quotation_package_version_id
    OR NEW.provider_mailbox IS DISTINCT FROM OLD.provider_mailbox
    OR NEW.provider_uid_validity IS DISTINCT FROM OLD.provider_uid_validity
    OR NEW.provider_uid IS DISTINCT FROM OLD.provider_uid
    OR NEW.from_address IS DISTINCT FROM OLD.from_address
    OR NEW.from_name IS DISTINCT FROM OLD.from_name
    OR NEW.to_recipients IS DISTINCT FROM OLD.to_recipients
    OR NEW.cc_recipients IS DISTINCT FROM OLD.cc_recipients
    OR NEW.subject IS DISTINCT FROM OLD.subject
    OR NEW.text_body IS DISTINCT FROM OLD.text_body
    OR NEW.html_body IS DISTINCT FROM OLD.html_body
    OR NEW.safe_headers IS DISTINCT FROM OLD.safe_headers
    OR NEW.authored_by IS DISTINCT FROM OLD.authored_by
    OR NEW.received_at IS DISTINCT FROM OLD.received_at
    OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'Archived email message content is immutable';
  END IF;

  IF OLD.delivery_status = 'sent' AND NEW.delivery_status IS DISTINCT FROM 'sent' THEN
    RAISE EXCEPTION 'Sent email delivery state is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION bestcrm_validate_quotation_email_message()
RETURNS trigger AS $$
DECLARE
  package_row quotation_package_versions%ROWTYPE;
BEGIN
  IF NEW.quotation_package_version_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT * INTO package_row
  FROM quotation_package_versions
  WHERE id = NEW.quotation_package_version_id;
  IF package_row.id IS NULL
      OR NEW.direction <> 'outbound'
      OR package_row.opportunity_id IS DISTINCT FROM (
        SELECT opportunity_id FROM email_threads WHERE id = NEW.thread_id
      )
      OR package_row.status <> 'approved' THEN
    RAISE EXCEPTION 'Formal quotation email requires an approved quotation package from the same opportunity';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS email_messages_quotation_package_guard ON email_messages;
CREATE TRIGGER email_messages_quotation_package_guard
BEFORE INSERT OR UPDATE OF quotation_package_version_id, delivery_status ON email_messages
FOR EACH ROW EXECUTE FUNCTION bestcrm_validate_quotation_email_message();

CREATE OR REPLACE FUNCTION bestcrm_validate_sent_quotation_email()
RETURNS trigger AS $$
DECLARE
  message_row email_messages%ROWTYPE;
BEGIN
  IF NEW.status <> 'sent' THEN
    RETURN NEW;
  END IF;
  SELECT * INTO message_row FROM email_messages WHERE id = NEW.sent_email_message_id;
  IF message_row.id IS NULL
      OR message_row.direction <> 'outbound'
      OR message_row.delivery_status <> 'sent'
      OR message_row.quotation_package_version_id IS DISTINCT FROM NEW.id THEN
    RAISE EXCEPTION 'Sent quotation package requires its accepted outbound email record';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS quotation_package_sent_email_guard ON quotation_package_versions;
CREATE TRIGGER quotation_package_sent_email_guard
BEFORE UPDATE OF status, sent_email_message_id ON quotation_package_versions
FOR EACH ROW EXECUTE FUNCTION bestcrm_validate_sent_quotation_email();

CREATE OR REPLACE FUNCTION protect_quotation_package_version()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Quotation package versions cannot be deleted';
  END IF;
  IF OLD.status IN ('sent', 'superseded', 'accepted') THEN
    IF NOT (
      OLD.status = 'sent'
      AND NEW.status IN ('superseded', 'accepted')
      AND NEW.opportunity_id IS NOT DISTINCT FROM OLD.opportunity_id
      AND NEW.source_package_id IS NOT DISTINCT FROM OLD.source_package_id
      AND NEW.draft_revision_no IS NOT DISTINCT FROM OLD.draft_revision_no
      AND NEW.version_no IS NOT DISTINCT FROM OLD.version_no
      AND NEW.technical_solution_version_id IS NOT DISTINCT FROM OLD.technical_solution_version_id
      AND NEW.commercial_quote_id IS NOT DISTINCT FROM OLD.commercial_quote_id
      AND NEW.currency IS NOT DISTINCT FROM OLD.currency
      AND NEW.total_price IS NOT DISTINCT FROM OLD.total_price
      AND NEW.delivery_period IS NOT DISTINCT FROM OLD.delivery_period
      AND NEW.payment_terms IS NOT DISTINCT FROM OLD.payment_terms
      AND NEW.valid_until IS NOT DISTINCT FROM OLD.valid_until
      AND NEW.commercial_line_items IS NOT DISTINCT FROM OLD.commercial_line_items
      AND NEW.inclusions IS NOT DISTINCT FROM OLD.inclusions
      AND NEW.exclusions IS NOT DISTINCT FROM OLD.exclusions
      AND NEW.technical_assumptions IS NOT DISTINCT FROM OLD.technical_assumptions
      AND NEW.revision_reason IS NOT DISTINCT FROM OLD.revision_reason
      AND NEW.change_summary IS NOT DISTINCT FROM OLD.change_summary
      AND NEW.created_by IS NOT DISTINCT FROM OLD.created_by
      AND NEW.created_at IS NOT DISTINCT FROM OLD.created_at
      AND NEW.submitted_by IS NOT DISTINCT FROM OLD.submitted_by
      AND NEW.submitted_at IS NOT DISTINCT FROM OLD.submitted_at
      AND NEW.reviewed_by IS NOT DISTINCT FROM OLD.reviewed_by
      AND NEW.reviewed_at IS NOT DISTINCT FROM OLD.reviewed_at
      AND NEW.review_comment IS NOT DISTINCT FROM OLD.review_comment
      AND NEW.sent_by IS NOT DISTINCT FROM OLD.sent_by
      AND NEW.sent_at IS NOT DISTINCT FROM OLD.sent_at
      AND NEW.sent_email_message_id IS NOT DISTINCT FROM OLD.sent_email_message_id
    ) THEN
      RAISE EXCEPTION 'Sent, superseded, and accepted quotation packages are immutable';
    END IF;
    IF OLD.status = 'sent' AND NEW.status = 'accepted'
        AND (NEW.superseded_at IS DISTINCT FROM OLD.superseded_at
          OR NEW.accepted_by IS NULL OR NEW.accepted_at IS NULL) THEN
      RAISE EXCEPTION 'Accepted quotation package transition metadata is invalid';
    END IF;
    IF OLD.status = 'sent' AND NEW.status = 'superseded'
        AND (NEW.accepted_by IS DISTINCT FROM OLD.accepted_by
          OR NEW.accepted_at IS DISTINCT FROM OLD.accepted_at
          OR NEW.superseded_at IS NULL) THEN
      RAISE EXCEPTION 'Superseded quotation package transition metadata is invalid';
    END IF;
    RETURN NEW;
  END IF;
  IF (OLD.status = 'draft' AND NEW.status NOT IN ('draft', 'pending'))
      OR (OLD.status = 'pending' AND NEW.status NOT IN ('approved', 'rejected'))
      OR (OLD.status = 'approved' AND NEW.status <> 'sent')
      OR OLD.status = 'rejected' THEN
    RAISE EXCEPTION 'Quotation package status transition is invalid';
  END IF;
  IF OLD.status <> 'draft' AND (
      NEW.opportunity_id IS DISTINCT FROM OLD.opportunity_id
      OR NEW.source_package_id IS DISTINCT FROM OLD.source_package_id
      OR NEW.draft_revision_no IS DISTINCT FROM OLD.draft_revision_no
      OR NEW.technical_solution_version_id IS DISTINCT FROM OLD.technical_solution_version_id
      OR NEW.commercial_quote_id IS DISTINCT FROM OLD.commercial_quote_id
      OR NEW.currency IS DISTINCT FROM OLD.currency
      OR NEW.total_price IS DISTINCT FROM OLD.total_price
      OR NEW.delivery_period IS DISTINCT FROM OLD.delivery_period
      OR NEW.payment_terms IS DISTINCT FROM OLD.payment_terms
      OR NEW.valid_until IS DISTINCT FROM OLD.valid_until
      OR NEW.commercial_line_items IS DISTINCT FROM OLD.commercial_line_items
      OR NEW.inclusions IS DISTINCT FROM OLD.inclusions
      OR NEW.exclusions IS DISTINCT FROM OLD.exclusions
      OR NEW.technical_assumptions IS DISTINCT FROM OLD.technical_assumptions
      OR NEW.revision_reason IS DISTINCT FROM OLD.revision_reason
      OR NEW.change_summary IS DISTINCT FROM OLD.change_summary
  ) THEN
    RAISE EXCEPTION 'Submitted quotation package content is immutable';
  END IF;
  RETURN NEW;
END;
$$;
