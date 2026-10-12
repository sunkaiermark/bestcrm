import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { createSalesCommercialQuotationDraftRepository } from '../../src/repositories/salesCommercialQuotationDraftRepository.mjs';

const connectionString = process.env.BESTCRM_QUOTATION_DB_TEST_URL;

test('formal quotation database guards preserve the signed version and require its PDF at email send',
  { skip: !connectionString }, async () => {
    const pool = new pg.Pool({ connectionString });
    const client = await pool.connect();
    async function insert(sql, values = []) {
      return (await client.query(sql, values)).rows[0];
    }
    async function rejected(sql, values, pattern) {
      await client.query('SAVEPOINT expected_rejection');
      await assert.rejects(() => client.query(sql, values), pattern);
      await client.query('ROLLBACK TO SAVEPOINT expected_rejection');
      await client.query('RELEASE SAVEPOINT expected_rejection');
    }
    try {
      await client.query('BEGIN');
      const repository = createSalesCommercialQuotationDraftRepository(client);
      const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
      const sales = await insert(`INSERT INTO users (username, password_hash, display_name)
        VALUES ($1, 'test', 'Sales') RETURNING id`, [`test_quote_sales_${suffix}`]);
      const manager = await insert(`INSERT INTO users (username, password_hash, display_name)
        VALUES ($1, 'test', 'Manager') RETURNING id`, [`test_quote_manager_${suffix}`]);
      const mark = await insert(`INSERT INTO users (username, password_hash, display_name)
        VALUES ('MarkYang', 'test', 'Mark Yang') RETURNING id`);
      const outsider = await insert(`INSERT INTO users (username, password_hash, display_name)
        VALUES ($1, 'test', 'Outsider') RETURNING id`, [`test_quote_outsider_${suffix}`]);
      const commercialManagerRole = await insert(`INSERT INTO roles (code, name, is_active)
        VALUES ('commercial_manager', 'Commercial Manager', true)
        ON CONFLICT (code) DO UPDATE SET is_active = true
        RETURNING id`);
      await client.query(`INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2), ($3, $2)`,
        [manager.id, commercialManagerRole.id, mark.id]);
      const customer = await insert(`INSERT INTO customers (name, owner_user_id)
        VALUES ('Quotation SQL test', $1) RETURNING id`, [sales.id]);
      const opportunity = await insert(`INSERT INTO opportunities
        (opportunity_no, title, customer_id, requirement, status, salesperson_id, commercial_manager_id)
        VALUES ($1, 'Quotation SQL test', $2, 'Test', 'technical_solution_in_progress', $3, $4)
        RETURNING id`, [`TEST-${suffix}`, customer.id, sales.id, manager.id]);
      const technical = await insert(`INSERT INTO opportunity_technical_drafts
        (opportunity_id, draft_revision_no, source_kind, language,
          template_code_snapshot, template_name_snapshot, template_revision_no_snapshot,
          content_schema_snapshot, variable_schema_snapshot, rendered_content, created_by, updated_by)
        VALUES ($1, 1, 'uploaded_file', 'en', 'TS-D1', 'Technical', 1,
          '{}'::jsonb, '[]'::jsonb, '{}'::jsonb, $2, $2) RETURNING id`,
      [opportunity.id, sales.id]);
      const sourceHash = 'a'.repeat(64);
      const attachment = await insert(`INSERT INTO attachments
        (opportunity_id, category, original_name, stored_path, mime_type, file_size, uploaded_by, sha256)
        VALUES ($1, 'technical_solution', 'source.pdf', 'tests/source.pdf', 'application/pdf', 10, $2, $3)
        RETURNING id`, [opportunity.id, sales.id, sourceHash]);
      await client.query(`INSERT INTO opportunity_technical_draft_attachments
        (technical_draft_id, attachment_id, sort_order, added_by) VALUES ($1, $2, 1, $3)`,
      [technical.id, attachment.id, sales.id]);
      await client.query(`UPDATE opportunity_technical_drafts SET uploaded_attachment_id = $2,
        status = 'approved', formal_version_no = 1, submitted_by = $3, submitted_at = now(),
        reviewed_by = $4, reviewed_at = now() WHERE id = $1`,
      [technical.id, attachment.id, sales.id, manager.id]);
      const draft = await insert(`INSERT INTO sales_commercial_quotation_drafts
        (opportunity_id, source_technical_draft_id, source_attachment_id, source_sha256,
          source_file_name, language, currency, seller_entity_code, seller_entity_name,
          line_items, term_selections, created_by, updated_by)
        VALUES ($1, $2, $3, $4, 'source.pdf', 'en', 'USD', 'sunkaier_china',
          '江苏胜开尔工业技术有限公司', '[]'::jsonb, '{}'::jsonb, $5, $5) RETURNING id`,
      [opportunity.id, technical.id, attachment.id, sourceHash, sales.id]);
      const snapshot = { seller: { code: 'sunkaier_china', legalName: '江苏胜开尔工业技术有限公司' } };
      const transactionRepository = createSalesCommercialQuotationDraftRepository({
        async connect() {
          return {
            async query(sql, values) {
              if (sql === 'BEGIN') return client.query('SAVEPOINT formal_submit');
              if (sql === 'COMMIT') return client.query('RELEASE SAVEPOINT formal_submit');
              if (sql === 'ROLLBACK') return client.query('ROLLBACK TO SAVEPOINT formal_submit');
              return client.query(sql, values);
            },
            release() {}
          };
        }
      });
      const version = await transactionRepository.submitFormalVersion({ opportunityId: opportunity.id,
        expectedRevisionNo: 1, actorUserId: sales.id, snapshot });
      assert.equal(version.draftId, Number(draft.id));
      assert.equal(version.quotationNo, `Q-TEST-${suffix}-V1`);
      assert.equal((await client.query(`SELECT status FROM opportunities WHERE id = $1`,
        [opportunity.id])).rows[0].status, 'commercial_quote_pending');
      const reviewTodo = await client.query(`SELECT todo.action_url, item.action_url AS work_item_action_url
        FROM todos todo
        JOIN work_items item ON item.source_type = 'workflow_todo' AND item.source_record_id = todo.id
        WHERE todo.opportunity_id = $1 AND todo.assignee_user_id = $2
          AND todo.title = 'Approve commercial quote' AND todo.status = 'pending'`,
      [opportunity.id, manager.id]);
      assert.deepEqual(reviewTodo.rows, [{
        action_url: `/opportunities/${opportunity.id}/commercial-quotation-draft#quotation-version-${version.id}`,
        work_item_action_url: `/opportunities/${opportunity.id}/commercial-quotation-draft#quotation-version-${version.id}`
      }]);
      const managerNotification = await client.query(`SELECT notification.action_url
        FROM notifications notification
        JOIN workflow_events event ON event.id = notification.source_id
          AND notification.source_type = 'workflow_event'
        WHERE event.opportunity_id = $1 AND event.event_type = 'submit_commercial_quote'
          AND notification.user_id = $2`, [opportunity.id, manager.id]);
      assert.deepEqual(managerNotification.rows, [{
        action_url: `/opportunities/${opportunity.id}/commercial-quotation-draft#quotation-version-${version.id}`
      }]);
      await rejected(`UPDATE sales_commercial_quotation_versions SET snapshot = '{}'::jsonb
        WHERE id = $1`, [version.id], /snapshot is immutable/);
      await rejected(`UPDATE sales_commercial_quotation_versions
        SET status = 'approved', reviewed_by = $2, reviewed_at = now() WHERE id = $1`,
      [version.id, sales.id], /self-approval is prohibited|assigned Commercial Manager/);
      const approved = await transactionRepository.reviewFormalVersion({ id: version.id,
        opportunityId: opportunity.id, decision: 'approved', actorUserId: manager.id, comment: '' });
      assert.equal(approved.status, 'approved');
      assert.equal((await client.query(`SELECT status FROM opportunities WHERE id = $1`,
        [opportunity.id])).rows[0].status, 'customer_negotiation');
      assert.equal((await client.query(`SELECT status FROM todos
        WHERE opportunity_id = $1 AND title = 'Approve commercial quote' ORDER BY id DESC LIMIT 1`,
      [opportunity.id])).rows[0].status, 'completed');
      const signSql = `UPDATE sales_commercial_quotation_versions
        SET status = 'signed', signed_by = $2, signed_at = now(), signature_sha256 = $3,
          pdf_stored_path = 'signed-sales-quotations/test.pdf', pdf_sha256 = $4, pdf_file_size = 42
        WHERE id = $1`;
      const pdfHash = 'b'.repeat(64);
      await rejected(signSql, [version.id, outsider.id, 'c'.repeat(64), pdfHash],
        /Only MarkYang/);
      const signed = await repository.signFormalVersion({ id: version.id,
        opportunityId: opportunity.id, actorUserId: mark.id, signedAt: new Date().toISOString(),
        signatureSha256: 'c'.repeat(64), sealSha256: null,
        pdfStoredPath: 'signed-sales-quotations/test.pdf', pdfSha256: pdfHash,
        pdfFileSize: 42, sourceAttachmentId: attachment.id });
      assert.equal(signed.status, 'signed');
      const thread = await insert(`INSERT INTO email_threads (mailbox_key, last_message_at,
        opportunity_id) VALUES ('sales@sunkaier.com', now(), $1) RETURNING id`, [opportunity.id]);
      const message = await insert(`INSERT INTO email_messages (thread_id, direction, from_address,
        delivery_status, sales_quotation_version_id)
        VALUES ($1, 'outbound', 'sales@sunkaier.com', 'draft', $2) RETURNING id`,
      [thread.id, version.id]);
      await rejected(`UPDATE email_messages SET delivery_status = 'pending' WHERE id = $1`,
        [message.id], /Signed quotation PDF attachment is missing/);
      await client.query(`INSERT INTO email_attachments
        (message_id, source_index, original_name, stored_path, file_size, sha256, mime_type)
        VALUES ($1, 0, 'formal.pdf', 'email-outbound/formal.pdf', 42, $2, 'application/pdf')`,
      [message.id, pdfHash]);
      await client.query(`UPDATE email_messages SET delivery_status = 'pending' WHERE id = $1`,
        [message.id]);
      const newerTechnical = await insert(`INSERT INTO opportunity_technical_drafts
        (opportunity_id, draft_revision_no, source_kind, language,
          template_code_snapshot, template_name_snapshot, template_revision_no_snapshot,
          content_schema_snapshot, variable_schema_snapshot, rendered_content, created_by, updated_by)
        VALUES ($1, 2, 'uploaded_file', 'en', 'TS-D1', 'Technical', 1,
          '{}'::jsonb, '[]'::jsonb, '{}'::jsonb, $2, $2) RETURNING id`,
      [opportunity.id, sales.id]);
      const newerFile = await insert(`INSERT INTO attachments
        (opportunity_id, category, original_name, stored_path, mime_type, file_size, uploaded_by, sha256)
        VALUES ($1, 'technical_solution', 'source-v2.pdf', 'tests/source-v2.pdf', 'application/pdf', 10, $2, $3)
        RETURNING id`, [opportunity.id, sales.id, 'd'.repeat(64)]);
      await client.query(`INSERT INTO opportunity_technical_draft_attachments
        (technical_draft_id, attachment_id, sort_order, added_by) VALUES ($1, $2, 1, $3)`,
      [newerTechnical.id, newerFile.id, sales.id]);
      await client.query(`UPDATE opportunity_technical_drafts
        SET uploaded_attachment_id = $2, status = 'ready' WHERE id = $1`,
      [newerTechnical.id, newerFile.id]);
      await rejected(`UPDATE email_messages SET delivery_status = 'sent' WHERE id = $1`,
        [message.id], /Customer email requires a signed quotation/);
      const events = await client.query(`SELECT event_type FROM sales_commercial_quotation_version_events
        WHERE quotation_version_id = $1 ORDER BY id`, [version.id]);
      assert.deepEqual(events.rows.map((row) => row.event_type), ['submitted', 'approved', 'signed']);

      const markCustomer = await insert(`INSERT INTO customers (name, owner_user_id)
        VALUES ('Mark self-review quotation test', $1) RETURNING id`, [mark.id]);
      const markOpportunity = await insert(`INSERT INTO opportunities
        (opportunity_no, title, customer_id, requirement, status, salesperson_id, commercial_manager_id)
        VALUES ($1, 'Mark self-review quotation test', $2, 'Test', 'commercial_quote_in_progress', $3, $3)
        RETURNING id`, [`TEST-MARK-${suffix}`, markCustomer.id, mark.id]);
      const markTechnical = await insert(`INSERT INTO opportunity_technical_drafts
        (opportunity_id, draft_revision_no, source_kind, language,
          template_code_snapshot, template_name_snapshot, template_revision_no_snapshot,
          content_schema_snapshot, variable_schema_snapshot, rendered_content, created_by, updated_by)
        VALUES ($1, 1, 'uploaded_file', 'en', 'TS-D1', 'Technical', 1,
          '{}'::jsonb, '[]'::jsonb, '{}'::jsonb, $2, $2) RETURNING id`,
      [markOpportunity.id, mark.id]);
      const markSourceHash = 'e'.repeat(64);
      const markAttachment = await insert(`INSERT INTO attachments
        (opportunity_id, category, original_name, stored_path, mime_type, file_size, uploaded_by, sha256)
        VALUES ($1, 'technical_solution', 'mark-source.pdf', 'tests/mark-source.pdf',
          'application/pdf', 10, $2, $3) RETURNING id`,
      [markOpportunity.id, mark.id, markSourceHash]);
      await client.query(`INSERT INTO opportunity_technical_draft_attachments
        (technical_draft_id, attachment_id, sort_order, added_by) VALUES ($1, $2, 1, $3)`,
      [markTechnical.id, markAttachment.id, mark.id]);
      await client.query(`UPDATE opportunity_technical_drafts SET uploaded_attachment_id = $2,
        status = 'approved', formal_version_no = 1, submitted_by = $3, submitted_at = now(),
        reviewed_by = $4, reviewed_at = now() WHERE id = $1`,
      [markTechnical.id, markAttachment.id, mark.id, manager.id]);
      await insert(`INSERT INTO sales_commercial_quotation_drafts
        (opportunity_id, source_technical_draft_id, source_attachment_id, source_sha256,
          source_file_name, language, currency, seller_entity_code, seller_entity_name,
          line_items, term_selections, created_by, updated_by)
        VALUES ($1, $2, $3, $4, 'mark-source.pdf', 'en', 'USD', 'sunkaier_china',
          '江苏胜开尔工业技术有限公司', '[]'::jsonb, '{}'::jsonb, $5, $5) RETURNING id`,
      [markOpportunity.id, markTechnical.id, markAttachment.id, markSourceHash, mark.id]);
      const markVersion = await transactionRepository.submitFormalVersion({
        opportunityId: markOpportunity.id, expectedRevisionNo: 1, actorUserId: mark.id, snapshot
      });
      const markNotification = await client.query(`SELECT action_url
        FROM notifications
        WHERE user_id = $1 AND event_type = 'submit_commercial_quote'
          AND action_url = $2`, [mark.id,
        `/opportunities/${markOpportunity.id}/commercial-quotation-draft#quotation-version-${markVersion.id}`]);
      assert.equal(markNotification.rowCount, 1);
      const markRejected = await transactionRepository.reviewFormalVersion({
        id: markVersion.id, opportunityId: markOpportunity.id,
        decision: 'rejected', actorUserId: mark.id, comment: 'Revise'
      });
      assert.equal(markRejected.status, 'rejected');
      assert.equal((await client.query(`SELECT status FROM opportunities WHERE id = $1`,
        [markOpportunity.id])).rows[0].status, 'commercial_quote_rejected');
    } finally {
      await client.query('ROLLBACK');
      client.release();
      await pool.end();
    }
  });
