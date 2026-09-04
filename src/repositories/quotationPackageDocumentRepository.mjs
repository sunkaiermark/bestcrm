function numberOrNull(value) {
  return value === null || value === undefined ? null : Number(value);
}

function mapDocument(row, includeContent = false) {
  if (!row) return null;
  const item = {
    id: Number(row.id),
    quotationPackageVersionId: Number(row.quotation_package_version_id),
    workspaceId: Number(row.workspace_id),
    technicalSolutionVersionId: Number(row.technical_solution_version_id),
    commercialDraftId: Number(row.commercial_draft_id),
    outputProfileId: Number(row.output_profile_id),
    outputProfileRevisionNo: Number(row.output_profile_revision_no),
    documentType: row.document_type,
    documentNo: row.document_no,
    originalName: row.original_name,
    mimeType: row.mime_type,
    byteSize: Number(row.byte_size),
    sha256: row.sha256,
    sourceSnapshotSha256: row.source_snapshot_sha256,
    generationKey: row.generation_key,
    generatorVersion: row.generator_version,
    generatedBy: Number(row.generated_by),
    generatorDisplayName: row.generator_display_name || '',
    generatedAt: row.generated_at,
    packageStatus: row.package_status || '',
    opportunityId: numberOrNull(row.opportunity_id),
    salespersonId: numberOrNull(row.salesperson_id),
    salesManagerId: numberOrNull(row.sales_manager_id),
    quotationEngineerId: numberOrNull(row.quotation_engineer_id),
    technicalManagerId: numberOrNull(row.technical_manager_id),
    commercialManagerId: numberOrNull(row.commercial_manager_id)
  };
  if (includeContent) item.content = row.content;
  return item;
}

const select = (includeContent = false) => `
  SELECT ${includeContent ? 'document.content,' : ''} document.id,
    document.quotation_package_version_id, document.workspace_id,
    document.technical_solution_version_id, document.commercial_draft_id,
    document.output_profile_id, document.output_profile_revision_no,
    document.document_type, document.document_no, document.original_name,
    document.mime_type, document.byte_size, document.sha256,
    document.source_snapshot_sha256, document.generation_key,
    document.generator_version, document.generated_by, document.generated_at,
    generator.display_name AS generator_display_name,
    package.status AS package_status, package.opportunity_id,
    opportunity.salesperson_id, opportunity.sales_manager_id,
    opportunity.quotation_engineer_id, opportunity.technical_manager_id,
    opportunity.commercial_manager_id
  FROM quotation_package_documents document
  JOIN quotation_package_versions package ON package.id = document.quotation_package_version_id
  JOIN opportunities opportunity ON opportunity.id = package.opportunity_id
  JOIN users generator ON generator.id = document.generated_by
`;

export function createQuotationPackageDocumentRepository(queryTarget) {
  return {
    async lockPackage(packageId) {
      await queryTarget.query('SELECT pg_advisory_xact_lock($1::bigint)', [packageId]);
    },

    async listByPackage(packageId) {
      const result = await queryTarget.query(`
        ${select(false)}
        WHERE document.quotation_package_version_id = $1
        ORDER BY document.id
      `, [packageId]);
      return result.rows.map((row) => mapDocument(row));
    },

    async listByWorkspace(workspaceId) {
      const result = await queryTarget.query(`
        ${select(false)}
        WHERE document.workspace_id = $1
        ORDER BY package.version_no DESC, document.id
      `, [workspaceId]);
      return result.rows.map((row) => mapDocument(row));
    },

    async findById(id) {
      const result = await queryTarget.query(`
        ${select(true)}
        WHERE document.id = $1
        LIMIT 1
      `, [id]);
      return mapDocument(result.rows[0], true);
    },

    async createMany(input) {
      const created = [];
      for (const document of input.documents) {
        const result = await queryTarget.query(`
          INSERT INTO quotation_package_documents (
            quotation_package_version_id, workspace_id,
            technical_solution_version_id, commercial_draft_id,
            output_profile_id, output_profile_revision_no,
            document_type, document_no, original_name, mime_type, content,
            byte_size, sha256, source_snapshot_sha256, generation_key,
            generator_version, generated_by
          ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
            $12, $13, $14, $15, $16, $17
          ) RETURNING *
        `, [
          input.quotationPackageVersionId, input.workspaceId,
          input.technicalSolutionVersionId, input.commercialDraftId,
          input.outputProfileId, input.outputProfileRevisionNo,
          document.documentType, document.documentNo, document.originalName,
          document.mimeType, document.content, document.byteSize, document.sha256,
          input.sourceSnapshotSha256, input.generationKey,
          input.generatorVersion, input.generatedBy
        ]);
        created.push(mapDocument(result.rows[0]));
      }
      return created;
    }
  };
}
