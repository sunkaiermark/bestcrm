-- Tax rate is frozen with every mutable draft revision. Monetary totals remain
-- derived from line items plus this rate so there is no second editable total.
ALTER TABLE sales_commercial_quotation_drafts
  ADD COLUMN tax_rate numeric(5,2) NOT NULL DEFAULT 0
    CHECK (tax_rate >= 0 AND tax_rate <= 100);

ALTER TABLE sales_commercial_quotation_draft_events
  ADD COLUMN tax_rate numeric(5,2) NOT NULL DEFAULT 0
    CHECK (tax_rate >= 0 AND tax_rate <= 100);

CREATE OR REPLACE FUNCTION bestcrm_log_sales_commercial_quotation_draft()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO sales_commercial_quotation_draft_events (
    draft_id, revision_no, actor_user_id, source_technical_draft_id,
    source_attachment_id, source_sha256, currency, tax_rate,
    seller_entity_code, seller_entity_name,
    customer_contact_id, customer_contact_name,
    customer_contact_phone, customer_contact_email,
    line_items, term_selections
  ) VALUES (
    NEW.id, NEW.draft_revision_no, NEW.updated_by, NEW.source_technical_draft_id,
    NEW.source_attachment_id, NEW.source_sha256, NEW.currency, NEW.tax_rate,
    NEW.seller_entity_code, NEW.seller_entity_name,
    NEW.customer_contact_id, NEW.customer_contact_name,
    NEW.customer_contact_phone, NEW.customer_contact_email,
    NEW.line_items, NEW.term_selections
  );
  RETURN NEW;
END;
$$;
