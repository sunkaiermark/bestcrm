CREATE TABLE IF NOT EXISTS email_outbound_mime_artifacts (
  id bigserial PRIMARY KEY,
  message_id bigint NOT NULL UNIQUE REFERENCES email_messages(id) ON DELETE RESTRICT,
  stored_path text NOT NULL UNIQUE CHECK (
    btrim(stored_path) <> ''
    AND stored_path LIKE 'email-outbound/%'
    AND stored_path NOT LIKE '%..%'
  ),
  file_size bigint NOT NULL CHECK (file_size > 0),
  sha256 char(64) NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  rfc_message_id text NOT NULL CHECK (btrim(rfc_message_id) <> ''),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_outbound_mime_artifacts_sha256_idx
  ON email_outbound_mime_artifacts(sha256, id);

CREATE OR REPLACE FUNCTION bestcrm_validate_email_outbound_mime_artifact()
RETURNS trigger AS $$
DECLARE
  canonical_direction text;
  canonical_message_id text;
BEGIN
  SELECT direction, message_id
  INTO canonical_direction, canonical_message_id
  FROM email_messages
  WHERE id = NEW.message_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Canonical email message does not exist';
  END IF;
  IF canonical_direction <> 'outbound' THEN
    RAISE EXCEPTION 'Only outbound messages can own generated MIME artifacts';
  END IF;
  IF btrim(NEW.rfc_message_id) IS DISTINCT FROM btrim(canonical_message_id) THEN
    RAISE EXCEPTION 'Outbound MIME Message-ID must match the canonical message';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS email_outbound_mime_artifacts_validate
  ON email_outbound_mime_artifacts;
CREATE TRIGGER email_outbound_mime_artifacts_validate
BEFORE INSERT ON email_outbound_mime_artifacts
FOR EACH ROW EXECUTE FUNCTION bestcrm_validate_email_outbound_mime_artifact();

CREATE OR REPLACE FUNCTION bestcrm_protect_email_outbound_mime_artifact()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Outbound MIME artifacts are immutable';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS email_outbound_mime_artifacts_no_change
  ON email_outbound_mime_artifacts;
CREATE TRIGGER email_outbound_mime_artifacts_no_change
BEFORE UPDATE OR DELETE ON email_outbound_mime_artifacts
FOR EACH ROW EXECUTE FUNCTION bestcrm_protect_email_outbound_mime_artifact();
