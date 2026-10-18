-- AI Source is an intake workspace, not a parallel business Lead table.
CREATE TABLE IF NOT EXISTS ai_sources (
 id uuid PRIMARY KEY,
 source_system text NOT NULL DEFAULT 'sunkaier_ai' CHECK(source_system='sunkaier_ai'),
 client_id text NOT NULL CHECK(char_length(client_id) BETWEEN 1 AND 80),
 external_lead_id text NOT NULL CHECK(char_length(external_lead_id) BETWEEN 1 AND 160),
 channel text NOT NULL CHECK(channel IN ('ai_project_search','website_form','web_chat','phone_consultation','email_reference')),
 title text NOT NULL CHECK(char_length(title) BETWEEN 1 AND 240),
 payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),
 assigned_user_id bigint REFERENCES users(id) ON DELETE RESTRICT,
 retention text NOT NULL DEFAULT 'active' CHECK(retention IN ('active','archived','deleted')),
 lead_id bigint UNIQUE REFERENCES inquiries(id) ON DELETE RESTRICT,
 opportunity_id bigint REFERENCES opportunities(id) ON DELETE RESTRICT,
 received_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 last_event_at timestamptz NOT NULL,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 CHECK(lead_id IS NULL OR opportunity_id IS NULL),
 UNIQUE(client_id,external_lead_id)
);
CREATE INDEX IF NOT EXISTS ai_sources_queue_idx ON ai_sources(retention,assigned_user_id,received_at DESC,id);
CREATE INDEX IF NOT EXISTS ai_sources_channel_idx ON ai_sources(channel,received_at DESC,id);
CREATE TABLE IF NOT EXISTS ai_source_events (
 id uuid PRIMARY KEY,
 client_id text NOT NULL,
 external_event_id text NOT NULL CHECK(char_length(external_event_id) BETWEEN 1 AND 160),
 idempotency_key text NOT NULL CHECK(char_length(idempotency_key) BETWEEN 1 AND 160),
 payload_sha256 text NOT NULL CHECK(payload_sha256 ~ '^[a-f0-9]{64}$'),
 source_id uuid REFERENCES ai_sources(id) ON DELETE RESTRICT,
 kind text NOT NULL CHECK(kind IN ('submission','interaction','evidence')),
 occurred_at timestamptz NOT NULL,
 payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),
 receipt jsonb NOT NULL DEFAULT '{}'::jsonb,
 received_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(client_id,external_event_id), UNIQUE(client_id,idempotency_key)
);
CREATE INDEX IF NOT EXISTS ai_source_events_source_idx ON ai_source_events(source_id,received_at,id);
CREATE TABLE IF NOT EXISTS ai_source_nonces (
 key_id text NOT NULL, nonce text NOT NULL, expires_at timestamptz NOT NULL,
 PRIMARY KEY(key_id,nonce)
);
CREATE INDEX IF NOT EXISTS ai_source_nonces_expiry_idx ON ai_source_nonces(expires_at);
CREATE TABLE IF NOT EXISTS ai_source_audit (
 id bigserial PRIMARY KEY, source_id uuid REFERENCES ai_sources(id) ON DELETE RESTRICT,
 actor_user_id bigint REFERENCES users(id) ON DELETE RESTRICT,
 key_id text, action text NOT NULL, reason_code text NOT NULL DEFAULT '',
 details jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(details)='object'),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_source_audit_source_idx ON ai_source_audit(source_id,created_at DESC,id);
CREATE TABLE IF NOT EXISTS ai_source_match_candidates (
 id bigserial PRIMARY KEY, source_id uuid NOT NULL REFERENCES ai_sources(id) ON DELETE RESTRICT,
 target_kind text NOT NULL CHECK(target_kind IN ('lead','customer','opportunity')),
 target_id bigint NOT NULL, rule text NOT NULL, confidence text NOT NULL CHECK(confidence IN ('high','review')),
 conclusion text NOT NULL DEFAULT 'pending' CHECK(conclusion IN ('pending','confirmed','dismissed')),
 reviewed_by bigint REFERENCES users(id) ON DELETE RESTRICT, reviewed_at timestamptz,
 UNIQUE(source_id,target_kind,target_id,rule)
);
CREATE TABLE IF NOT EXISTS ai_source_evidence (
 id uuid PRIMARY KEY, source_id uuid NOT NULL REFERENCES ai_sources(id) ON DELETE RESTRICT,
 event_id uuid NOT NULL UNIQUE REFERENCES ai_source_events(id) ON DELETE RESTRICT,
 original_name text NOT NULL CHECK(char_length(original_name) BETWEEN 1 AND 180),
 mime_type text NOT NULL, file_size bigint NOT NULL CHECK(file_size>0 AND file_size<=26214400),
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 storage_key text NOT NULL UNIQUE CHECK(storage_key ~ '^[a-f0-9-]{36}\.[a-z0-9]+$'),
 scan_status text NOT NULL CHECK(scan_status='clean'),
 uploaded_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS ai_source_business_links (
 id bigserial PRIMARY KEY, source_id uuid NOT NULL REFERENCES ai_sources(id) ON DELETE RESTRICT,
 lead_id bigint REFERENCES inquiries(id) ON DELETE RESTRICT,
 opportunity_id bigint REFERENCES opportunities(id) ON DELETE RESTRICT,
 actor_user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((lead_id IS NULL)<>(opportunity_id IS NULL)), UNIQUE(source_id)
);
CREATE OR REPLACE FUNCTION bestcrm_ai_source_append_only() RETURNS trigger AS $$
BEGIN RAISE EXCEPTION 'AI source facts and audit cannot be changed'; END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS ai_source_audit_immutable ON ai_source_audit;
CREATE TRIGGER ai_source_audit_immutable BEFORE UPDATE OR DELETE ON ai_source_audit FOR EACH ROW EXECUTE FUNCTION bestcrm_ai_source_append_only();
DROP TRIGGER IF EXISTS ai_source_evidence_immutable ON ai_source_evidence;
CREATE TRIGGER ai_source_evidence_immutable BEFORE UPDATE OR DELETE ON ai_source_evidence FOR EACH ROW EXECUTE FUNCTION bestcrm_ai_source_append_only();
DROP TRIGGER IF EXISTS ai_source_links_immutable ON ai_source_business_links;
CREATE TRIGGER ai_source_links_immutable BEFORE UPDATE OR DELETE ON ai_source_business_links FOR EACH ROW EXECUTE FUNCTION bestcrm_ai_source_append_only();
CREATE OR REPLACE FUNCTION bestcrm_ai_source_original_guard() RETURNS trigger AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'AI sources must be logically deleted'; END IF;
 IF OLD.client_id IS DISTINCT FROM NEW.client_id OR OLD.external_lead_id IS DISTINCT FROM NEW.external_lead_id OR OLD.source_system IS DISTINCT FROM NEW.source_system OR OLD.channel IS DISTINCT FROM NEW.channel OR OLD.title IS DISTINCT FROM NEW.title OR OLD.payload IS DISTINCT FROM NEW.payload OR OLD.received_at IS DISTINCT FROM NEW.received_at THEN
  RAISE EXCEPTION 'AI source original facts are immutable';
 END IF;
 IF (OLD.lead_id IS NOT NULL OR OLD.opportunity_id IS NOT NULL) AND (OLD.lead_id IS DISTINCT FROM NEW.lead_id OR OLD.opportunity_id IS DISTINCT FROM NEW.opportunity_id) THEN RAISE EXCEPTION 'AI source business link cannot be overwritten'; END IF;
 RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS ai_source_original_guard ON ai_sources;
CREATE TRIGGER ai_source_original_guard BEFORE UPDATE OR DELETE ON ai_sources FOR EACH ROW EXECUTE FUNCTION bestcrm_ai_source_original_guard();
CREATE OR REPLACE FUNCTION bestcrm_ai_source_event_guard() RETURNS trigger AS $$
BEGIN
 IF TG_OP='DELETE' OR OLD.source_id IS NOT NULL THEN RAISE EXCEPTION 'AI source received events are immutable'; END IF;
 RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS ai_source_event_immutable ON ai_source_events;
CREATE TRIGGER ai_source_event_immutable BEFORE UPDATE OR DELETE ON ai_source_events FOR EACH ROW EXECUTE FUNCTION bestcrm_ai_source_event_guard();
