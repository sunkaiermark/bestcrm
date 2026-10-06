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
      const submitRepository = createSalesCommercialQuotationDraftRepository({
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
      const version = await submitRepository.submitFormalVersion({ opportunityId: opportunity.id,
        expectedRevisionNo: 1, actorUserId: sales.id, snapshot });
      assert.equal(version.draftId, Number(draft.id));
      assert.equal(version.quotationNo, `Q-TEST-${suffix}-V1`);
      await rejected(`UPDATE sales_commercial_quotation_versions SET snapshot = '{}'::jsonb
        WHERE id = $1`, [version.id], /snapshot is immutable/);
      await rejected(`UPDATE sales_commercial_quotation_versions
        SET status = 'approved', reviewed_by = $2, reviewed_at = now() WHERE id = $1`,
      [version.id, sales.id], /reviewed_by_submitted_by|Invalid commercial review/);
      const approved = await repository.reviewFormalVersion({ id: version.id,
        opportunityId: opportunity.id, decision: 'approved', actorUserId: manager.id, comment: '' });
      assert.equal(approved.status, 'approved');
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
    } finally {
      await client.query('ROLLBACK');
      client.release();
      await pool.end();
    }
  });
