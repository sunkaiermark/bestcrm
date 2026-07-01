import { Router } from 'express';
import { SALES_WORK_ACTIVITY_TYPES } from '../domain/salesWork.mjs';
import { ROLES, hasRole } from '../domain/roles.mjs';
import { requireLogin } from '../middleware/auth.mjs';
import {
  canAccessSalesWork,
  canMaintainSalesWorkRecord,
  createSalesWorkPlan,
  listSalesWorkPlans,
  updateSalesWorkPlan,
  updateSalesWorkPlanStatus
} from '../services/salesWorkService.mjs';

function forbidden(res) {
  res.status(403).send('Forbidden');
}

function customerFilter(user) {
  return hasRole(user, ROLES.ADMINISTRATOR) ? {} : { ownerUserId: user.id };
}

function opportunityFilter(user) {
  return hasRole(user, ROLES.ADMINISTRATOR) || hasRole(user, ROLES.SALES_MANAGER)
    ? {}
    : { visibleToUserId: user.id };
}

function salesWorkListFilter(query) {
  const filter = {};
  for (const key of ['salespersonUserId', 'dateFrom', 'dateTo', 'status', 'customerId', 'contactId', 'opportunityId', 'activityType']) {
    if (query[key]) {
      filter[key] = key.endsWith('Id') ? Number(query[key]) : query[key];
    }
  }
  return filter;
}

async function loadPlanOrRespond(repository, req, res) {
  const plan = await repository.findPlanById(req.params.id);
  if (!plan) {
    res.status(404).send('Sales work plan not found');
    return null;
  }
  if (!canMaintainSalesWorkRecord(req.currentUser, plan)) {
    forbidden(res);
    return null;
  }
  return plan;
}

async function loadFormOptions({ customerRepository, contactRepository, opportunityRepository }, user) {
  const filter = customerFilter(user);
  const [customers, contacts, opportunities] = await Promise.all([
    customerRepository.listCustomers(filter),
    contactRepository.listContacts(filter),
    opportunityRepository.listOpportunities(opportunityFilter(user))
  ]);
  return { customers, contacts, opportunities };
}

function renderPlanForm(res, data) {
  res.render('sales-work/plan-form', {
    activityTypes: SALES_WORK_ACTIVITY_TYPES,
    ...data
  });
}

function handleSalesWorkError(error, res, next) {
  if (error.message === 'Forbidden') {
    forbidden(res);
    return;
  }
  if (['Customer not found', 'Contact not found', 'Opportunity not found'].includes(error.message)) {
    res.status(404).send(error.message);
    return;
  }
  if (error.message === 'Contact does not belong to customer') {
    res.status(400).send(error.message);
    return;
  }
  next(error);
}

export function salesWorkRoutes({ salesWorkRepository, customerRepository, contactRepository, opportunityRepository }) {
  const router = Router();

  router.use('/sales-work', requireLogin);
  router.use('/sales-work', (req, res, next) => {
    if (!canAccessSalesWork(req.currentUser)) {
      forbidden(res);
      return;
    }
    next();
  });

  router.get('/sales-work', (req, res) => {
    res.redirect('/sales-work/plans');
  });

  router.get('/sales-work/plans', async (req, res, next) => {
    try {
      const plans = await listSalesWorkPlans(salesWorkRepository, req.currentUser, salesWorkListFilter(req.query));
      res.render('sales-work/plans', { plans });
    } catch (error) {
      handleSalesWorkError(error, res, next);
    }
  });

  router.get('/sales-work/plans/new', async (req, res, next) => {
    try {
      const options = await loadFormOptions({ customerRepository, contactRepository, opportunityRepository }, req.currentUser);
      renderPlanForm(res, {
        plan: {},
        action: '/sales-work/plans',
        ...options
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/sales-work/plans', async (req, res, next) => {
    try {
      await createSalesWorkPlan({
        salesWorkRepository,
        customerRepository,
        contactRepository,
        opportunityRepository
      }, req.currentUser, req.body);
      res.redirect('/sales-work/plans');
    } catch (error) {
      handleSalesWorkError(error, res, next);
    }
  });

  router.get('/sales-work/plans/:id/edit', async (req, res, next) => {
    try {
      const plan = await loadPlanOrRespond(salesWorkRepository, req, res);
      if (!plan) {
        return;
      }
      const options = await loadFormOptions({ customerRepository, contactRepository, opportunityRepository }, req.currentUser);
      renderPlanForm(res, {
        plan,
        action: `/sales-work/plans/${plan.id}`,
        ...options
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/sales-work/plans/:id', async (req, res, next) => {
    try {
      const plan = await loadPlanOrRespond(salesWorkRepository, req, res);
      if (!plan) {
        return;
      }
      await updateSalesWorkPlan({
        salesWorkRepository,
        customerRepository,
        contactRepository,
        opportunityRepository
      }, req.currentUser, plan, req.body);
      res.redirect('/sales-work/plans');
    } catch (error) {
      handleSalesWorkError(error, res, next);
    }
  });

  router.post('/sales-work/plans/:id/complete', async (req, res, next) => {
    try {
      const plan = await loadPlanOrRespond(salesWorkRepository, req, res);
      if (!plan) {
        return;
      }
      await updateSalesWorkPlanStatus(salesWorkRepository, req.currentUser, plan, {
        status: 'completed',
        resultSummary: req.body.resultSummary,
        nextStep: req.body.nextStep
      });
      res.redirect('/sales-work/plans');
    } catch (error) {
      handleSalesWorkError(error, res, next);
    }
  });

  router.post('/sales-work/plans/:id/cancel', async (req, res, next) => {
    try {
      const plan = await loadPlanOrRespond(salesWorkRepository, req, res);
      if (!plan) {
        return;
      }
      await updateSalesWorkPlanStatus(salesWorkRepository, req.currentUser, plan, {
        status: 'cancelled',
        resultSummary: req.body.resultSummary,
        nextStep: req.body.nextStep
      });
      res.redirect('/sales-work/plans');
    } catch (error) {
      handleSalesWorkError(error, res, next);
    }
  });

  return router;
}
