-- A quotation belongs to its opportunity customer. The attention contact is
-- selected only from that customer's active CRM contacts and snapshotted on
-- every draft revision so a later contact edit cannot silently rewrite it.
ALTER TABLE sales_commercial_quotation_drafts
  ADD COLUMN customer_contact_id bigint REFERENCES contacts(id) ON DELETE RESTRICT,
  ADD COLUMN customer_contact_name text NOT NULL DEFAULT '',
  ADD COLUMN customer_contact_phone text NOT NULL DEFAULT '',
  ADD COLUMN customer_contact_email text NOT NULL DEFAULT '',
  ADD CONSTRAINT sales_quotation_customer_contact_snapshot_check CHECK (
    (customer_contact_id IS NULL
      AND customer_contact_name = ''
      AND customer_contact_phone = ''
      AND customer_contact_email = '')
    OR (customer_contact_id IS NOT NULL
      AND btrim(customer_contact_name) <> ''
      AND length(customer_contact_name) <= 500
      AND length(customer_contact_phone) <= 200
      AND length(customer_contact_email) <= 320)
  );

ALTER TABLE sales_commercial_quotation_draft_events
  ADD COLUMN customer_contact_id bigint REFERENCES contacts(id) ON DELETE RESTRICT,
  ADD COLUMN customer_contact_name text NOT NULL DEFAULT '',
  ADD COLUMN customer_contact_phone text NOT NULL DEFAULT '',
  ADD COLUMN customer_contact_email text NOT NULL DEFAULT '';

CREATE OR REPLACE FUNCTION bestcrm_guard_sales_commercial_quotation_draft()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  file_record record;
  contact_record record;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Internal commercial quotation drafts cannot be deleted';
  END IF;
  IF TG_OP = 'UPDATE' AND (
      NEW.opportunity_id, NEW.language, NEW.created_by, NEW.created_at)
      IS DISTINCT FROM
      (OLD.opportunity_id, OLD.language, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'Internal commercial quotation draft identity is immutable';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW.draft_revision_no <> OLD.draft_revision_no + 1 THEN
    RAISE EXCEPTION 'Internal quotation draft revision must advance by one';
  END IF;
  SELECT draft.opportunity_id, draft.source_kind, draft.status, attachment.sha256,
    attachment.original_name, attachment.retired_at, opportunity.archived_at
    INTO file_record
    FROM opportunity_technical_draft_attachments link
    JOIN opportunity_technical_drafts draft ON draft.id = link.technical_draft_id
    JOIN attachments attachment ON attachment.id = link.attachment_id
    JOIN opportunities opportunity ON opportunity.id = draft.opportunity_id
    WHERE link.technical_draft_id = NEW.source_technical_draft_id
      AND link.attachment_id = NEW.source_attachment_id;
  IF NOT FOUND OR file_record.opportunity_id IS DISTINCT FROM NEW.opportunity_id
      OR file_record.source_kind IS DISTINCT FROM 'uploaded_file'
      OR file_record.status NOT IN ('ready', 'pending', 'approved')
      OR file_record.sha256 IS DISTINCT FROM NEW.source_sha256
      OR file_record.original_name IS DISTINCT FROM NEW.source_file_name
      OR file_record.retired_at IS NOT NULL
      OR file_record.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'The exact active uploaded technical file is required for an internal quotation draft';
  END IF;
  IF NEW.customer_contact_id IS NOT NULL THEN
    SELECT contact.id, contact.name, COALESCE(contact.phone, '') AS phone,
      COALESCE(contact.email, '') AS email INTO contact_record
    FROM opportunities opportunity
    JOIN contacts contact
      ON contact.customer_id = opportunity.customer_id
     AND contact.archived_at IS NULL
    WHERE opportunity.id = NEW.opportunity_id
      AND contact.id = NEW.customer_contact_id;
    IF NOT FOUND
        OR contact_record.name IS DISTINCT FROM NEW.customer_contact_name
        OR contact_record.phone IS DISTINCT FROM NEW.customer_contact_phone
        OR contact_record.email IS DISTINCT FROM NEW.customer_contact_email THEN
      RAISE EXCEPTION 'The quotation attention contact must be an active contact of the opportunity customer';
    END IF;
  ELSIF NEW.customer_contact_name <> ''
      OR NEW.customer_contact_phone <> ''
      OR NEW.customer_contact_email <> '' THEN
    RAISE EXCEPTION 'The quotation attention contact snapshot is invalid';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION bestcrm_log_sales_commercial_quotation_draft()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO sales_commercial_quotation_draft_events (
    draft_id, revision_no, actor_user_id, source_technical_draft_id,
    source_attachment_id, source_sha256, currency,
    seller_entity_code, seller_entity_name,
    customer_contact_id, customer_contact_name,
    customer_contact_phone, customer_contact_email,
    line_items, term_selections
  ) VALUES (
    NEW.id, NEW.draft_revision_no, NEW.updated_by, NEW.source_technical_draft_id,
    NEW.source_attachment_id, NEW.source_sha256, NEW.currency,
    NEW.seller_entity_code, NEW.seller_entity_name,
    NEW.customer_contact_id, NEW.customer_contact_name,
    NEW.customer_contact_phone, NEW.customer_contact_email,
    NEW.line_items, NEW.term_selections
  );
  RETURN NEW;
END;
$$;

-- Backfilling an existing draft is a real draft revision. Install the updated
-- guard and audit functions first, then advance the revision so the immutable
-- event history records the same contact snapshot as the current draft. Only
-- drafts whose technical source is still valid are eligible; archived/frozen
-- drafts retain the safe empty snapshot instead of bypassing the guard.
UPDATE sales_commercial_quotation_drafts draft
SET customer_contact_id = opportunity.primary_contact_id,
    customer_contact_name = contact.name,
    customer_contact_phone = COALESCE(contact.phone, ''),
    customer_contact_email = COALESCE(contact.email, ''),
    draft_revision_no = draft.draft_revision_no + 1
FROM opportunities opportunity
JOIN contacts contact
  ON contact.id = opportunity.primary_contact_id
 AND contact.customer_id = opportunity.customer_id
 AND contact.archived_at IS NULL
WHERE draft.opportunity_id = opportunity.id
  AND opportunity.archived_at IS NULL
  AND EXISTS (
    SELECT 1
    FROM opportunity_technical_draft_attachments link
    JOIN opportunity_technical_drafts technical_draft
      ON technical_draft.id = link.technical_draft_id
    JOIN attachments attachment
      ON attachment.id = link.attachment_id
    WHERE link.technical_draft_id = draft.source_technical_draft_id
      AND link.attachment_id = draft.source_attachment_id
      AND technical_draft.opportunity_id = draft.opportunity_id
      AND technical_draft.source_kind = 'uploaded_file'
      AND technical_draft.status IN ('ready', 'pending', 'approved')
      AND attachment.sha256 = draft.source_sha256
      AND attachment.original_name = draft.source_file_name
      AND attachment.retired_at IS NULL
  );
