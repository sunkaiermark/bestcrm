import { Router } from 'express';
import { ROLES, hasRole } from '../domain/roles.mjs';
import { requireLogin } from '../middleware/auth.mjs';
import { canMaintainContact } from '../services/customerService.mjs';
import { canDeleteContact, createContact, deleteContact, updateContact } from '../services/contactService.mjs';

function contactFilter(user) {
  return hasRole(user, ROLES.ADMINISTRATOR) ? {} : { ownerUserId: user.id };
}

export function contactRoutes({ customerRepository, contactRepository }) {
  const router = Router();

  router.use('/contacts', requireLogin);

  router.get('/contacts', async (req, res, next) => {
    try {
      const contacts = await contactRepository.listContacts(contactFilter(req.currentUser));
      res.render('contacts/index', { contacts });
    } catch (error) {
      next(error);
    }
  });

  router.get('/contacts/new', async (req, res, next) => {
    try {
      const customers = await customerRepository.listCustomers(contactFilter(req.currentUser));
      res.render('contacts/form', { contact: {}, customers, action: '/contacts' });
    } catch (error) {
      next(error);
    }
  });

  router.post('/contacts', async (req, res, next) => {
    try {
      const contact = await createContact({ customerRepository, contactRepository }, req.currentUser, req.body);
      res.redirect(`/contacts/${contact.id}`);
    } catch (error) {
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
      res.render('contacts/form', { contact, customers, action: `/contacts/${contact.id}` });
    } catch (error) {
      next(error);
    }
  });

  router.post('/contacts/:id', async (req, res, next) => {
    try {
      const contact = await updateContact(contactRepository, req.currentUser, req.params.id, req.body);
      res.redirect(`/contacts/${contact.id}`);
    } catch (error) {
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
