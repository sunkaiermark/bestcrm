import { createAttachmentRepository } from '../repositories/attachmentRepository.mjs';
import { createApprovalSettingRepository } from '../repositories/approvalSettingRepository.mjs';
import { createBidContentBlockRepository } from '../repositories/bidContentBlockRepository.mjs';
import { createBidWorkspaceRepository } from '../repositories/bidWorkspaceRepository.mjs';
import { createCommercialQuoteRepository } from '../repositories/commercialQuoteRepository.mjs';
import { createCommercialPackageTemplateRepository } from '../repositories/commercialPackageTemplateRepository.mjs';
import { createContractApprovalRepository } from '../repositories/contractApprovalRepository.mjs';
import { createOpportunityMaterialVersionRepository } from '../repositories/opportunityMaterialVersionRepository.mjs';
import { createOpportunityCommercialDraftRepository } from '../repositories/opportunityCommercialDraftRepository.mjs';
import { createOpportunityRepository } from '../repositories/opportunityRepository.mjs';
import { createOpportunityTechnicalDraftRepository } from '../repositories/opportunityTechnicalDraftRepository.mjs';
import { createQuotationPackageRepository } from '../repositories/quotationPackageRepository.mjs';
import { createTechnicalSolutionRepository } from '../repositories/technicalSolutionRepository.mjs';
import { createTechnicalTemplateRepository } from '../repositories/technicalTemplateRepository.mjs';
import { createTodoRepository } from '../repositories/todoRepository.mjs';
import { createWorkflowEventRepository } from '../repositories/workflowEventRepository.mjs';

function createWorkflowRepositories(queryTarget) {
  return {
    attachmentRepository: createAttachmentRepository(queryTarget),
    approvalSettingRepository: createApprovalSettingRepository(queryTarget),
    bidContentBlockRepository: createBidContentBlockRepository(queryTarget),
    bidWorkspaceRepository: createBidWorkspaceRepository(queryTarget),
    commercialQuoteRepository: createCommercialQuoteRepository(queryTarget),
    commercialPackageTemplateRepository: createCommercialPackageTemplateRepository(queryTarget),
    contractApprovalRepository: createContractApprovalRepository(queryTarget),
    opportunityMaterialVersionRepository: createOpportunityMaterialVersionRepository(queryTarget),
    opportunityCommercialDraftRepository: createOpportunityCommercialDraftRepository(queryTarget),
    opportunityRepository: createOpportunityRepository(queryTarget),
    opportunityTechnicalDraftRepository: createOpportunityTechnicalDraftRepository(queryTarget),
    quotationPackageRepository: createQuotationPackageRepository(queryTarget),
    technicalSolutionRepository: createTechnicalSolutionRepository(queryTarget),
    technicalTemplateRepository: createTechnicalTemplateRepository(queryTarget),
    todoRepository: createTodoRepository(queryTarget),
    workflowEventRepository: createWorkflowEventRepository(queryTarget)
  };
}

export function createWorkflowTransaction(pool) {
  return async function workflowTransaction(callback) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await callback(createWorkflowRepositories(client));
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  };
}
