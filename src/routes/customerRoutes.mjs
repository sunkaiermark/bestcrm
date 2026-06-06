import { Router } from 'express';
import { CUSTOMER_COUNTRIES } from '../domain/customerCountries.mjs';
import { CUSTOMER_REGIONS } from '../domain/customerRegions.mjs';
import { ROLES, hasRole } from '../domain/roles.mjs';
import { requireLogin } from '../middleware/auth.mjs';
import { canDeleteCustomer, canMaintainCustomer, createCustomer, deleteCustomer, updateCustomer } from '../services/customerService.mjs';

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
    res.render('customers/form', {
      customer: {},
      countryOptions: CUSTOMER_COUNTRIES,
      regionOptions: CUSTOMER_REGIONS,
      action: '/customers'
    });
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
      res.render('customers/detail', { customer, canDeleteCustomer: canDeleteCustomer(req.currentUser) });
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
      res.render('customers/form', {
        customer,
        countryOptions: CUSTOMER_COUNTRIES,
        regionOptions: CUSTOMER_REGIONS,
        action: `/customers/${customer.id}`
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/customers/:id', async (req, res, next) => {
    try {
      const customer = await updateCustomer(customerRepository, req.currentUser, req.params.id, req.body);
      res.redirect(`/customers/${customer.id}`);
    } catch (error) {
      if (error.message === 'Forbidden') {
        res.status(403).send('Forbidden');
        return;
      }
      if (error.message === 'Customer not found') {
        res.status(404).send('Customer not found');
        return;
      }
      next(error);
    }
  });

  router.post('/customers/:id/delete', async (req, res, next) => {
    try {
      await deleteCustomer(customerRepository, req.currentUser, req.params.id);
      res.redirect('/customers');
    } catch (error) {
      if (error.message === 'Forbidden') {
        res.status(403).send('Forbidden');
        return;
      }
      if (error.message === 'Customer not found') {
        res.status(404).send('Customer not found');
        return;
      }
      if (error.code === '23503') {
        res.status(409).send('Cannot delete customer because it is linked to existing opportunities.');
        return;
      }
      next(error);
    }
  });

  return router;
}
