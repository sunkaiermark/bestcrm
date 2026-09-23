import { createEmailArchiveRepository } from '../repositories/emailArchiveRepository.mjs';
import { createAttachmentRepository } from '../repositories/attachmentRepository.mjs';
import { createContactRepository } from '../repositories/contactRepository.mjs';
import { createCustomerRepository } from '../repositories/customerRepository.mjs';
import { createInquiryAttachmentRepository } from '../repositories/inquiryAttachmentRepository.mjs';
import { createInquiryRepository } from '../repositories/inquiryRepository.mjs';
import { createOpportunityRepository } from '../repositories/opportunityRepository.mjs';
import { createOpportunityResponsibilityRepository } from '../repositories/opportunityResponsibilityRepository.mjs';
import { createQuotationPackageRepository } from '../repositories/quotationPackageRepository.mjs';
import { createTodoRepository } from '../repositories/todoRepository.mjs';
import { createUserRepository } from '../repositories/userRepository.mjs';
import { createWorkflowEventRepository } from '../repositories/workflowEventRepository.mjs';

export function createEmailArchiveTransaction(pool) {
  return async function emailArchiveTransaction(callback) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await callback({
        attachmentRepository: createAttachmentRepository(client),
        emailArchiveRepository: createEmailArchiveRepository(client),
        contactRepository: createContactRepository(client),
        customerRepository: createCustomerRepository(client),
        inquiryAttachmentRepository: createInquiryAttachmentRepository(client),
        inquiryRepository: createInquiryRepository(client),
        opportunityRepository: createOpportunityRepository(client),
        opportunityResponsibilityRepository: createOpportunityResponsibilityRepository(client),
        todoRepository: createTodoRepository(client),
        userRepository: createUserRepository(client),
        quotationPackageRepository: createQuotationPackageRepository(client),
        workflowEventRepository: createWorkflowEventRepository(client)
      });
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
