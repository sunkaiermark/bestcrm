-- A draft may select one of the two named seller entities. Their unconfirmed
-- phone, address and website details are deliberately not inferred here.
ALTER TABLE sales_commercial_quotation_drafts
  ADD COLUMN seller_entity_code text
    CHECK (seller_entity_code IN ('sunkaier_china', 'sunkaier_apac')),
  ADD COLUMN seller_entity_name text,
  ADD CONSTRAINT sales_quotation_seller_snapshot_check CHECK (
    (seller_entity_code IS NULL AND seller_entity_name IS NULL)
    OR (seller_entity_code = 'sunkaier_china'
      AND seller_entity_name IS NOT DISTINCT FROM '江苏胜开尔工业技术有限公司')
    OR (seller_entity_code = 'sunkaier_apac'
      AND seller_entity_name IS NOT DISTINCT FROM 'SUNKAIER ASIA PACIFIC PTE. LTD.')
  );

ALTER TABLE sales_commercial_quotation_draft_events
  ADD COLUMN seller_entity_code text
    CHECK (seller_entity_code IN ('sunkaier_china', 'sunkaier_apac')),
  ADD COLUMN seller_entity_name text;

CREATE OR REPLACE FUNCTION bestcrm_log_sales_commercial_quotation_draft()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO sales_commercial_quotation_draft_events (
    draft_id, revision_no, actor_user_id, source_technical_draft_id,
    source_attachment_id, source_sha256, currency,
    seller_entity_code, seller_entity_name, line_items
  ) VALUES (
    NEW.id, NEW.draft_revision_no, NEW.updated_by, NEW.source_technical_draft_id,
    NEW.source_attachment_id, NEW.source_sha256, NEW.currency,
    NEW.seller_entity_code, NEW.seller_entity_name, NEW.line_items
  );
  RETURN NEW;
END;
$$;
