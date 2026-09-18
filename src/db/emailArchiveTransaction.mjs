import { createEmailArchiveRepository } from '../repositories/emailArchiveRepository.mjs';
import { createContactRepository } from '../repositories/contactRepository.mjs';
import { createCustomerRepository } from '../repositories/customerRepository.mjs';
import { createInquiryRepository } from '../repositories/inquiryRepository.mjs';
import { createOpportunityRepository } from '../repositories/opportunityRepository.mjs';
import { createQuotationPackageRepository } from '../repositories/quotationPackageRepository.mjs';
import { createUserRepository } from '../repositories/userRepository.mjs';

export function createEmailArchiveTransaction(pool) {
  return async function emailArchiveTransaction(callback) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await callback({
        emailArchiveRepository: createEmailArchiveRepository(client),
        contactRepository: createContactRepository(client),
        customerRepository: createCustomerRepository(client),
        inquiryRepository: createInquiryRepository(client),
        opportunityRepository: createOpportunityRepository(client),
        userRepository: createUserRepository(client),
        quotationPackageRepository: createQuotationPackageRepository(client)
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
