import { Router } from 'express';
import { CUSTOMER_COUNTRIES } from '../domain/customerCountries.mjs';
import { CUSTOMER_INDUSTRIES } from '../domain/customerIndustries.mjs';
import { CUSTOMER_REGIONS } from '../domain/customerRegions.mjs';
import { ENTERPRISE_NATURES } from '../domain/enterpriseNatures.mjs';
import { ROLES, hasRole } from '../domain/roles.mjs';
import { requireLogin } from '../middleware/auth.mjs';
import { normalizeCustomerContactListQuery } from '../utils/customerContactListQuery.mjs';
import {
  archiveCustomer,
  canArchiveCustomer,
  canMaintainCustomer,
  canViewCustomer,
  changeCustomerCoordinator,
  createCustomer,
  DuplicateCustomerError,
  reopenCustomer,
  updateCustomer
} from '../services/customerService.mjs';

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

export function customerRoutes({ customerRepository, opportunityRepository, userRepository }) {
  const router = Router();

  router.use('/customers', requireLogin);

  router.get('/customers', async (req, res, next) => {
    try {
      const mayFilterByCoordinator = hasRole(req.currentUser, ROLES.ADMINISTRATOR)
        || hasRole(req.currentUser, ROLES.SALES_MANAGER);
      const filters = normalizeCustomerContactListQuery(req.query);
      if (!mayFilterByCoordinator) filters.salespersonId = null;
      const listFilter = {
        searchTerm: filters.searchTerm,
        archiveScope: filters.archiveScope
      };
      if (filters.salespersonId) listFilter.coordinatorUserId = filters.salespersonId;
      if (filters.customerId) listFilter.customerId = filters.customerId;
      if (filters.country) listFilter.country = filters.country;
      const [customers, filterOptions] = await Promise.all([
        customerRepository.listCustomers(listFilter),
        typeof customerRepository.listCustomerFilterOptions === 'function'
          ? customerRepository.listCustomerFilterOptions({ archiveScope: filters.archiveScope })
          : { salesOwners: [], customers: [], countries: [] }
      ]);
      res.render('customers/index', {
        customers,
        filters,
        filterOptions,
        showSalesOwnerFilter: mayFilterByCoordinator,
        showCoordinatorFilter: mayFilterByCoordinator
      });
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
      if (!canViewCustomer(req.currentUser, customer)) {
        res.status(403).send('Forbidden');
        return;
      }
      const mayManageCoordinator = hasRole(req.currentUser, ROLES.ADMINISTRATOR)
        || hasRole(req.currentUser, ROLES.SALES_MANAGER);
      const opportunityFilter = {
        customerId: customer.id,
        archiveScope: 'active',
        ...(hasRole(req.currentUser, ROLES.ADMINISTRATOR)
          ? {}
          : { visibleToUserId: req.currentUser.id })
      };
      const [opportunities, coordinationEvents, coordinators] = await Promise.all([
        typeof opportunityRepository?.listOpportunities === 'function'
          ? opportunityRepository.listOpportunities(opportunityFilter)
          : [],
        typeof customerRepository.listCoordinationEvents === 'function'
          ? customerRepository.listCoordinationEvents(customer.id)
          : [],
        mayManageCoordinator && typeof userRepository?.listUsersByRole === 'function'
          ? userRepository.listUsersByRole(ROLES.SALESPERSON)
          : []
      ]);
      res.render('customers/detail', {
        customer,
        opportunities,
        coordinationEvents,
        coordinators,
        canEditCustomer: canMaintainCustomer(req.currentUser, customer) && !customer.archivedAt,
        canManageCoordinator: mayManageCoordinator && !customer.archivedAt,
        canArchiveCustomer: canArchiveCustomer(req.currentUser) && !customer.archivedAt,
        canReopenCustomer: canArchiveCustomer(req.currentUser) && Boolean(customer.archivedAt) && !customer.mergedIntoId
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/customers/:id/coordinator', async (req, res, next) => {
    try {
      await changeCustomerCoordinator(
        { customerRepository, userRepository },
        req.currentUser,
        req.params.id,
        req.body
      );
      res.redirect(`/customers/${req.params.id}`);
    } catch (error) {
      if (error.message === 'Forbidden') {
        res.status(403).send('Forbidden');
        return;
      }
      if (error.message === 'Customer not found') {
        res.status(404).send(error.message);
        return;
      }
      if (/required|different|active salesperson|archived/.test(error.message)) {
        res.status(400).send(error.message);
        return;
      }
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
