import assert from 'node:assert/strict';
import pg from 'pg';
import { createEmailArchiveTransaction } from '../src/db/emailArchiveTransaction.mjs';
import { createEmailArchiveRepository } from '../src/repositories/emailArchiveRepository.mjs';
import { createInquiryRepository } from '../src/repositories/inquiryRepository.mjs';
import { createOpportunityRepository } from '../src/repositories/opportunityRepository.mjs';
import { createOpportunityResponsibilityRepository } from '../src/repositories/opportunityResponsibilityRepository.mjs';
import { createQuotationPackageRepository } from '../src/repositories/quotationPackageRepository.mjs';
import { createUserRepository } from '../src/repositories/userRepository.mjs';
import { createCustomerEmailDraft } from '../src/services/customerEmailService.mjs';

const databaseUrl = process.env.BID_CENTER_DB_TEST_URL;
if (!databaseUrl) throw new Error('BID_CENTER_DB_TEST_URL is required');
const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
if (!databaseName.startsWith('bestcrm_bid_center_test')) {
  throw new Error('Unsafe Bid Center revision database name');
}

const pool = new pg.Pool({ connectionString: databaseUrl });

async function prepareRevision() {
  const target = (await pool.query(`
    SELECT package.id, package.workspace_id, package.opportunity_id, package.version_no,
      opportunity.quotation_engineer_id
    FROM quotation_package_versions package
    JOIN opportunities opportunity ON opportunity.id = package.opportunity_id
    WHERE opportunity.opportunity_no = 'STEP4-ROLLBACK'
      AND package.workspace_id IS NOT NULL
      AND package.status = 'approved'
    ORDER BY package.version_no DESC, package.id DESC
    LIMIT 1
  `)).rows[0];
  assert.ok(target, 'Generate and approve browser QP-V1 before preparing the revision');

  const before = (await pool.query(`
    SELECT document_type, byte_size, sha256
    FROM quotation_package_documents
    WHERE quotation_package_version_id = $1
    ORDER BY document_type
  `, [target.id])).rows;
  assert.equal(before.length, 8, 'QP-V1 must have its complete eight-file set');

  await pool.query(`
    UPDATE users
    SET email_signature_name = COALESCE(NULLIF(email_signature_name, ''), display_name),
        email_signature_title = COALESCE(NULLIF(email_signature_title, ''), 'Project Lead Quotation Engineer')
    WHERE id = $1
  `, [target.quotation_engineer_id]);
  const actor = await createUserRepository(pool).findByIdWithRoles(Number(target.quotation_engineer_id));
  assert.ok(actor, 'Project Lead user is unavailable');
  const dependencies = {
    emailArchiveRepository: createEmailArchiveRepository(pool),
    inquiryRepository: createInquiryRepository(pool),
    opportunityRepository: createOpportunityRepository(pool),
    opportunityResponsibilityRepository: createOpportunityResponsibilityRepository(pool),
    quotationPackageRepository: createQuotationPackageRepository(pool),
    emailArchiveTransaction: createEmailArchiveTransaction(pool),
    transport: {
      async sendMail(message) {
        assert.equal(message.to[0].address, 'step8-recipient@example.invalid');
        assert.deepEqual(
          message.attachments.map((item) => item.contentType),
          ['application/pdf', 'application/zip', 'application/json']
        );
        return { messageId: '<step8-local-accepted@example.invalid>' };
      }
    },
    sharedAddress: 'sales@sunkaier.com',
    uploadDir: process.env.UPLOAD_DIR || './var/uploads',
    maxUploadMb: 25,
    now: () => '2026-09-05T00:00:00.000Z',
    randomUUID: () => `00000000-0000-4000-8000-${String(target.id).padStart(12, '0')}`
  };
  const message = await createCustomerEmailDraft(dependencies, actor, {
    opportunityId: Number(target.opportunity_id),
    quotationPackageVersionId: Number(target.id),
    to: 'step8-recipient@example.invalid',
    subject: `Step 8 local QP-V${Number(target.version_no)} sent-state rehearsal`,
    body: 'Local acceptance only. No external SMTP connection is used.',
    action: 'send'
  });
  assert.equal(message.deliveryStatus, 'sent');
  const sent = await dependencies.quotationPackageRepository.getPackageDetail(Number(target.id));
  assert.ok(sent, 'QP-V1 could not be moved to the local sent-state rehearsal');
  assert.equal(sent.status, 'sent');

  const after = (await pool.query(`
    SELECT document_type, byte_size, sha256
    FROM quotation_package_documents
    WHERE quotation_package_version_id = $1
    ORDER BY document_type
  `, [target.id])).rows;
  assert.deepEqual(after, before, 'Sending-state rehearsal must not alter QP-V1 outputs');

  return {
    workspaceId: Number(target.workspace_id),
    opportunityId: Number(target.opportunity_id),
    sourcePackageId: Number(target.id),
    sourceLabel: `QP-V${Number(sent.versionNo)}`,
    status: sent.status,
    archivedEmailMessageId: Number(message.id),
    providerMessageId: message.providerMessageId,
    externalDeliveryPerformed: false,
    preservedOutputCount: after.length,
    preservedOutputHashes: Object.fromEntries(after.map((item) => [item.document_type, item.sha256]))
  };
}

prepareRevision()
  .then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
  .then(() => pool.end())
  .catch(async (error) => {
    console.error(error);
    await pool.end();
    process.exit(1);
  });
