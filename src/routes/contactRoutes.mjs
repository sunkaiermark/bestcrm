import { Router } from 'express';
import { ROLES, hasRole } from '../domain/roles.mjs';
import { requireLogin } from '../middleware/auth.mjs';
import { normalizeCustomerContactListQuery } from '../utils/customerContactListQuery.mjs';
import { canMaintainContact, canViewContact } from '../services/customerService.mjs';
import {
  archiveContact,
  canArchiveContact,
  createContact,
  DuplicateContactError,
  reopenContact,
  updateContact
} from '../services/contactService.mjs';

function normalizedReturnTo(value) {
  return value === 'opportunity-initiation' ? value : '';
}

function contactCreateRedirect(contact, returnTo) {
  if (returnTo === 'opportunity-initiation') {
    const params = new URLSearchParams({
      customerId: String(contact.customerId),
      contactId: String(contact.id)
    });
    return `/opportunities/new?${params.toString()}`;
  }
  return `/contacts/${contact.id}`;
}

function contactFormLocals({
  contact = {},
  customers = [],
  action = '/contacts',
  returnTo = '',
  duplicateContacts = [],
  hasRestrictedDuplicate = false
} = {}) {
  return {
    contact,
    customers,
    action,
    returnTo,
    duplicateContacts,
    hasRestrictedDuplicate
  };
}

function customerMasterScope(user) {
  return hasRole(user, ROLES.ADMINISTRATOR)
    ? {}
    : { coordinatorUserId: Number(user.id) };
}

function duplicateContactState(user, duplicates = []) {
  const visibleDuplicates = duplicates.filter((contact) => canViewContact(user, contact));
  return {
    duplicateContacts: visibleDuplicates,
    hasRestrictedDuplicate: visibleDuplicates.length !== duplicates.length
  };
}

export function contactRoutes({ customerRepository, contactRepository }) {
  const router = Router();

  router.use('/contacts', requireLogin);

  router.get('/contacts', async (req, res, next) => {
    try {
      const mayFilterByCoordinator = hasRole(req.currentUser, ROLES.ADMINISTRATOR);
      const filters = normalizeCustomerContactListQuery(req.query);
      if (!mayFilterByCoordinator) filters.salespersonId = null;
      const listFilter = {
        searchTerm: filters.searchTerm,
        archiveScope: filters.archiveScope,
        ...customerMasterScope(req.currentUser)
      };
      if (filters.salespersonId) listFilter.coordinatorUserId = filters.salespersonId;
      if (filters.customerId) listFilter.customerId = filters.customerId;
      if (filters.country) listFilter.country = filters.country;
      const [contacts, filterOptions] = await Promise.all([
        contactRepository.listContacts(listFilter),
        typeof customerRepository.listCustomerFilterOptions === 'function'
          ? customerRepository.listCustomerFilterOptions({
              archiveScope: 'all',
              ...customerMasterScope(req.currentUser)
            })
          : { salesOwners: [], customers: [], countries: [] }
      ]);
      res.render('contacts/index', {
        contacts,
        filters,
        filterOptions,
        showSalesOwnerFilter: mayFilterByCoordinator,
        showCoordinatorFilter: mayFilterByCoordinator
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/contacts/new', async (req, res, next) => {
    try {
      const customers = await customerRepository.listCustomers(customerMasterScope(req.currentUser));
      res.render('contacts/form', contactFormLocals({
        contact: {
          customerId: req.query.customerId || customers[0]?.id || ''
        },
        customers,
        returnTo: normalizedReturnTo(req.query.returnTo),
        action: '/contacts'
      }));
    } catch (error) {
      next(error);
    }
  });

  router.post('/contacts', async (req, res, next) => {
    try {
      const contact = await createContact({ customerRepository, contactRepository }, req.currentUser, req.body);
      res.redirect(contactCreateRedirect(contact, normalizedReturnTo(req.body.returnTo)));
    } catch (error) {
      if (error instanceof DuplicateContactError) {
        const customers = await customerRepository.listCustomers(customerMasterScope(req.currentUser));
        res.status(409).render('contacts/form', contactFormLocals({
          contact: req.body,
          customers,
          returnTo: normalizedReturnTo(req.body.returnTo),
          ...duplicateContactState(req.currentUser, error.duplicates)
        }));
        return;
      }
      if (error.message === 'Forbidden' || error.message === 'Customer not found') {
        res.status(404).send('Customer not found');
        return;
      }
      next(error);
    }
  });

  router.get('/contacts/:id', async (req, res, next) => {
    try {
      const contact = await contactRepository.getContactDetail(req.params.id);
      if (!contact) {
        res.status(404).send('Contact not found');
        return;
      }
      if (!canViewContact(req.currentUser, contact)) {
        res.status(404).send('Contact not found');
        return;
      }
      res.render('contacts/detail', {
        contact,
        canEditContact: canMaintainContact(req.currentUser, contact) && !contact.archivedAt,
        canArchiveContact: canArchiveContact(req.currentUser) && !contact.archivedAt,
        canReopenContact: canArchiveContact(req.currentUser) && Boolean(contact.archivedAt) && !contact.mergedIntoId
      });
    } catch (error) {
      next(error);
    }
  });

  router.get('/contacts/:id/edit', async (req, res, next) => {
    try {
      const contact = await contactRepository.getContactDetail(req.params.id);
      if (!contact) {
        res.status(404).send('Contact not found');
        return;
      }
      if (!canMaintainContact(req.currentUser, contact)) {
        res.status(404).send('Contact not found');
        return;
      }
      if (contact.archivedAt) {
        res.status(409).send('Contact is archived');
        return;
      }
      const customers = await customerRepository.listCustomers(customerMasterScope(req.currentUser));
      res.render('contacts/form', contactFormLocals({ contact, customers, action: `/contacts/${contact.id}` }));
    } catch (error) {
      next(error);
    }
  });

  router.post('/contacts/:id', async (req, res, next) => {
    try {
      const contact = await updateContact(contactRepository, req.currentUser, req.params.id, req.body);
      res.redirect(`/contacts/${contact.id}`);
    } catch (error) {
      if (error instanceof DuplicateContactError) {
        const [existing, customers] = await Promise.all([
          contactRepository.getContactDetail(req.params.id),
          customerRepository.listCustomers(customerMasterScope(req.currentUser))
        ]);
        res.status(409).render('contacts/form', contactFormLocals({
          contact: {
            ...existing,
            ...req.body,
            id: Number(req.params.id),
            customerId: existing?.customerId || req.body.customerId
          },
          customers,
          action: `/contacts/${req.params.id}`,
          ...duplicateContactState(req.currentUser, error.duplicates)
        }));
        return;
      }
      if (error.message === 'Forbidden') {
        res.status(404).send('Contact not found');
        return;
      }
      if (error.message === 'Contact not found') {
        res.status(404).send('Contact not found');
        return;
      }
      next(error);
    }
  });

  router.post('/contacts/:id/archive', async (req, res, next) => {
    try {
      await archiveContact(contactRepository, req.currentUser, req.params.id, req.body.reason);
      res.redirect('/contacts');
    } catch (error) {
      if (error.message === 'Forbidden') {
        res.status(403).send('Forbidden');
        return;
      }
      if (error.message === 'Contact not found or already archived') {
        res.status(404).send('Contact not found');
        return;
      }
      if (error.message === 'Archive reason is required') {
        res.status(400).send(error.message);
        return;
      }
      next(error);
    }
  });

  router.post('/contacts/:id/reopen', async (req, res, next) => {
    try {
      await reopenContact(contactRepository, req.currentUser, req.params.id, req.body.reason);
      res.redirect(`/contacts/${req.params.id}`);
    } catch (error) {
      if (error.message === 'Forbidden') {
        res.status(403).send('Forbidden');
        return;
      }
      if (error.message === 'Contact not found or not archived') {
        res.status(404).send('Contact not found');
        return;
      }
      if (error.message === 'Reopen reason is required') {
        res.status(400).send(error.message);
        return;
      }
      next(error);
    }
  });

  return router;
}
