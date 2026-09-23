ALTER TABLE email_purge_file_jobs
  DROP CONSTRAINT IF EXISTS email_purge_file_jobs_file_kind_check,
  ADD CONSTRAINT email_purge_file_jobs_file_kind_check
    CHECK (file_kind IN ('attachment', 'raw_email', 'outbound_email'));

DROP TRIGGER IF EXISTS email_messages_protect_content ON email_messages;
CREATE TRIGGER email_messages_protect_content
BEFORE UPDATE ON email_messages
FOR EACH ROW
WHEN (current_setting('bestcrm.email_purge', true) IS DISTINCT FROM 'enabled')
EXECUTE FUNCTION bestcrm_protect_email_message_content();

DROP TRIGGER IF EXISTS quotation_package_sent_email_guard ON quotation_package_versions;
CREATE TRIGGER quotation_package_sent_email_guard
BEFORE UPDATE OF status, sent_email_message_id ON quotation_package_versions
FOR EACH ROW
WHEN (current_setting('bestcrm.email_purge', true) IS DISTINCT FROM 'enabled')
EXECUTE FUNCTION bestcrm_validate_sent_quotation_email();

DROP TRIGGER IF EXISTS quotation_package_immutable_guard ON quotation_package_versions;
CREATE TRIGGER quotation_package_immutable_guard
BEFORE UPDATE OR DELETE ON quotation_package_versions
FOR EACH ROW
WHEN (current_setting('bestcrm.email_purge', true) IS DISTINCT FROM 'enabled')
EXECUTE FUNCTION protect_quotation_package_version();

DROP TRIGGER IF EXISTS opportunity_activity_links_append_only_guard ON opportunity_activity_links;
CREATE TRIGGER opportunity_activity_links_append_only_guard
BEFORE UPDATE OR DELETE ON opportunity_activity_links
FOR EACH ROW
WHEN (current_setting('bestcrm.email_purge', true) IS DISTINCT FROM 'enabled')
EXECUTE FUNCTION bestcrm_reject_activity_spine_change();

DROP TRIGGER IF EXISTS email_outbound_mime_artifacts_no_change
  ON email_outbound_mime_artifacts;
CREATE TRIGGER email_outbound_mime_artifacts_no_change
BEFORE UPDATE OR DELETE ON email_outbound_mime_artifacts
FOR EACH ROW
WHEN (current_setting('bestcrm.email_purge', true) IS DISTINCT FROM 'enabled')
EXECUTE FUNCTION bestcrm_protect_email_outbound_mime_artifact();
