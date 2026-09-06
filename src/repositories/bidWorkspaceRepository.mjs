import { bidOutputProfileRevisionLabel } from '../domain/bidWorkspace.mjs';
import { opportunityTechnicalDraftLabel } from '../domain/technicalTemplates.mjs';

function numberOrNull(value) {
  return value === null || value === undefined ? null : Number(value);
}

function jsonValue(value, fallback) {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return fallback; }
  }
  return value;
}

function mapOutputProfileRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    profileCode: row.profile_code,
    revisionNo: Number(row.revision_no),
    revisionLabel: bidOutputProfileRevisionLabel(row.profile_code, row.revision_no),
    nameEn: row.name_en,
    nameZh: row.name_zh,
    languageMode: row.language_mode,
    status: row.status,
    layoutSettings: jsonValue(row.layout_settings, {}),
    brandAssets: jsonValue(row.brand_assets, {}),
    changeSummary: row.change_summary,
    publishedAt: row.published_at
  };
}

function mapWorkspaceRow(row) {
  if (!row) return null;
  const technicalDraftRevisionNo = numberOrNull(row.technical_draft_revision_no);
  const commercialDraftRevisionNo = numberOrNull(row.commercial_draft_revision_no);
  return {
    id: Number(row.id),
    opportunityId: Number(row.opportunity_id),
    status: row.status,
    language: row.language,
    technicalTemplateRevisionId: Number(row.technical_template_revision_id),
    commercialTemplateRevisionId: Number(row.commercial_template_revision_id),
    outputProfileId: Number(row.output_profile_id),
    sourceMetadata: jsonValue(row.source_metadata, {}),
    opportunity: {
      id: Number(row.opportunity_id),
      opportunityNo: row.opportunity_no,
      title: row.opportunity_title,
      customerId: Number(row.customer_id),
      customerName: row.customer_name || '',
      primaryContactId: numberOrNull(row.primary_contact_id),
      primaryContactCode: row.primary_contact_code || '',
      primaryContactName: row.primary_contact_name || '',
      requirement: row.requirement || '',
      estimatedAmount: numberOrNull(row.estimated_amount),
      productInterest: row.product_interest || '',
      projectType: row.project_type || '',
      deliveryCycle: row.delivery_cycle || '',
      expectedBidDate: row.expected_bid_date,
      salespersonId: Number(row.salesperson_id),
      salesManagerId: numberOrNull(row.sales_manager_id),
      quotationEngineerId: numberOrNull(row.quotation_engineer_id),
      technicalManagerId: numberOrNull(row.technical_manager_id),
      commercialManagerId: numberOrNull(row.commercial_manager_id)
    },
    technicalTemplate: {
      id: Number(row.technical_template_id),
      templateCode: row.technical_template_code,
      name: row.technical_template_name,
      revisionNo: Number(row.technical_template_revision_no)
    },
    commercialTemplate: {
      id: Number(row.commercial_template_id),
      templateCode: row.commercial_template_code,
      nameEn: row.commercial_template_name_en,
      nameZh: row.commercial_template_name_zh,
      revisionNo: Number(row.commercial_template_revision_no)
    },
    outputProfile: {
      id: Number(row.output_profile_id),
      profileCode: row.output_profile_code,
      revisionNo: Number(row.output_profile_revision_no),
      revisionLabel: bidOutputProfileRevisionLabel(row.output_profile_code, row.output_profile_revision_no),
      nameEn: row.output_profile_name_en,
      nameZh: row.output_profile_name_zh,
      languageMode: row.output_profile_language_mode
    },
    technicalDraft: row.technical_draft_id ? {
      id: Number(row.technical_draft_id),
      draftRevisionNo: technicalDraftRevisionNo,
      draftLabel: opportunityTechnicalDraftLabel(technicalDraftRevisionNo),
      status: row.technical_draft_status,
      validationIssueCount: Number(row.technical_validation_issue_count || 0)
    } : null,
    commercialDraft: row.commercial_draft_id ? {
      id: Number(row.commercial_draft_id),
      draftRevisionNo: commercialDraftRevisionNo,
      draftLabel: `CP-D${commercialDraftRevisionNo}`,
      status: row.commercial_draft_status,
      validationIssueCount: Number(row.commercial_validation_issue_count || 0),
      sourceMetadata: jsonValue(row.commercial_draft_source_metadata, {})
    } : null,
    createdBy: Number(row.created_by),
    createdByDisplayName: row.created_by_display_name || '',
    updatedBy: Number(row.updated_by),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapContentSnapshotRow(row) {
  const sourceMetadata = jsonValue(row.source_metadata, {});
  const contentSchema = jsonValue(row.content_schema, {});
  return {
    blockId: Number(row.block_id),
    blockCode: row.block_code,
    category: row.category,
    ownerRoleCode: row.owner_role_code,
    nameEn: row.name_en,
    nameZh: row.name_zh,
    applicableCountries: jsonValue(row.applicable_countries, []),
    applicableIndustries: jsonValue(row.applicable_industries, []),
    applicableProductFamilies: jsonValue(row.applicable_product_families, []),
    applicableCustomerTypes: jsonValue(row.applicable_customer_types, []),
    applicableSections: jsonValue(row.applicable_sections, []),
    revisionId: Number(row.revision_id),
    revisionNo: Number(row.revision_no),
    revisionLabel: `${row.block_code}-R${Number(row.revision_no)}`,
    language: row.language,
    componentType: row.component_type,
    titleEn: row.title_en || '',
    titleZh: row.title_zh || '',
    contentSchema,
    conditionSchema: jsonValue(row.condition_schema, { all: [] }),
    allowedVariables: jsonValue(row.allowed_variables, []),
    sourceMetadata,
    libraryType: sourceMetadata.libraryType || '',
    attachmentStoredPath: row.attachment_stored_path || '',
    attachmentOriginalName: row.attachment_original_name || '',
    attachmentMimeType: row.attachment_mime_type || '',
    attachmentByteSize: numberOrNull(row.attachment_byte_size),
    attachmentSha256: row.attachment_sha256 || '',
    effectiveDate: row.effective_date,
    expiresAt: row.expires_at,
    reviewDueAt: row.review_due_at,
    sensitivity: row.sensitivity,
    publishedAt: row.published_at
  };
}

const visibilityPredicate = (userParam) => `(
  opportunity.salesperson_id = ${userParam}
  OR opportunity.sales_manager_id = ${userParam}
  OR opportunity.quotation_engineer_id = ${userParam}
  OR opportunity.technical_manager_id = ${userParam}
  OR opportunity.commercial_manager_id = ${userParam}
  OR EXISTS (
    SELECT 1 FROM opportunity_members member
    WHERE member.opportunity_id = opportunity.id
      AND member.user_id = ${userParam}
      AND member.is_active = true
  )
  OR EXISTS (
    SELECT 1
    FROM contract_approvals approval
    JOIN contract_approval_steps step ON step.contract_approval_id = approval.id
    WHERE approval.opportunity_id = opportunity.id
      AND step.reviewer_user_id = ${userParam}
  )
)`;

const workspaceSelect = `
  SELECT
    workspace.*,
    opportunity.opportunity_no,
    opportunity.title AS opportunity_title,
    opportunity.customer_id,
    customer.name AS customer_name,
    opportunity.primary_contact_id,
    contact.contact_code AS primary_contact_code,
    contact.name AS primary_contact_name,
    opportunity.requirement,
    opportunity.estimated_amount,
    opportunity.product_interest,
    opportunity.project_type,
    opportunity.delivery_cycle,
    opportunity.expected_bid_date,
    opportunity.salesperson_id,
    opportunity.sales_manager_id,
    opportunity.quotation_engineer_id,
    opportunity.technical_manager_id,
    opportunity.commercial_manager_id,
    technical_template.id AS technical_template_id,
    technical_template.template_code AS technical_template_code,
    technical_template.name AS technical_template_name,
    technical_revision.revision_no AS technical_template_revision_no,
    commercial_template.id AS commercial_template_id,
    commercial_template.template_code AS commercial_template_code,
    commercial_template.name_en AS commercial_template_name_en,
    commercial_template.name_zh AS commercial_template_name_zh,
    commercial_revision.revision_no AS commercial_template_revision_no,
    output_profile.profile_code AS output_profile_code,
    output_profile.revision_no AS output_profile_revision_no,
    output_profile.name_en AS output_profile_name_en,
    output_profile.name_zh AS output_profile_name_zh,
    output_profile.language_mode AS output_profile_language_mode,
    technical_draft.id AS technical_draft_id,
    technical_draft.draft_revision_no AS technical_draft_revision_no,
    technical_draft.status AS technical_draft_status,
    jsonb_array_length(technical_draft.validation_issues) AS technical_validation_issue_count,
    commercial_draft.id AS commercial_draft_id,
    commercial_draft.draft_revision_no AS commercial_draft_revision_no,
    commercial_draft.status AS commercial_draft_status,
    jsonb_array_length(commercial_draft.validation_issues) AS commercial_validation_issue_count,
    commercial_draft.source_metadata AS commercial_draft_source_metadata,
    creator.display_name AS created_by_display_name
  FROM opportunity_bid_workspaces workspace
  JOIN opportunities opportunity ON opportunity.id = workspace.opportunity_id
  JOIN customers customer ON customer.id = opportunity.customer_id
  LEFT JOIN contacts contact ON contact.id = opportunity.primary_contact_id
  JOIN technical_agreement_template_revisions technical_revision
    ON technical_revision.id = workspace.technical_template_revision_id
  JOIN technical_agreement_templates technical_template
    ON technical_template.id = technical_revision.template_id
  JOIN commercial_package_template_revisions commercial_revision
    ON commercial_revision.id = workspace.commercial_template_revision_id
  JOIN commercial_package_templates commercial_template
    ON commercial_template.id = commercial_revision.template_id
  JOIN bid_output_profiles output_profile ON output_profile.id = workspace.output_profile_id
  JOIN users creator ON creator.id = workspace.created_by
  LEFT JOIN LATERAL (
    SELECT draft.*
    FROM opportunity_technical_drafts draft
    WHERE draft.opportunity_id = workspace.opportunity_id
    ORDER BY draft.draft_revision_no DESC, draft.id DESC
    LIMIT 1
  ) technical_draft ON true
  LEFT JOIN LATERAL (
    SELECT draft.*
    FROM opportunity_commercial_drafts draft
    WHERE draft.workspace_id = workspace.id
    ORDER BY draft.draft_revision_no DESC, draft.id DESC
    LIMIT 1
  ) commercial_draft ON true
`;

export function createBidWorkspaceRepository(queryTarget) {
  return {
    async listPublishedOutputProfiles() {
      const result = await queryTarget.query(`
        SELECT * FROM bid_output_profiles
        WHERE status = 'published'
        ORDER BY profile_code ASC, revision_no DESC
      `);
      return result.rows.map(mapOutputProfileRow);
    },

    async findPublishedOutputProfile(id) {
      const result = await queryTarget.query(`
        SELECT * FROM bid_output_profiles
        WHERE id = $1 AND status = 'published'
        LIMIT 1
      `, [id]);
      return mapOutputProfileRow(result.rows[0]);
    },

    async listWorkspaces({ visibleToUserId = null } = {}) {
      const params = [];
      let where = '';
      if (visibleToUserId) {
        params.push(visibleToUserId);
        where = `WHERE ${visibilityPredicate('$1')}`;
      }
      const result = await queryTarget.query(`
        ${workspaceSelect}
        ${where}
        ORDER BY workspace.updated_at DESC, workspace.id DESC
      `, params);
      return result.rows.map(mapWorkspaceRow);
    },

    async getWorkspaceDetail(id, { visibleToUserId = null } = {}) {
      const params = [id];
      let visibility = '';
      if (visibleToUserId) {
        params.push(visibleToUserId);
        visibility = `AND ${visibilityPredicate('$2')}`;
      }
      const result = await queryTarget.query(`
        ${workspaceSelect}
        WHERE workspace.id = $1 ${visibility}
        LIMIT 1
      `, params);
      return mapWorkspaceRow(result.rows[0]);
    },

    async findByOpportunity(opportunityId) {
      const result = await queryTarget.query(`
        ${workspaceSelect}
        WHERE workspace.opportunity_id = $1
        LIMIT 1
      `, [opportunityId]);
      return mapWorkspaceRow(result.rows[0]);
    },

    async getGenerationContext(opportunityId) {
      const result = await queryTarget.query(`
        SELECT
          opportunity.id AS opportunity_id,
          opportunity.opportunity_no,
          opportunity.title AS opportunity_title,
          opportunity.requirement AS requirement_summary,
          opportunity.estimated_amount,
          opportunity.product_interest AS product_name,
          opportunity.project_type,
          opportunity.delivery_cycle,
          opportunity.expected_bid_date,
          customer.id AS customer_id,
          customer.name AS customer_name,
          customer.address AS customer_address,
          customer.country AS customer_country,
          customer.region AS customer_region,
          customer.industry AS customer_industry,
          customer.website AS customer_website,
          contact.id AS contact_id,
          contact.name AS contact_name,
          contact.title AS contact_title,
          contact.email AS contact_email,
          contact.phone AS contact_phone,
          salesperson.display_name AS opportunity_owner,
          technical_manager.display_name AS technical_manager,
          commercial_manager.display_name AS commercial_manager,
          approved_quote.id AS quote_id,
          approved_quote.version_no AS quote_version_no,
          approved_quote.total_price,
          approved_quote.payment_terms,
          approved_quote.validity_date,
          approved_quote.remarks AS quote_remarks,
          approved_quote.items AS quote_items
        FROM opportunities opportunity
        JOIN customers customer ON customer.id = opportunity.customer_id
        LEFT JOIN contacts contact ON contact.id = opportunity.primary_contact_id
        JOIN users salesperson ON salesperson.id = opportunity.salesperson_id
        LEFT JOIN users technical_manager ON technical_manager.id = opportunity.technical_manager_id
        LEFT JOIN users commercial_manager ON commercial_manager.id = opportunity.commercial_manager_id
        LEFT JOIN LATERAL (
          SELECT quote.*,
            COALESCE((
              SELECT jsonb_agg(jsonb_build_object(
                'id', item.id,
                'itemName', item.item_name,
                'specification', item.specification,
                'unit', item.unit,
                'quantity', item.quantity,
                'unitPrice', item.unit_price,
                'subtotal', item.subtotal
              ) ORDER BY item.id)
              FROM quote_items item
              WHERE item.quote_id = quote.id
            ), '[]'::jsonb) AS items
          FROM commercial_quotes quote
          WHERE quote.opportunity_id = opportunity.id
            AND quote.status = 'approved'
          ORDER BY quote.version_no DESC, quote.id DESC
          LIMIT 1
        ) approved_quote ON true
        WHERE opportunity.id = $1
        LIMIT 1
      `, [opportunityId]);
      const row = result.rows[0];
      if (!row) return null;
      return {
        opportunityId: Number(row.opportunity_id),
        opportunityNo: row.opportunity_no,
        opportunityTitle: row.opportunity_title || '',
        requirementSummary: row.requirement_summary || '',
        estimatedAmount: numberOrNull(row.estimated_amount),
        productName: row.product_name || '',
        projectType: row.project_type || '',
        deliveryCycle: row.delivery_cycle || '',
        expectedBidDate: row.expected_bid_date,
        customerId: Number(row.customer_id),
        customerName: row.customer_name || '',
        customerAddress: row.customer_address || '',
        customerCountry: row.customer_country || '',
        customerRegion: row.customer_region || '',
        customerIndustry: row.customer_industry || '',
        customerWebsite: row.customer_website || '',
        contactId: numberOrNull(row.contact_id),
        contactName: row.contact_name || '',
        contactTitle: row.contact_title || '',
        contactEmail: row.contact_email || '',
        contactPhone: row.contact_phone || '',
        deliveryDestination: row.customer_address || row.customer_country || row.customer_region || '',
        opportunityOwner: row.opportunity_owner || '',
        technicalManager: row.technical_manager || '',
        commercialManager: row.commercial_manager || '',
        quoteId: numberOrNull(row.quote_id),
        quoteVersionNo: numberOrNull(row.quote_version_no),
        quotationNumber: row.quote_id ? `Q${Number(row.quote_id)}-V${Number(row.quote_version_no)}` : '',
        totalPrice: numberOrNull(row.total_price),
        paymentTerms: row.payment_terms || '',
        quotationValidity: row.validity_date,
        quoteRemarks: row.quote_remarks || '',
        quoteItems: jsonValue(row.quote_items, [])
      };
    },

    async listCurrentPublishedContentSnapshots(ids) {
      const normalizedIds = [...new Set((ids || []).map(Number).filter((id) => Number.isInteger(id) && id > 0))];
      if (!normalizedIds.length) return [];
      const result = await queryTarget.query(`
        SELECT
          block.id AS block_id,
          block.block_code,
          block.category,
          block.owner_role_code,
          block.name_en,
          block.name_zh,
          block.applicable_countries,
          block.applicable_industries,
          block.applicable_product_families,
          block.applicable_customer_types,
          block.applicable_sections,
          revision.id AS revision_id,
          revision.revision_no,
          revision.language,
          revision.component_type,
          revision.title_en,
          revision.title_zh,
          revision.content_schema,
          revision.condition_schema,
          revision.allowed_variables,
          revision.source_metadata,
          revision.attachment_stored_path,
          revision.attachment_original_name,
          revision.attachment_mime_type,
          revision.attachment_byte_size,
          revision.attachment_sha256,
          revision.effective_date,
          revision.expires_at,
          revision.review_due_at,
          revision.sensitivity,
          revision.published_at
        FROM bid_content_blocks block
        JOIN bid_content_block_revisions revision
          ON revision.id = block.current_published_revision_id
        WHERE block.id = ANY($1::bigint[])
          AND block.is_active = true
          AND revision.status = 'published'
        ORDER BY block.id ASC
      `, [normalizedIds]);
      return result.rows.map(mapContentSnapshotRow);
    },

    async createWorkspace(input) {
      const result = await queryTarget.query(`
        WITH opportunity_lock AS (
          SELECT pg_advisory_xact_lock($1::bigint)
        ), inserted AS (
          INSERT INTO opportunity_bid_workspaces (
            opportunity_id, status, language, technical_template_revision_id,
            commercial_template_revision_id, output_profile_id, source_metadata,
            created_by, updated_by
          )
          SELECT $1, 'in_progress', $2, $3, $4, $5, $6::jsonb, $7, $7
          FROM opportunity_lock
          ON CONFLICT (opportunity_id) DO NOTHING
          RETURNING id
        )
        SELECT id FROM inserted
      `, [
        input.opportunityId,
        input.language,
        input.technicalTemplateRevisionId,
        input.commercialTemplateRevisionId,
        input.outputProfileId,
        JSON.stringify(input.sourceMetadata),
        input.actorUserId
      ]);
      return result.rows[0] ? { id: Number(result.rows[0].id) } : null;
    }
  };
}
