-- Recording an approved use is separate from approving it. A binding is only
-- evidence-backed after CRM has archived a sent outbound MIME and attachment.
CREATE TABLE development_customer_file_uses (
  id bigserial PRIMARY KEY,
  decision_id bigint NOT NULL REFERENCES development_customer_use_decisions(id) ON DELETE RESTRICT,
  opportunity_id bigint NOT NULL REFERENCES opportunities(id) ON DELETE RESTRICT,
  technical_solution_document_id bigint REFERENCES technical_solution_documents(id) ON DELETE RESTRICT,
  quotation_package_document_id bigint REFERENCES quotation_package_documents(id) ON DELETE RESTRICT,
  quotation_package_version_id bigint REFERENCES quotation_package_versions(id) ON DELETE RESTRICT,
  email_message_id bigint NOT NULL REFERENCES email_messages(id) ON DELETE RESTRICT,
  email_attachment_id bigint NOT NULL REFERENCES email_attachments(id) ON DELETE RESTRICT,
  outbound_mime_artifact_id bigint NOT NULL REFERENCES email_outbound_mime_artifacts(id) ON DELETE RESTRICT,
  file_sha256 char(64) NOT NULL CHECK (file_sha256 ~ '^[0-9a-f]{64}$'),
  file_name text NOT NULL CHECK (btrim(file_name) <> ''),
  usage_location text NOT NULL CHECK (btrim(usage_location) <> '' AND char_length(usage_location) <= 1000),
  content_confirmed boolean NOT NULL CHECK (content_confirmed = true),
  recorded_by_user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  CHECK (num_nonnulls(technical_solution_document_id, quotation_package_document_id) = 1),
  CHECK (quotation_package_document_id IS NULL OR quotation_package_version_id IS NOT NULL),
  UNIQUE (decision_id, email_attachment_id)
);
CREATE INDEX development_customer_file_uses_opportunity_idx
  ON development_customer_file_uses (opportunity_id, recorded_at DESC, id DESC);
CREATE INDEX development_customer_file_uses_decision_idx
  ON development_customer_file_uses (decision_id, recorded_at DESC, id DESC);
CREATE TRIGGER development_customer_file_uses_no_change
  BEFORE UPDATE OR DELETE ON development_customer_file_uses
  FOR EACH ROW EXECUTE FUNCTION bestcrm_protect_development_history();

CREATE OR REPLACE FUNCTION bestcrm_guard_development_customer_file_use()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  approved record;
  delivered record;
  source_file record;
BEGIN
  SELECT decision.decision_code, decision.decided_at, request.asset_id,
    link.topic_id, link.opportunity_id, link.unlinked_at, revision.outcome_kind
    INTO approved
    FROM development_customer_use_decisions decision
    JOIN development_customer_use_requests request ON request.id = decision.request_id
    JOIN development_opportunity_links link ON link.id = request.opportunity_link_id
    JOIN development_assets asset ON asset.id = request.asset_id
    JOIN development_outcome_revisions revision ON revision.id = asset.outcome_revision_id
    WHERE decision.id = NEW.decision_id AND link.topic_id = revision.topic_id
    FOR UPDATE OF decision, link;
  IF NOT FOUND OR approved.decision_code <> 'approved'
      OR approved.opportunity_id IS DISTINCT FROM NEW.opportunity_id
      OR approved.unlinked_at IS NOT NULL OR approved.outcome_kind <> 'technical_result'
      OR EXISTS (SELECT 1 FROM development_customer_use_revocations
        WHERE decision_id = NEW.decision_id)
      OR EXISTS (SELECT 1 FROM development_asset_withdrawals
        WHERE asset_id = approved.asset_id) THEN
    RAISE EXCEPTION 'Effective approval for this opportunity and published result required';
  END IF;
  IF NOT bestcrm_development_active_member(NEW.recorded_by_user_id, approved.topic_id)
      OR NOT bestcrm_development_can_view_opportunity(
        NEW.recorded_by_user_id, approved.opportunity_id) THEN
    RAISE EXCEPTION 'Current topic and opportunity access required';
  END IF;

  SELECT message.id, message.quotation_package_version_id,
    attachment.id AS attachment_id, attachment.sha256, attachment.file_size,
    attachment.original_name, attachment.mime_type,
    attachment.source_technical_document_id,
    mime.id AS mime_id
    INTO delivered
    FROM email_messages message
    JOIN email_threads thread ON thread.id = message.thread_id
    JOIN email_attachments attachment ON attachment.message_id = message.id
    JOIN email_outbound_mime_artifacts mime ON mime.message_id = message.id
    WHERE message.id = NEW.email_message_id
      AND attachment.id = NEW.email_attachment_id
      AND mime.id = NEW.outbound_mime_artifact_id
      AND thread.opportunity_id = NEW.opportunity_id
      AND message.direction = 'outbound' AND message.delivery_status = 'sent'
      AND message.sent_at IS NOT NULL AND message.sent_at >= approved.decided_at;
  IF NOT FOUND OR delivered.quotation_package_version_id
      IS DISTINCT FROM NEW.quotation_package_version_id THEN
    RAISE EXCEPTION 'Sent CRM email and immutable outbound attachment evidence required';
  END IF;

  IF NEW.technical_solution_document_id IS NOT NULL THEN
    SELECT file.id, file.sha256, file.byte_size, file.original_name, file.mime_type,
      draft.opportunity_id
      INTO source_file
      FROM technical_solution_documents file
      JOIN opportunity_technical_drafts draft ON draft.id = file.technical_draft_id
      WHERE file.id = NEW.technical_solution_document_id
        AND draft.status = 'approved' AND draft.formal_version_no IS NOT NULL;
    IF NOT FOUND OR source_file.opportunity_id IS DISTINCT FROM NEW.opportunity_id THEN
      RAISE EXCEPTION 'Approved immutable technical file version required';
    END IF;
    IF NEW.quotation_package_version_id IS NULL THEN
      IF delivered.source_technical_document_id IS DISTINCT FROM source_file.id THEN
        RAISE EXCEPTION 'Outbound attachment must identify its exact technical file source';
      END IF;
    ELSIF NOT EXISTS (
      SELECT 1 FROM quotation_package_attachments snapshot
      JOIN quotation_package_versions package ON package.id = snapshot.quotation_package_id
      WHERE package.id = NEW.quotation_package_version_id
        AND package.opportunity_id = NEW.opportunity_id
        AND snapshot.technical_solution_document_id = source_file.id
        AND snapshot.sha256 = source_file.sha256
        AND snapshot.byte_size = source_file.byte_size
        AND snapshot.original_name = source_file.original_name
    ) THEN
      RAISE EXCEPTION 'Exact technical file is not in this formal quotation package';
    END IF;
  ELSE
    SELECT file.id, file.sha256, file.byte_size, file.original_name, file.mime_type,
      package.opportunity_id
      INTO source_file
      FROM quotation_package_documents file
      JOIN quotation_package_versions package
        ON package.id = file.quotation_package_version_id
      WHERE file.id = NEW.quotation_package_document_id
        AND package.id = NEW.quotation_package_version_id
        AND package.version_no IS NOT NULL
        AND file.document_type IN ('technical_docx', 'technical_pdf',
          'complete_docx', 'complete_pdf');
    IF NOT FOUND OR source_file.opportunity_id IS DISTINCT FROM NEW.opportunity_id THEN
      RAISE EXCEPTION 'Immutable customer-facing quotation file version required';
    END IF;
  END IF;

  IF delivered.sha256 IS DISTINCT FROM source_file.sha256
      OR delivered.file_size IS DISTINCT FROM source_file.byte_size
      OR delivered.original_name IS DISTINCT FROM source_file.original_name
      OR delivered.mime_type IS DISTINCT FROM source_file.mime_type
      OR NEW.file_sha256 IS DISTINCT FROM source_file.sha256
      OR NEW.file_name IS DISTINCT FROM source_file.original_name THEN
    RAISE EXCEPTION 'Archived attachment does not match the immutable customer file version';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER development_customer_file_uses_guard
  BEFORE INSERT ON development_customer_file_uses
  FOR EACH ROW EXECUTE FUNCTION bestcrm_guard_development_customer_file_use();

CREATE OR REPLACE FUNCTION bestcrm_protect_bound_customer_email_opportunity()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.opportunity_id IS DISTINCT FROM OLD.opportunity_id
      AND EXISTS (
        SELECT 1 FROM development_customer_file_uses use
        JOIN email_messages message ON message.id = use.email_message_id
        WHERE message.thread_id = OLD.id
      ) THEN
    RAISE EXCEPTION 'Bound customer email opportunity cannot be reassigned';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER email_threads_bound_customer_use_opportunity_guard
  BEFORE UPDATE OF opportunity_id ON email_threads
  FOR EACH ROW EXECUTE FUNCTION bestcrm_protect_bound_customer_email_opportunity();

CREATE OR REPLACE FUNCTION bestcrm_record_development_customer_file_use_event()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target_topic_id bigint;
BEGIN
  SELECT link.topic_id INTO target_topic_id
    FROM development_customer_use_decisions decision
    JOIN development_customer_use_requests request ON request.id = decision.request_id
    JOIN development_opportunity_links link ON link.id = request.opportunity_link_id
    WHERE decision.id = NEW.decision_id;
  INSERT INTO development_events (topic_id, event_type, actor_user_id, metadata)
  VALUES (target_topic_id, 'customer_file_use_recorded', NEW.recorded_by_user_id,
    jsonb_build_object('useId', NEW.id, 'decisionId', NEW.decision_id,
      'opportunityId', NEW.opportunity_id, 'emailMessageId', NEW.email_message_id,
      'emailAttachmentId', NEW.email_attachment_id, 'sha256', NEW.file_sha256));
  RETURN NEW;
END;
$$;
CREATE TRIGGER development_customer_file_uses_event
  AFTER INSERT ON development_customer_file_uses
  FOR EACH ROW EXECUTE FUNCTION bestcrm_record_development_customer_file_use_event();
