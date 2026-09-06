import { Router } from 'express';
import { ROLES, hasRole } from '../domain/roles.mjs';
import { requireLogin } from '../middleware/auth.mjs';
import { canMaintainContact } from '../services/customerService.mjs';
import { DuplicateContactError, canDeleteContact, createContact, deleteContact, updateContact } from '../services/contactService.mjs';

function contactFilter(user) {
  return hasRole(user, ROLES.ADMINISTRATOR) ? {} : { ownerUserId: user.id };
}

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
  duplicateContacts = []
} = {}) {
  return { contact, customers, action, returnTo, duplicateContacts };
}

export function contactRoutes({ customerRepository, contactRepository }) {
  const router = Router();

  router.use('/contacts', requireLogin);

  router.get('/contacts', async (req, res, next) => {
    try {
      const searchTerm = String(req.query.q || '').trim();
      const contacts = await contactRepository.listContacts({
        ...contactFilter(req.currentUser),
        searchTerm
      });
      res.render('contacts/index', { contacts, filters: { searchTerm } });
    } catch (error) {
      next(error);
    }
  });

  router.get('/contacts/new', async (req, res, next) => {
    try {
      const customers = await customerRepository.listCustomers(contactFilter(req.currentUser));
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
        const customers = await customerRepository.listCustomers(contactFilter(req.currentUser));
        res.status(409).render('contacts/form', contactFormLocals({
          contact: req.body,
          customers,
          returnTo: normalizedReturnTo(req.body.returnTo),
          duplicateContacts: error.duplicates
        }));
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
      if (!canMaintainContact(req.currentUser, contact)) {
        res.status(403).send('Forbidden');
        return;
      }
      res.render('contacts/detail', { contact, canDeleteContact: canDeleteContact(req.currentUser) });
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
        res.status(403).send('Forbidden');
        return;
      }
      const customers = await customerRepository.listCustomers(contactFilter(req.currentUser));
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
          customerRepository.listCustomers(contactFilter(req.currentUser))
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
          duplicateContacts: error.duplicates
        }));
        return;
      }
      if (error.message === 'Forbidden') {
        res.status(403).send('Forbidden');
        return;
      }
      if (error.message === 'Contact not found') {
        res.status(404).send('Contact not found');
        return;
      }
      next(error);
    }
  });

  router.post('/contacts/:id/delete', async (req, res, next) => {
    try {
      await deleteContact(contactRepository, req.currentUser, req.params.id);
      res.redirect('/contacts');
    } catch (error) {
      if (error.message === 'Forbidden') {
        res.status(403).send('Forbidden');
        return;
      }
      if (error.message === 'Contact not found') {
        res.status(404).send('Contact not found');
        return;
      }
      if (error.code === '23503') {
        res.status(409).send('Cannot delete contact because it is linked to existing opportunities.');
        return;
      }
      next(error);
    }
  });

  return router;
}
