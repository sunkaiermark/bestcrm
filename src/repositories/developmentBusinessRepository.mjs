import { DevelopmentConceptError } from '../domain/developmentConcepts.mjs';

function fail(message, statusCode = 409) {
  throw new DevelopmentConceptError(message, statusCode);
}

async function transaction(pool, action) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await action(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === 'P0001') fail(error.message);
    throw error;
  } finally {
    client.release();
  }
}

async function memberTopic(client, topicId, actorUserId, lock = false) {
  const result = await client.query(`
    SELECT topic.id, topic.topic_no, topic.title, topic.owner_user_id
    FROM development_topics topic
    WHERE topic.id = $1 AND bestcrm_development_active_member($2, topic.id)
    ${lock ? 'FOR UPDATE OF topic' : ''}
  `, [topicId, actorUserId]);
  if (!result.rowCount) fail('Development topic not found', 404);
  return result.rows[0];
}

function mapLink(row) {
  return {
    id: Number(row.id), topicId: Number(row.topic_id),
    opportunityId: Number(row.opportunity_id),
    opportunityNo: row.opportunity_no, opportunityTitle: row.opportunity_title,
    reason: row.link_reason, linkedAt: row.linked_at,
    linkedByUserId: Number(row.linked_by_user_id),
    unlinkedAt: row.unlinked_at || null
  };
}

function mapRequest(row) {
  return {
    id: Number(row.id), linkId: Number(row.opportunity_link_id),
    opportunityId: Number(row.opportunity_id),
    assetId: Number(row.asset_id), outcomeRevisionId: Number(row.outcome_revision_id),
    revisionNo: Number(row.revision_no), outcomeTitle: row.outcome_title,
    purpose: row.purpose, requestedByUserId: Number(row.requested_by_user_id),
    requestedAt: row.requested_at, decision: row.decision_id ? {
      id: Number(row.decision_id), decisionCode: row.decision_code,
      reason: row.decision_reason, decidedByUserId: Number(row.decided_by_user_id),
      decidedAt: row.decided_at, revokedAt: row.revoked_at || null,
      revocationReason: row.revocation_reason || null
    } : null,
    effective: row.decision_code === 'approved' && !row.revoked_at
      && !row.withdrawn_at && !row.unlinked_at,
    fileUses: []
  };
}

function mapFileUse(row) {
  return {
    id: Number(row.id), decisionId: Number(row.decision_id),
    opportunityId: Number(row.opportunity_id),
    fileKind: row.technical_solution_document_id ? 'technical_solution' : 'quotation_package',
    fileId: Number(row.technical_solution_document_id || row.quotation_package_document_id),
    quotationPackageVersionId: row.quotation_package_version_id
      ? Number(row.quotation_package_version_id) : null,
    emailMessageId: Number(row.email_message_id),
    emailAttachmentId: Number(row.email_attachment_id),
    sha256: row.file_sha256, fileName: row.file_name,
    usageLocation: row.usage_location, recordedAt: row.recorded_at,
    sentAt: row.sent_at, versionLabel: row.version_label,
    emailThreadId: Number(row.email_thread_id)
  };
}

async function visibleLink(client, linkId, topicId, actorUserId) {
  const result = await client.query(`
    SELECT link.*, opportunity.opportunity_no, opportunity.title AS opportunity_title
    FROM development_opportunity_links link
    JOIN opportunities opportunity ON opportunity.id = link.opportunity_id
      AND opportunity.deleted_at IS NULL
    WHERE link.id = $1 AND link.topic_id = $2 AND link.unlinked_at IS NULL
      AND bestcrm_development_active_member($3, link.topic_id)
      AND bestcrm_development_can_view_opportunity($3, link.opportunity_id)
  `, [linkId, topicId, actorUserId]);
  if (!result.rowCount) fail('Opportunity link not found', 404);
  return result.rows[0];
}

async function visibleRequest(client, requestId, topicId, actorUserId) {
  const result = await client.query(`
    SELECT request.*, link.topic_id, link.opportunity_id, link.unlinked_at,
      asset.outcome_revision_id, withdrawal.id AS withdrawal_id,
      decision.id AS decision_id, decision.decision_code,
      revocation.id AS revocation_id
    FROM development_customer_use_requests request
    JOIN development_opportunity_links link ON link.id = request.opportunity_link_id
    JOIN development_assets asset ON asset.id = request.asset_id
    LEFT JOIN development_asset_withdrawals withdrawal ON withdrawal.asset_id = asset.id
    LEFT JOIN development_customer_use_decisions decision ON decision.request_id = request.id
    LEFT JOIN development_customer_use_revocations revocation ON revocation.decision_id = decision.id
    WHERE request.id = $1 AND link.topic_id = $2
      AND bestcrm_development_active_member($3, link.topic_id)
      AND bestcrm_development_can_view_opportunity($3, link.opportunity_id)
  `, [requestId, topicId, actorUserId]);
  if (!result.rowCount) fail('Customer-use request not found', 404);
  return result.rows[0];
}

export function createDevelopmentBusinessRepository(pool) {
  return {
    async searchVisibleOpportunities({ topicId, actorUserId, search }) {
      return transaction(pool, async (client) => {
        await memberTopic(client, topicId, actorUserId);
        if (!search) return [];
        const pattern = `%${search.replace(/[\\%_]/g, '\\$&')}%`;
        const result = await client.query(`
          SELECT opportunity.id, opportunity.opportunity_no, opportunity.title
          FROM opportunities opportunity
          WHERE opportunity.deleted_at IS NULL
            AND bestcrm_development_can_view_opportunity($1, opportunity.id)
            AND (opportunity.opportunity_no ILIKE $2 ESCAPE '\\'
              OR opportunity.title ILIKE $2 ESCAPE '\\')
          ORDER BY opportunity.created_at DESC, opportunity.id DESC LIMIT 25
        `, [actorUserId, pattern]);
        return result.rows.map((row) => ({ id: Number(row.id),
          opportunityNo: row.opportunity_no, title: row.title }));
      });
    },

    async listTopicBusiness({ topicId, actorUserId }) {
      return transaction(pool, async (client) => {
        const topic = await memberTopic(client, topicId, actorUserId);
        const links = await client.query(`
          SELECT link.*, opportunity.opportunity_no,
            opportunity.title AS opportunity_title
          FROM development_opportunity_links link
          JOIN opportunities opportunity ON opportunity.id = link.opportunity_id
            AND opportunity.deleted_at IS NULL
          WHERE link.topic_id = $1 AND link.unlinked_at IS NULL
            AND bestcrm_development_can_view_opportunity($2, link.opportunity_id)
          ORDER BY link.linked_at DESC, link.id DESC
        `, [topicId, actorUserId]);
        const assets = await client.query(`
          SELECT asset.id, revision.id AS outcome_revision_id,
            revision.revision_no, revision.title
          FROM development_assets asset
          JOIN development_outcome_revisions revision ON revision.id = asset.outcome_revision_id
          WHERE revision.topic_id = $1 AND revision.outcome_kind = 'technical_result'
            AND NOT EXISTS (SELECT 1 FROM development_asset_withdrawals withdrawal
              WHERE withdrawal.asset_id = asset.id)
          ORDER BY asset.published_at DESC, asset.id DESC
        `, [topicId]);
        const requests = await client.query(`
          SELECT request.*, link.opportunity_id, asset.outcome_revision_id, revision.revision_no,
            revision.title AS outcome_title, link.unlinked_at,
            withdrawal.withdrawn_at, decision.id AS decision_id,
            decision.decision_code, decision.reason AS decision_reason,
            decision.decided_by_user_id, decision.decided_at,
            revocation.revoked_at, revocation.reason AS revocation_reason
          FROM development_customer_use_requests request
          JOIN development_opportunity_links link ON link.id = request.opportunity_link_id
          JOIN development_assets asset ON asset.id = request.asset_id
          JOIN development_outcome_revisions revision ON revision.id = asset.outcome_revision_id
          LEFT JOIN development_asset_withdrawals withdrawal ON withdrawal.asset_id = asset.id
          LEFT JOIN development_customer_use_decisions decision ON decision.request_id = request.id
          LEFT JOIN development_customer_use_revocations revocation ON revocation.decision_id = decision.id
          WHERE link.topic_id = $1
            AND bestcrm_development_can_view_opportunity($2, link.opportunity_id)
          ORDER BY request.requested_at DESC, request.id DESC
        `, [topicId, actorUserId]);
        const uses = await client.query(`
          SELECT use.*, message.sent_at, message.thread_id AS email_thread_id,
            CASE WHEN use.technical_solution_document_id IS NOT NULL
              THEN technical.document_no
              ELSE package_document.document_no END AS version_label
          FROM development_customer_file_uses use
          JOIN development_customer_use_decisions decision ON decision.id = use.decision_id
          JOIN development_customer_use_requests request ON request.id = decision.request_id
          JOIN development_opportunity_links link ON link.id = request.opportunity_link_id
          JOIN email_messages message ON message.id = use.email_message_id
          LEFT JOIN technical_solution_documents technical
            ON technical.id = use.technical_solution_document_id
          LEFT JOIN quotation_package_documents package_document
            ON package_document.id = use.quotation_package_document_id
          WHERE link.topic_id = $1
            AND bestcrm_development_can_view_opportunity($2, link.opportunity_id)
          ORDER BY use.recorded_at DESC, use.id DESC
        `, [topicId, actorUserId]);
        const mappedRequests = requests.rows.map(mapRequest);
        const requestByDecision = new Map(mappedRequests.filter((request) => request.decision)
          .map((request) => [request.decision.id, request]));
        for (const row of uses.rows) {
          requestByDecision.get(Number(row.decision_id))?.fileUses.push(mapFileUse(row));
        }
        return {
          topic: { id: Number(topic.id), topicNo: topic.topic_no,
            title: topic.title, ownerUserId: Number(topic.owner_user_id) },
          links: links.rows.map(mapLink),
          assets: assets.rows.map((row) => ({ id: Number(row.id),
            outcomeRevisionId: Number(row.outcome_revision_id),
            revisionNo: Number(row.revision_no), title: row.title })),
          requests: mappedRequests
        };
      });
    },

    async listSentCustomerFiles({ topicId, actorUserId }) {
      return transaction(pool, async (client) => {
        await memberTopic(client, topicId, actorUserId);
        const result = await client.query(`
          WITH visible_opportunities AS (
            SELECT DISTINCT link.opportunity_id
            FROM development_opportunity_links link
            WHERE link.topic_id = $1 AND link.unlinked_at IS NULL
              AND bestcrm_development_can_view_opportunity($2, link.opportunity_id)
          ), evidence AS (
            SELECT thread.opportunity_id, 'technical_solution'::text AS file_kind,
              file.id AS file_id, attachment.id AS email_attachment_id,
              file.original_name AS file_name, file.sha256,
              file.document_no AS version_label, message.sent_at,
              message.id AS email_message_id, NULL::bigint AS quotation_package_version_id
            FROM email_attachments attachment
            JOIN email_messages message ON message.id = attachment.message_id
              AND message.quotation_package_version_id IS NULL
            JOIN email_threads thread ON thread.id = message.thread_id
            JOIN visible_opportunities visible ON visible.opportunity_id = thread.opportunity_id
            JOIN email_outbound_mime_artifacts mime ON mime.message_id = message.id
            JOIN technical_solution_documents file
              ON file.id = attachment.source_technical_document_id
              AND file.sha256 = attachment.sha256
              AND file.byte_size = attachment.file_size
              AND file.original_name = attachment.original_name
              AND file.mime_type = attachment.mime_type
            JOIN opportunity_technical_drafts draft ON draft.id = file.technical_draft_id
              AND draft.opportunity_id = thread.opportunity_id
              AND draft.status = 'approved'
            WHERE message.direction = 'outbound' AND message.delivery_status = 'sent'
              AND message.sent_at IS NOT NULL
            UNION ALL
            SELECT thread.opportunity_id, 'technical_solution', file.id,
              attachment.id, file.original_name, file.sha256, file.document_no,
              message.sent_at, message.id, message.quotation_package_version_id
            FROM email_attachments attachment
            JOIN email_messages message ON message.id = attachment.message_id
              AND message.quotation_package_version_id IS NOT NULL
            JOIN email_threads thread ON thread.id = message.thread_id
            JOIN visible_opportunities visible ON visible.opportunity_id = thread.opportunity_id
            JOIN email_outbound_mime_artifacts mime ON mime.message_id = message.id
            JOIN quotation_package_attachments snapshot
              ON snapshot.quotation_package_id = message.quotation_package_version_id
              AND snapshot.sha256 = attachment.sha256
              AND snapshot.byte_size = attachment.file_size
              AND snapshot.original_name = attachment.original_name
            JOIN technical_solution_documents file
              ON file.id = snapshot.technical_solution_document_id
              AND file.mime_type = attachment.mime_type
            JOIN opportunity_technical_drafts draft ON draft.id = file.technical_draft_id
              AND draft.opportunity_id = thread.opportunity_id
              AND draft.status = 'approved'
            WHERE message.direction = 'outbound' AND message.delivery_status = 'sent'
              AND message.sent_at IS NOT NULL
            UNION ALL
            SELECT thread.opportunity_id, 'quotation_package', file.id,
              attachment.id, file.original_name, file.sha256, file.document_no,
              message.sent_at, message.id, message.quotation_package_version_id
            FROM email_attachments attachment
            JOIN email_messages message ON message.id = attachment.message_id
              AND message.quotation_package_version_id IS NOT NULL
            JOIN email_threads thread ON thread.id = message.thread_id
            JOIN visible_opportunities visible ON visible.opportunity_id = thread.opportunity_id
            JOIN email_outbound_mime_artifacts mime ON mime.message_id = message.id
            JOIN quotation_package_documents file
              ON file.quotation_package_version_id = message.quotation_package_version_id
              AND file.sha256 = attachment.sha256
              AND file.byte_size = attachment.file_size
              AND file.original_name = attachment.original_name
              AND file.mime_type = attachment.mime_type
              AND file.document_type IN ('technical_docx', 'technical_pdf',
                'complete_docx', 'complete_pdf')
            JOIN quotation_package_versions package
              ON package.id = file.quotation_package_version_id
              AND package.opportunity_id = thread.opportunity_id
            WHERE message.direction = 'outbound' AND message.delivery_status = 'sent'
              AND message.sent_at IS NOT NULL
          )
          SELECT * FROM evidence ORDER BY sent_at DESC, email_attachment_id DESC LIMIT 300
        `, [topicId, actorUserId]);
        return result.rows.map((row) => ({
          opportunityId: Number(row.opportunity_id),
          fileKind: row.file_kind, fileId: Number(row.file_id),
          emailAttachmentId: Number(row.email_attachment_id),
          emailMessageId: Number(row.email_message_id),
          quotationPackageVersionId: row.quotation_package_version_id
            ? Number(row.quotation_package_version_id) : null,
          fileName: row.file_name, sha256: row.sha256,
          versionLabel: row.version_label, sentAt: row.sent_at,
          evidenceKey: `${row.file_kind}:${row.file_id}:${row.email_attachment_id}`
        }));
      });
    },

    async listOpportunityBusiness({ opportunityId, actorUserId }) {
      const result = await pool.query(`
        SELECT link.id, link.topic_id, topic.topic_no, topic.title AS topic_title
        FROM development_opportunity_links link
        JOIN development_topics topic ON topic.id = link.topic_id
        WHERE link.opportunity_id = $1 AND link.unlinked_at IS NULL
          AND bestcrm_development_active_member($2, link.topic_id)
          AND bestcrm_development_can_view_opportunity($2, link.opportunity_id)
        ORDER BY link.id DESC
      `, [opportunityId, actorUserId]);
      const approved = await pool.query(`
        SELECT link.id AS link_id, request.id AS request_id,
          asset.id AS asset_id, revision.id AS outcome_revision_id,
          revision.revision_no, revision.title, revision.finding,
          revision.applicability, revision.limitations, request.purpose,
          decision.decided_at
        FROM development_customer_use_requests request
        JOIN development_opportunity_links link ON link.id = request.opportunity_link_id
        JOIN development_customer_use_decisions decision ON decision.request_id = request.id
          AND decision.decision_code = 'approved'
        JOIN development_assets asset ON asset.id = request.asset_id
        JOIN development_outcome_revisions revision ON revision.id = asset.outcome_revision_id
          AND revision.topic_id = link.topic_id
        WHERE link.opportunity_id = $1 AND link.unlinked_at IS NULL
          AND revision.outcome_kind = 'technical_result'
          AND bestcrm_development_active_member($2, link.topic_id)
          AND bestcrm_development_can_view_opportunity($2, link.opportunity_id)
          AND NOT EXISTS (SELECT 1 FROM development_asset_withdrawals withdrawal
            WHERE withdrawal.asset_id = asset.id)
          AND NOT EXISTS (SELECT 1 FROM development_customer_use_revocations revocation
            WHERE revocation.decision_id = decision.id)
        ORDER BY decision.decided_at DESC, decision.id DESC
      `, [opportunityId, actorUserId]);
      const recorded = await pool.query(`
        SELECT link.id AS link_id, use.*, revision.revision_no, revision.title,
          message.sent_at, message.thread_id AS email_thread_id,
          CASE WHEN use.technical_solution_document_id IS NOT NULL
            THEN technical.document_no ELSE package_document.document_no END AS version_label
        FROM development_customer_file_uses use
        JOIN development_customer_use_decisions decision ON decision.id = use.decision_id
        JOIN development_customer_use_requests request ON request.id = decision.request_id
        JOIN development_opportunity_links link ON link.id = request.opportunity_link_id
        JOIN development_assets asset ON asset.id = request.asset_id
        JOIN development_outcome_revisions revision ON revision.id = asset.outcome_revision_id
        JOIN email_messages message ON message.id = use.email_message_id
        LEFT JOIN technical_solution_documents technical
          ON technical.id = use.technical_solution_document_id
        LEFT JOIN quotation_package_documents package_document
          ON package_document.id = use.quotation_package_document_id
        WHERE link.opportunity_id = $1 AND link.unlinked_at IS NULL
          AND bestcrm_development_active_member($2, link.topic_id)
          AND bestcrm_development_can_view_opportunity($2, link.opportunity_id)
        ORDER BY use.recorded_at DESC, use.id DESC
      `, [opportunityId, actorUserId]);
      const citationsByLink = new Map();
      for (const row of approved.rows) {
        const linkId = Number(row.link_id);
        if (!citationsByLink.has(linkId)) citationsByLink.set(linkId, []);
        citationsByLink.get(linkId).push({
          requestId: Number(row.request_id), assetId: Number(row.asset_id),
          outcomeRevisionId: Number(row.outcome_revision_id),
          revisionNo: Number(row.revision_no), title: row.title,
          finding: row.finding, applicability: row.applicability,
          limitations: row.limitations, purpose: row.purpose,
          decidedAt: row.decided_at
        });
      }
      const fileUsesByLink = new Map();
      for (const row of recorded.rows) {
        const linkId = Number(row.link_id);
        if (!fileUsesByLink.has(linkId)) fileUsesByLink.set(linkId, []);
        fileUsesByLink.get(linkId).push({ ...mapFileUse(row),
          outcomeTitle: row.title, revisionNo: Number(row.revision_no) });
      }
      return result.rows.map((row) => ({ linkId: Number(row.id),
        topicId: Number(row.topic_id), topicNo: row.topic_no,
        topicTitle: row.topic_title,
        approvedUses: citationsByLink.get(Number(row.id))?.length || 0,
        citations: citationsByLink.get(Number(row.id)) || [],
        fileUses: fileUsesByLink.get(Number(row.id)) || [] }));
    },

    async linkOpportunity(input) {
      return transaction(pool, async (client) => {
        await memberTopic(client, input.topicId, input.actorUserId, true);
        const opportunity = await client.query(`
          SELECT 1 FROM opportunities WHERE id = $1 AND deleted_at IS NULL
            AND bestcrm_development_can_view_opportunity($2, id)
        `, [input.opportunityId, input.actorUserId]);
        if (!opportunity.rowCount) fail('Opportunity not found', 404);
        const result = await client.query(`
          INSERT INTO development_opportunity_links (
            topic_id, opportunity_id, link_reason, linked_by_user_id
          ) VALUES ($1, $2, $3, $4)
          ON CONFLICT (topic_id, opportunity_id) WHERE unlinked_at IS NULL DO NOTHING
          RETURNING id
        `, [input.topicId, input.opportunityId, input.reason, input.actorUserId]);
        if (!result.rowCount) fail('Opportunity is already linked');
        return { id: Number(result.rows[0].id), topicId: input.topicId,
          opportunityId: input.opportunityId };
      });
    },

    async unlinkOpportunity(input) {
      return transaction(pool, async (client) => {
        const topic = await memberTopic(client, input.topicId, input.actorUserId, true);
        if (Number(topic.owner_user_id) !== input.actorUserId) {
          fail('Only the topic owner may end an opportunity link', 403);
        }
        await visibleLink(client, input.linkId, input.topicId, input.actorUserId);
        const result = await client.query(`
          UPDATE development_opportunity_links
          SET unlinked_at = now(), unlinked_by_user_id = $3
          WHERE id = $1 AND topic_id = $2 AND unlinked_at IS NULL
          RETURNING id
        `, [input.linkId, input.topicId, input.actorUserId]);
        if (!result.rowCount) fail('Opportunity link not found', 404);
        return { id: input.linkId, unlinked: true };
      });
    },

    async requestCustomerUse(input) {
      return transaction(pool, async (client) => {
        await memberTopic(client, input.topicId, input.actorUserId, true);
        await visibleLink(client, input.linkId, input.topicId, input.actorUserId);
        const asset = await client.query(`
          SELECT 1 FROM development_assets asset
          JOIN development_outcome_revisions revision ON revision.id = asset.outcome_revision_id
          WHERE asset.id = $1 AND revision.topic_id = $2
            AND revision.outcome_kind = 'technical_result'
            AND NOT EXISTS (SELECT 1 FROM development_asset_withdrawals withdrawal
              WHERE withdrawal.asset_id = asset.id)
        `, [input.assetId, input.topicId]);
        if (!asset.rowCount) fail('Published technical result not found', 404);
        const duplicate = await client.query(`
          SELECT 1 FROM development_customer_use_requests request
          LEFT JOIN development_customer_use_decisions decision ON decision.request_id = request.id
          LEFT JOIN development_customer_use_revocations revocation ON revocation.decision_id = decision.id
          WHERE request.opportunity_link_id = $1 AND request.asset_id = $2
            AND request.purpose = $3 AND (decision.id IS NULL
              OR (decision.decision_code = 'approved' AND revocation.id IS NULL))
          LIMIT 1
        `, [input.linkId, input.assetId, input.purpose]);
        if (duplicate.rowCount) fail('An open or approved request already covers this exact use');
        const result = await client.query(`
          INSERT INTO development_customer_use_requests (
            opportunity_link_id, asset_id, purpose, requested_by_user_id
          ) VALUES ($1, $2, $3, $4) RETURNING id
        `, [input.linkId, input.assetId, input.purpose, input.actorUserId]);
        return { id: Number(result.rows[0].id), linkId: input.linkId,
          assetId: input.assetId, purpose: input.purpose };
      });
    },

    async decideCustomerUse(input) {
      return transaction(pool, async (client) => {
        await memberTopic(client, input.topicId, input.actorUserId, true);
        const request = await visibleRequest(client, input.requestId,
          input.topicId, input.actorUserId);
        if (request.decision_id) fail('Customer-use request was already decided');
        if (request.unlinked_at || request.withdrawal_id) {
          fail('Active link and published asset required');
        }
        const role = await client.query(`
          SELECT bestcrm_development_has_active_role($1, 'technical_manager') AS allowed
        `, [input.actorUserId]);
        if (!role.rows[0].allowed) fail('Active technical manager required', 403);
        const result = await client.query(`
          INSERT INTO development_customer_use_decisions (
            request_id, decision_code, reason, decided_by_user_id
          ) VALUES ($1, $2, $3, $4) ON CONFLICT (request_id) DO NOTHING RETURNING id
        `, [input.requestId, input.decisionCode, input.reason, input.actorUserId]);
        if (!result.rowCount) fail('Customer-use request was already decided');
        return { id: Number(result.rows[0].id), requestId: input.requestId,
          decisionCode: input.decisionCode };
      });
    },

    async revokeCustomerUse(input) {
      return transaction(pool, async (client) => {
        await memberTopic(client, input.topicId, input.actorUserId, true);
        const request = await visibleRequest(client, input.requestId,
          input.topicId, input.actorUserId);
        if (request.decision_code !== 'approved' || request.revocation_id) {
          fail('Only an effective approval may be revoked');
        }
        const role = await client.query(`
          SELECT bestcrm_development_has_active_role($1, 'technical_manager') AS allowed
        `, [input.actorUserId]);
        if (!role.rows[0].allowed) fail('Active technical manager required', 403);
        const result = await client.query(`
          INSERT INTO development_customer_use_revocations (
            decision_id, reason, revoked_by_user_id
          ) VALUES ($1, $2, $3) ON CONFLICT (decision_id) DO NOTHING RETURNING id
        `, [request.decision_id, input.reason, input.actorUserId]);
        if (!result.rowCount) fail('Approval was already revoked');
        return { id: Number(result.rows[0].id), requestId: input.requestId };
      });
    },

    async recordCustomerFileUse(input) {
      return transaction(pool, async (client) => {
        await memberTopic(client, input.topicId, input.actorUserId, true);
        const request = await visibleRequest(client, input.requestId,
          input.topicId, input.actorUserId);
        if (request.decision_code !== 'approved' || request.revocation_id
            || request.unlinked_at || request.withdrawal_id) {
          fail('Effective customer-use approval required');
        }
        const sourceTable = input.fileKind === 'technical_solution'
          ? 'technical_solution_documents' : 'quotation_package_documents';
        const sourceColumn = input.fileKind === 'technical_solution'
          ? 'technical_solution_document_id' : 'quotation_package_document_id';
        const result = await client.query(`
          INSERT INTO development_customer_file_uses (
            decision_id, opportunity_id, ${sourceColumn},
            quotation_package_version_id, email_message_id, email_attachment_id,
            outbound_mime_artifact_id, file_sha256, file_name,
            usage_location, content_confirmed, recorded_by_user_id
          )
          SELECT $1, $2, file.id, message.quotation_package_version_id,
            message.id, attachment.id, mime.id, file.sha256, file.original_name,
            $5, true, $6
          FROM ${sourceTable} file
          JOIN email_attachments attachment ON attachment.id = $4
          JOIN email_messages message ON message.id = attachment.message_id
          JOIN email_outbound_mime_artifacts mime ON mime.message_id = message.id
          WHERE file.id = $3
          ON CONFLICT (decision_id, email_attachment_id) DO NOTHING
          RETURNING *
        `, [request.decision_id, request.opportunity_id, input.fileId,
          input.emailAttachmentId, input.usageLocation, input.actorUserId]);
        if (!result.rowCount) fail('File use already recorded or evidence not found');
        return { id: Number(result.rows[0].id), requestId: input.requestId,
          fileKind: input.fileKind, fileId: input.fileId,
          emailAttachmentId: input.emailAttachmentId,
          sha256: result.rows[0].file_sha256 };
      });
    }
  };
}
