function mapQuoteRow(row, input) {
  return {
    id: Number(row.id),
    opportunityId: input.opportunityId,
    totalPrice: input.totalPrice,
    paymentTerms: input.paymentTerms,
    validityDate: input.validityDate,
    remarks: input.remarks,
    submittedBy: input.submittedBy,
    submittedAt: row.submitted_at,
    items: input.items
  };
}

export function createCommercialQuoteRepository(queryTarget) {
  return {
    async createQuote(input) {
      const quoteResult = await queryTarget.query(`
        INSERT INTO commercial_quotes (
          opportunity_id,
          total_price,
          payment_terms,
          validity_date,
          remarks,
          submitted_by
        )
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, submitted_at
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

      return mapQuoteRow(quoteResult.rows[0], input);
    }
  };
}
