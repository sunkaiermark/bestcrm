function numberOrNull(value) {
  return value === null || value === undefined ? null : Number(value);
}

function mapQuoteItemRow(row) {
  if (!row?.item_id) {
    return null;
  }
  return {
    id: Number(row.item_id),
    itemName: row.item_name,
    specification: row.specification,
    unit: row.unit,
    quantity: Number(row.quantity),
    unitPrice: Number(row.unit_price),
    subtotal: Number(row.subtotal)
  };
}

function mapQuoteRow(row, items = []) {
  if (!row) {
    return null;
  }
  return {
    id: Number(row.id),
    opportunityId: Number(row.opportunity_id),
    versionNo: Number(row.version_no),
    totalPrice: Number(row.total_price),
    paymentTerms: row.payment_terms,
    validityDate: row.validity_date,
    remarks: row.remarks,
    status: row.status,
    submittedBy: Number(row.submitted_by),
    submitterDisplayName: row.submitter_display_name || '',
    submittedAt: row.submitted_at,
    reviewedBy: numberOrNull(row.reviewed_by),
    reviewerDisplayName: row.reviewer_display_name || '',
    reviewedAt: row.reviewed_at,
    reviewComment: row.review_comment,
    items
  };
}

function mapQuoteRows(rows) {
  const quotes = new Map();
  for (const row of rows) {
    const quoteId = Number(row.id);
    if (!quotes.has(quoteId)) {
      quotes.set(quoteId, mapQuoteRow(row, []));
    }
    const item = mapQuoteItemRow(row);
    if (item) {
      quotes.get(quoteId).items.push(item);
    }
  }
  return [...quotes.values()];
}

export function createCommercialQuoteRepository(queryTarget) {
  return {
    async createQuote(input) {
      const quoteResult = await queryTarget.query(`
        INSERT INTO commercial_quotes (
          opportunity_id,
          version_no,
          total_price,
          payment_terms,
          validity_date,
          remarks,
          status,
          submitted_by
        )
        SELECT
          $1,
          COALESCE(MAX(version_no), 0) + 1,
          $2,
          $3,
          $4,
          $5,
          'pending',
          $6
        FROM commercial_quotes
        WHERE opportunity_id = $1
        RETURNING *
      `, [
        input.opportunityId,
        input.totalPrice,
        input.paymentTerms,
        input.validityDate,
        input.remarks,
        input.submittedBy
      ]);
      const quoteId = Number(quoteResult.rows[0].id);

      for (const item of input.items) {
        await queryTarget.query(`
          INSERT INTO quote_items (
            quote_id,
            item_name,
            specification,
            unit,
            quantity,
            unit_price,
            subtotal
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [
          quoteId,
          item.itemName,
          item.specification,
          item.unit,
          item.quantity,
          item.unitPrice,
          item.subtotal
        ]);
      }

      return mapQuoteRow(quoteResult.rows[0], input.items);
    },

    async listByOpportunity(opportunityId) {
      const result = await queryTarget.query(`
        SELECT
          cq.id,
          cq.opportunity_id,
          cq.version_no,
          cq.total_price,
          cq.payment_terms,
          cq.validity_date,
          cq.remarks,
          cq.status,
          cq.submitted_by,
          submitter.display_name AS submitter_display_name,
          cq.submitted_at,
          cq.reviewed_by,
          reviewer.display_name AS reviewer_display_name,
          cq.reviewed_at,
          cq.review_comment,
          qi.id AS item_id,
          qi.item_name,
          qi.specification,
          qi.unit,
          qi.quantity,
          qi.unit_price,
          qi.subtotal
        FROM commercial_quotes cq
        LEFT JOIN users submitter ON submitter.id = cq.submitted_by
        LEFT JOIN users reviewer ON reviewer.id = cq.reviewed_by
        LEFT JOIN quote_items qi ON qi.quote_id = cq.id
        WHERE cq.opportunity_id = $1
        ORDER BY cq.version_no ASC, cq.submitted_at ASC, cq.id ASC, qi.id ASC
      `, [opportunityId]);
      return mapQuoteRows(result.rows);
    },

    async reviewLatestPending(input) {
      const result = await queryTarget.query(`
        UPDATE commercial_quotes
        SET
          status = $2,
          reviewed_by = $3,
          reviewed_at = now(),
          review_comment = $4
        WHERE id = (
          SELECT id
          FROM commercial_quotes
          WHERE opportunity_id = $1
            AND status = 'pending'
          ORDER BY version_no DESC, submitted_at DESC, id DESC
          LIMIT 1
        )
        RETURNING *
      `, [
        input.opportunityId,
        input.status,
        input.reviewedBy,
        input.reviewComment
      ]);
      return mapQuoteRow(result.rows[0]);
    }
  };
}
