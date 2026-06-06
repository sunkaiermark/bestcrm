import { createAttachmentRepository } from '../repositories/attachmentRepository.mjs';
import { createApprovalSettingRepository } from '../repositories/approvalSettingRepository.mjs';
import { createCommercialQuoteRepository } from '../repositories/commercialQuoteRepository.mjs';
import { createContractApprovalRepository } from '../repositories/contractApprovalRepository.mjs';
import { createOpportunityRepository } from '../repositories/opportunityRepository.mjs';
import { createTechnicalSolutionRepository } from '../repositories/technicalSolutionRepository.mjs';
import { createTodoRepository } from '../repositories/todoRepository.mjs';
import { createWorkflowEventRepository } from '../repositories/workflowEventRepository.mjs';

function createWorkflowRepositories(queryTarget) {
  return {
    attachmentRepository: createAttachmentRepository(queryTarget),
    approvalSettingRepository: createApprovalSettingRepository(queryTarget),
    commercialQuoteRepository: createCommercialQuoteRepository(queryTarget),
    contractApprovalRepository: createContractApprovalRepository(queryTarget),
    opportunityRepository: createOpportunityRepository(queryTarget),
    technicalSolutionRepository: createTechnicalSolutionRepository(queryTarget),
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
