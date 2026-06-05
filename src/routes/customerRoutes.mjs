import { Router } from 'express';
import { ROLES, hasRole } from '../domain/roles.mjs';
import { requireLogin } from '../middleware/auth.mjs';
import { canMaintainCustomer, createCustomer, updateCustomer } from '../services/customerService.mjs';

function customerFilter(user) {
  return hasRole(user, ROLES.ADMINISTRATOR) ? {} : { ownerUserId: user.id };
}

export function customerRoutes({ customerRepository }) {
  const router = Router();

  router.use('/customers', requireLogin);

  router.get('/customers', async (req, res, next) => {
    try {
      const customers = await customerRepository.listCustomers(customerFilter(req.currentUser));
      res.render('customers/index', { customers });
    } catch (error) {
      next(error);
    }
  });

  router.get('/customers/new', (req, res) => {
    res.render('customers/form', { customer: {}, action: '/customers' });
  });

  router.post('/customers', async (req, res, next) => {
    try {
      const customer = await createCustomer(customerRepository, req.currentUser, req.body);
      res.redirect(`/customers/${customer.id}`);
    } catch (error) {
      next(error);
    }
  });

  router.get('/customers/:id', async (req, res, next) => {
    try {
      const customer = await customerRepository.getCustomerDetail(req.params.id);
      if (!customer) {
        res.status(404).send('Customer not found');
        return;
      }
      if (!canMaintainCustomer(req.currentUser, customer)) {
        res.status(403).send('Forbidden');
        return;
      }
      res.render('customers/detail', { customer });
    } catch (error) {
      next(error);
    }
  });

  router.get('/customers/:id/edit', async (req, res, next) => {
    try {
      const customer = await customerRepository.getCustomerDetail(req.params.id);
      if (!customer) {
        res.status(404).send('Customer not found');
        return;
      }
      if (!canMaintainCustomer(req.currentUser, customer)) {
        res.status(403).send('Forbidden');
        return;
      }
      res.render('customers/form', { customer, action: `/customers/${customer.id}` });
    } catch (error) {
      next(error);
    }
  });

  router.post('/customers/:id', async (req, res, next) => {
    try {
      const customer = await updateCustomer(customerRepository, req.currentUser, req.params.id, req.body);
      res.redirect(`/customers/${customer.id}`);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
