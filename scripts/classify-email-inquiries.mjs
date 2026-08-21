import { loadConfig } from '../src/config.mjs';
import { createPool } from '../src/db/pool.mjs';
import { classifyEmailInquiryPayload } from '../src/services/emailInquiryFilterService.mjs';

const config = loadConfig();
const pool = createPool(config);

function mergeEmailFilter(rawPayload, filter) {
  const payload = rawPayload && typeof rawPayload === 'object' ? rawPayload : {};
  return {
    ...payload,
    emailFilter: filter
  };
}

function reviewNoteFor(row, filter) {
  const existing = row.review_note || '';
  const isAutoNote = existing.startsWith('Auto-filtered email:');
  if (filter.status === 'new') {
    return isAutoNote ? '' : existing;
  }
  return !existing || isAutoNote ? `Auto-filtered email: ${filter.reason}` : existing;
}

try {
  const result = await pool.query(`
    SELECT
      id,
      subject,
      contact_name,
      contact_email,
      product_interest,
      opportunity_type,
      requirement_text,
      raw_payload,
      review_note
    FROM inquiries
    WHERE source = 'email'
      AND status IN ('new', 'spam', 'archived')
    ORDER BY id
  `);

  const updates = [];
  for (const row of result.rows) {
    const filter = classifyEmailInquiryPayload({
      subject: row.subject,
      contactName: row.contact_name,
      contactEmail: row.contact_email,
      productInterest: row.product_interest,
      opportunityType: row.opportunity_type,
      requirementText: row.requirement_text,
      rawPayload: row.raw_payload || {}
    });
    const reviewNote = reviewNoteFor(row, filter);
    await pool.query(`
      UPDATE inquiries
      SET
        status = $1,
        raw_payload = $2::jsonb,
        review_note = $3,
        updated_at = now()
      WHERE id = $4
    `, [
      filter.status,
      JSON.stringify(mergeEmailFilter(row.raw_payload, filter)),
      reviewNote,
      row.id
    ]);
    updates.push({
      id: Number(row.id),
      status: filter.status,
      reason: filter.reason
    });
  }

  console.log(JSON.stringify({
    event: 'email_inquiry_classification_complete',
    scanned: result.rows.length,
    updates
  }, null, 2));
} finally {
  await pool.end();
}
