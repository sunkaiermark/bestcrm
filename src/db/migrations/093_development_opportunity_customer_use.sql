-- A topic/opportunity link is internal traceability only. Customer-facing use
-- is a separate decision about one published technical-result revision and one
-- stated purpose. Neither action grants access to the underlying research.
CREATE OR REPLACE FUNCTION bestcrm_development_can_view_opportunity(actor_id bigint, target_id bigint)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM opportunities o
    JOIN users actor ON actor.id = actor_id AND actor.is_active = true
    WHERE o.id = target_id AND o.deleted_at IS NULL AND (
      bestcrm_development_has_active_role(actor_id, 'administrator')
      OR actor_id IN (o.salesperson_id, o.sales_manager_id,
        o.quotation_engineer_id, o.technical_manager_id, o.commercial_manager_id)
      OR EXISTS (SELECT 1 FROM opportunity_members om
        WHERE om.opportunity_id = o.id AND om.user_id = actor_id AND om.is_active = true)
      OR EXISTS (SELECT 1 FROM contract_approvals ca
        JOIN contract_approval_steps step ON step.contract_approval_id = ca.id
        WHERE ca.opportunity_id = o.id AND step.reviewer_user_id = actor_id)
    )
  );
$$;

CREATE OR REPLACE FUNCTION bestcrm_development_active_member(actor_id bigint, target_topic_id bigint)
RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT EXISTS (SELECT 1 FROM development_memberships membership
    JOIN users actor ON actor.id = membership.user_id AND actor.is_active = true
    WHERE membership.topic_id = target_topic_id AND membership.user_id = actor_id
      AND membership.added_at <= now() AND membership.ended_at IS NULL);
$$;

CREATE OR REPLACE FUNCTION bestcrm_guard_development_business_link()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  topic_owner_id bigint;
BEGIN
  SELECT owner_user_id INTO topic_owner_id FROM development_topics
    WHERE id = NEW.topic_id FOR UPDATE;
  IF NOT FOUND OR NOT bestcrm_development_active_member(
      COALESCE(NEW.unlinked_by_user_id, NEW.linked_by_user_id), NEW.topic_id) THEN
    RAISE EXCEPTION 'Active topic membership required for opportunity link';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NOT bestcrm_development_can_view_opportunity(NEW.linked_by_user_id, NEW.opportunity_id) THEN
      RAISE EXCEPTION 'Opportunity access required for topic link';
    END IF;
  ELSIF NEW.unlinked_by_user_id <> topic_owner_id
      OR NOT bestcrm_development_can_view_opportunity(NEW.unlinked_by_user_id, NEW.opportunity_id) THEN
    RAISE EXCEPTION 'Only the active topic owner with opportunity access may unlink';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER development_opportunity_links_business_guard
  BEFORE INSERT OR UPDATE ON development_opportunity_links
  FOR EACH ROW EXECUTE FUNCTION bestcrm_guard_development_business_link();

CREATE TABLE development_customer_use_requests (
  id bigserial PRIMARY KEY,
  opportunity_link_id bigint NOT NULL REFERENCES development_opportunity_links(id) ON DELETE RESTRICT,
  asset_id bigint NOT NULL REFERENCES development_assets(id) ON DELETE RESTRICT,
  purpose text NOT NULL CHECK (btrim(purpose) <> '' AND char_length(purpose) <= 2000),
  requested_by_user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  requested_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX development_customer_use_requests_link_idx
  ON development_customer_use_requests (opportunity_link_id, requested_at DESC, id DESC);
CREATE TRIGGER development_customer_use_requests_no_change
  BEFORE UPDATE OR DELETE ON development_customer_use_requests
  FOR EACH ROW EXECUTE FUNCTION bestcrm_protect_development_history();

CREATE TABLE development_customer_use_decisions (
  id bigserial PRIMARY KEY,
  request_id bigint NOT NULL UNIQUE REFERENCES development_customer_use_requests(id) ON DELETE RESTRICT,
  decision_code text NOT NULL CHECK (decision_code IN ('approved', 'rejected')),
  reason text NOT NULL CHECK (btrim(reason) <> '' AND char_length(reason) <= 4000),
  decided_by_user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  decided_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER development_customer_use_decisions_no_change
  BEFORE UPDATE OR DELETE ON development_customer_use_decisions
  FOR EACH ROW EXECUTE FUNCTION bestcrm_protect_development_history();

CREATE TABLE development_customer_use_revocations (
  id bigserial PRIMARY KEY,
  decision_id bigint NOT NULL UNIQUE REFERENCES development_customer_use_decisions(id) ON DELETE RESTRICT,
  reason text NOT NULL CHECK (btrim(reason) <> '' AND char_length(reason) <= 4000),
  revoked_by_user_id bigint NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  revoked_at timestamptz NOT NULL DEFAULT now()
);
CREATE TRIGGER development_customer_use_revocations_no_change
  BEFORE UPDATE OR DELETE ON development_customer_use_revocations
  FOR EACH ROW EXECUTE FUNCTION bestcrm_protect_development_history();

CREATE OR REPLACE FUNCTION bestcrm_guard_development_customer_use()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target record;
  actor_id bigint;
BEGIN
  IF TG_TABLE_NAME = 'development_customer_use_requests' THEN
    SELECT link.topic_id, link.opportunity_id, asset.outcome_revision_id,
      revision.outcome_kind, link.unlinked_at, withdrawal.id AS withdrawal_id
      INTO target
      FROM development_opportunity_links link
      JOIN development_assets asset ON asset.id = NEW.asset_id
      JOIN development_outcome_revisions revision ON revision.id = asset.outcome_revision_id
      LEFT JOIN development_asset_withdrawals withdrawal ON withdrawal.asset_id = asset.id
      WHERE link.id = NEW.opportunity_link_id AND link.topic_id = revision.topic_id
      FOR SHARE OF link, asset, revision;
    actor_id := NEW.requested_by_user_id;
  ELSIF TG_TABLE_NAME = 'development_customer_use_decisions' THEN
    SELECT link.topic_id, link.opportunity_id, asset.outcome_revision_id,
      revision.outcome_kind, link.unlinked_at, withdrawal.id AS withdrawal_id
      INTO target
      FROM development_customer_use_requests request
      JOIN development_opportunity_links link ON link.id = request.opportunity_link_id
      JOIN development_assets asset ON asset.id = request.asset_id
      JOIN development_outcome_revisions revision ON revision.id = asset.outcome_revision_id
      LEFT JOIN development_asset_withdrawals withdrawal ON withdrawal.asset_id = asset.id
      WHERE request.id = NEW.request_id AND link.topic_id = revision.topic_id
      FOR SHARE OF link, asset, revision;
    actor_id := NEW.decided_by_user_id;
  ELSE
    SELECT link.topic_id, link.opportunity_id, asset.outcome_revision_id,
      revision.outcome_kind, link.unlinked_at, withdrawal.id AS withdrawal_id,
      decision.decision_code
      INTO target
      FROM development_customer_use_decisions decision
      JOIN development_customer_use_requests request ON request.id = decision.request_id
      JOIN development_opportunity_links link ON link.id = request.opportunity_link_id
      JOIN development_assets asset ON asset.id = request.asset_id
      JOIN development_outcome_revisions revision ON revision.id = asset.outcome_revision_id
      LEFT JOIN development_asset_withdrawals withdrawal ON withdrawal.asset_id = asset.id
      WHERE decision.id = NEW.decision_id AND link.topic_id = revision.topic_id
      FOR SHARE OF link, asset, revision;
    actor_id := NEW.revoked_by_user_id;
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'Exact customer-use target not found'; END IF;
  IF target.unlinked_at IS NOT NULL OR target.withdrawal_id IS NOT NULL
      OR target.outcome_kind <> 'technical_result' THEN
    RAISE EXCEPTION 'Active link and published technical result required';
  END IF;
  IF NOT bestcrm_development_active_member(actor_id, target.topic_id)
      OR NOT bestcrm_development_can_view_opportunity(actor_id, target.opportunity_id) THEN
    RAISE EXCEPTION 'Current topic and opportunity access required';
  END IF;
  IF TG_TABLE_NAME <> 'development_customer_use_requests' AND
      NOT bestcrm_development_has_active_role(actor_id, 'technical_manager') THEN
    RAISE EXCEPTION 'Active technical manager required for customer-use decision';
  END IF;
  IF TG_TABLE_NAME = 'development_customer_use_revocations' THEN
    IF target.decision_code <> 'approved' THEN
      RAISE EXCEPTION 'Only an approval may be revoked';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER development_customer_use_requests_guard
  BEFORE INSERT ON development_customer_use_requests
  FOR EACH ROW EXECUTE FUNCTION bestcrm_guard_development_customer_use();
CREATE TRIGGER development_customer_use_decisions_guard
  BEFORE INSERT ON development_customer_use_decisions
  FOR EACH ROW EXECUTE FUNCTION bestcrm_guard_development_customer_use();
CREATE TRIGGER development_customer_use_revocations_guard
  BEFORE INSERT ON development_customer_use_revocations
  FOR EACH ROW EXECUTE FUNCTION bestcrm_guard_development_customer_use();

CREATE OR REPLACE FUNCTION bestcrm_record_development_customer_use_event()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  target_topic_id bigint;
  actor_id bigint;
  event_name text;
  metadata jsonb;
BEGIN
  IF TG_TABLE_NAME = 'development_customer_use_requests' THEN
    SELECT topic_id INTO target_topic_id FROM development_opportunity_links
      WHERE id = NEW.opportunity_link_id;
    actor_id := NEW.requested_by_user_id;
    event_name := 'customer_use_requested';
    metadata := jsonb_build_object('requestId', NEW.id, 'assetId', NEW.asset_id,
      'opportunityLinkId', NEW.opportunity_link_id);
  ELSIF TG_TABLE_NAME = 'development_customer_use_decisions' THEN
    SELECT link.topic_id INTO target_topic_id
      FROM development_customer_use_requests request
      JOIN development_opportunity_links link ON link.id = request.opportunity_link_id
      WHERE request.id = NEW.request_id;
    actor_id := NEW.decided_by_user_id;
    event_name := 'customer_use_decided';
    metadata := jsonb_build_object('requestId', NEW.request_id,
      'decisionId', NEW.id, 'decisionCode', NEW.decision_code);
  ELSE
    SELECT link.topic_id INTO target_topic_id
      FROM development_customer_use_decisions decision
      JOIN development_customer_use_requests request ON request.id = decision.request_id
      JOIN development_opportunity_links link ON link.id = request.opportunity_link_id
      WHERE decision.id = NEW.decision_id;
    actor_id := NEW.revoked_by_user_id;
    event_name := 'customer_use_revoked';
    metadata := jsonb_build_object('decisionId', NEW.decision_id,
      'revocationId', NEW.id);
  END IF;
  INSERT INTO development_events (topic_id, event_type, actor_user_id, metadata)
  VALUES (target_topic_id, event_name, actor_id, metadata);
  RETURN NEW;
END;
$$;
CREATE TRIGGER development_customer_use_requests_event
  AFTER INSERT ON development_customer_use_requests
  FOR EACH ROW EXECUTE FUNCTION bestcrm_record_development_customer_use_event();
CREATE TRIGGER development_customer_use_decisions_event
  AFTER INSERT ON development_customer_use_decisions
  FOR EACH ROW EXECUTE FUNCTION bestcrm_record_development_customer_use_event();
CREATE TRIGGER development_customer_use_revocations_event
  AFTER INSERT ON development_customer_use_revocations
  FOR EACH ROW EXECUTE FUNCTION bestcrm_record_development_customer_use_event();
