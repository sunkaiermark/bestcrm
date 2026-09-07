import { Router } from 'express';
import { CUSTOMER_COUNTRIES } from '../domain/customerCountries.mjs';
import { CUSTOMER_INDUSTRIES } from '../domain/customerIndustries.mjs';
import { CUSTOMER_REGIONS } from '../domain/customerRegions.mjs';
import { ENTERPRISE_NATURES } from '../domain/enterpriseNatures.mjs';
import { ROLES, hasRole } from '../domain/roles.mjs';
import { requireLogin } from '../middleware/auth.mjs';
import {
  archiveCustomer,
  canArchiveCustomer,
  canMaintainCustomer,
  createCustomer,
  DuplicateCustomerError,
  reopenCustomer,
  updateCustomer
} from '../services/customerService.mjs';

const archiveScopes = new Set(['active', 'archived', 'all']);

function archiveScope(value) {
  return archiveScopes.has(value) ? value : 'active';
}

function customerFilter(user) {
  return hasRole(user, ROLES.ADMINISTRATOR) ? {} : { ownerUserId: user.id };
}

function customerFormLocals({ customer = {}, action = '/customers', duplicateCustomers = [] } = {}) {
  return {
    customer,
    duplicateCustomers,
    countryOptions: CUSTOMER_COUNTRIES,
    industryOptions: CUSTOMER_INDUSTRIES,
    enterpriseNatureOptions: ENTERPRISE_NATURES,
    regionOptions: CUSTOMER_REGIONS,
    action
  };
}

export function customerRoutes({ customerRepository }) {
  const router = Router();

  router.use('/customers', requireLogin);

  router.get('/customers', async (req, res, next) => {
    try {
      const searchTerm = String(req.query.q || '').trim();
      const selectedArchiveScope = archiveScope(req.query.archiveScope);
      const customers = await customerRepository.listCustomers({
        ...customerFilter(req.currentUser),
        searchTerm,
        archiveScope: selectedArchiveScope
      });
      res.render('customers/index', { customers, filters: { searchTerm, archiveScope: selectedArchiveScope } });
    } catch (error) {
      next(error);
    }
  });

  router.get('/customers/new', (req, res) => {
    res.render('customers/form', customerFormLocals());
  });

  router.post('/customers', async (req, res, next) => {
    try {
      const customer = await createCustomer(customerRepository, req.currentUser, req.body);
      res.redirect(`/customers/${customer.id}`);
    } catch (error) {
      if (error instanceof DuplicateCustomerError) {
        res.status(409).render('customers/form', customerFormLocals({
          customer: req.body,
          duplicateCustomers: error.duplicates
        }));
        return;
      }
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
      res.render('customers/detail', {
        customer,
        canArchiveCustomer: canArchiveCustomer(req.currentUser) && !customer.archivedAt,
        canReopenCustomer: canArchiveCustomer(req.currentUser) && Boolean(customer.archivedAt) && !customer.mergedIntoId
      });
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
      if (customer.archivedAt) {
        res.status(409).send('Customer is archived');
        return;
      }
      res.render('customers/form', customerFormLocals({ customer, action: `/customers/${customer.id}` }));
    } catch (error) {
      next(error);
    }
  });

  router.post('/customers/:id', async (req, res, next) => {
    try {
      const customer = await updateCustomer(customerRepository, req.currentUser, req.params.id, req.body);
      res.redirect(`/customers/${customer.id}`);
    } catch (error) {
      if (error instanceof DuplicateCustomerError) {
        res.status(409).render('customers/form', customerFormLocals({
          customer: { id: req.params.id, ...req.body },
          duplicateCustomers: error.duplicates,
          action: `/customers/${req.params.id}`
        }));
        return;
      }
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

  router.post('/customers/:id/archive', async (req, res, next) => {
    try {
      await archiveCustomer(customerRepository, req.currentUser, req.params.id, req.body.reason);
      res.redirect('/customers');
    } catch (error) {
      if (error.message === 'Forbidden') {
        res.status(403).send('Forbidden');
        return;
      }
      if (error.message === 'Customer not found or already archived') {
        res.status(404).send('Customer not found');
        return;
      }
      if (error.message === 'Archive reason is required') {
        res.status(400).send(error.message);
        return;
      }
      next(error);
    }
  });

  router.post('/customers/:id/reopen', async (req, res, next) => {
    try {
      await reopenCustomer(customerRepository, req.currentUser, req.params.id, req.body.reason);
      res.redirect(`/customers/${req.params.id}`);
    } catch (error) {
      if (error.message === 'Forbidden') {
        res.status(403).send('Forbidden');
        return;
      }
      if (error.message === 'Customer not found or not archived') {
        res.status(404).send('Customer not found');
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
