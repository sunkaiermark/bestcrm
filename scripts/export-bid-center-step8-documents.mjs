import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';

const databaseUrl = process.env.BID_CENTER_DB_TEST_URL;
if (!databaseUrl) throw new Error('BID_CENTER_DB_TEST_URL is required');
const databaseName = decodeURIComponent(new URL(databaseUrl).pathname.slice(1));
if (!databaseName.startsWith('bestcrm_bid_center_test')) {
  throw new Error('Unsafe Bid Center export database name');
}

const outputDir = path.resolve(process.env.BID_CENTER_STEP8_OUTPUT_DIR || './output/bid-center-step8/documents');
const pool = new pg.Pool({ connectionString: databaseUrl });

async function exportDocuments() {
  const result = await pool.query(`
    SELECT package.version_no, package.status, package.delivery_period,
      package.revision_reason, package.change_summary,
      document.document_type, document.original_name, document.mime_type,
      document.byte_size, document.sha256, document.content
    FROM quotation_package_versions package
    JOIN opportunities opportunity ON opportunity.id = package.opportunity_id
    JOIN quotation_package_documents document
      ON document.quotation_package_version_id = package.id
    WHERE opportunity.opportunity_no = 'STEP4-ROLLBACK'
      AND package.version_no IN (1, 2)
    ORDER BY package.version_no, document.id
  `);
  assert.equal(result.rows.length, 16, 'Expected complete eight-file sets for QP-V1 and QP-V2');
  const summary = [];
  for (const row of result.rows) {
    const content = Buffer.from(row.content);
    const sha256 = createHash('sha256').update(content).digest('hex');
    assert.equal(content.length, Number(row.byte_size));
    assert.equal(sha256, row.sha256);
    const versionLabel = `QP-V${Number(row.version_no)}`;
    const versionDir = path.join(outputDir, versionLabel);
    await mkdir(versionDir, { recursive: true });
    const filePath = path.join(versionDir, row.original_name);
    await writeFile(filePath, content);
    summary.push({
      versionLabel,
      status: row.status,
      deliveryPeriod: row.delivery_period,
      revisionReason: row.revision_reason || '',
      changeSummary: row.change_summary || '',
      documentType: row.document_type,
      originalName: row.original_name,
      mimeType: row.mime_type,
      byteSize: content.length,
      sha256,
      filePath
    });
  }
  await mkdir(outputDir, { recursive: true });
  const indexPath = path.join(outputDir, 'index.json');
  await writeFile(indexPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  return { outputDir, indexPath, documentCount: summary.length, summary };
}

exportDocuments()
  .then((result) => process.stdout.write(`${JSON.stringify(result, null, 2)}\n`))
  .then(() => pool.end())
  .catch(async (error) => {
    console.error(error);
    await pool.end();
    process.exit(1);
  });
