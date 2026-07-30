import { Router } from 'express';
import { CUSTOMER_COUNTRIES } from '../domain/customerCountries.mjs';
import { ROLES, hasRole } from '../domain/roles.mjs';
import { requireLogin } from '../middleware/auth.mjs';
import {
  canAccessInquiryInbox,
  canViewInquiry,
  convertInquiryToOpportunity,
  createInquiry,
  inquiryFormOptions,
  inquiryListFilterFor,
  updateInquiryReview
} from '../services/inquiryService.mjs';

function forbidden(res) {
  res.status(403).send('Forbidden');
}

async function loadInquiryOrSend(inquiryRepository, req, res) {
  const inquiry = await inquiryRepository.findById(req.params.id);
  if (!inquiry) {
    res.status(404).send('Inquiry not found');
    return null;
  }
  if (!canViewInquiry(req.currentUser, inquiry)) {
    forbidden(res);
    return null;
  }
  return inquiry;
}

async function listAssignableUsers(userRepository) {
  if (typeof userRepository?.listUsersWithRoles !== 'function') {
    return [];
  }
  const users = await userRepository.listUsersWithRoles();
  return users.filter((user) => user.isActive !== false);
}

async function loadCrmOptions({ customerRepository, contactRepository, userRepository }, user) {
  const customerFilter = hasRole(user, ROLES.ADMINISTRATOR) || hasRole(user, ROLES.SALES_MANAGER)
    ? {}
    : { ownerUserId: user.id };
  const customers = typeof customerRepository?.listCustomers === 'function'
    ? await customerRepository.listCustomers(customerFilter)
    : [];
  const contacts = typeof contactRepository?.listContacts === 'function'
    ? await contactRepository.listContacts(customerFilter)
    : [];
  const assignableUsers = await listAssignableUsers(userRepository);
  if (assignableUsers.length === 0) {
    assignableUsers.push(user);
  }
  return { customers, contacts, assignableUsers };
}

function renderInquiryForm(res, data = {}) {
  res.render('inquiries/form', {
    ...inquiryFormOptions,
    countryOptions: CUSTOMER_COUNTRIES,
    ...data
  });
}

function renderInquiryDetail(res, data = {}) {
  res.render('inquiries/detail', {
    ...inquiryFormOptions,
    countryOptions: CUSTOMER_COUNTRIES,
    ...data
  });
}

function handleInquiryError(error, res, next) {
  if (error.message === 'Forbidden') {
    forbidden(res);
    return;
  }
  if (['Inquiry not found', 'Customer not found', 'Contact not found'].includes(error.message)) {
    res.status(404).send(error.message);
    return;
  }
  if ([
    'Contact does not belong to customer',
    'Requirement is required',
    'Customer is required',
    'Inquiry already converted'
  ].includes(error.message)) {
    res.status(400).send(error.message);
    return;
  }
  next(error);
}

export function inquiryRoutes({
  inquiryRepository,
  customerRepository,
  contactRepository,
  opportunityRepository,
  userRepository
}) {
  const router = Router();

  router.use('/inquiries', requireLogin);
  router.use('/inquiries', (req, res, next) => {
    if (!canAccessInquiryInbox(req.currentUser)) {
      forbidden(res);
      return;
    }
    next();
  });

  router.get('/inquiries', async (req, res, next) => {
    try {
      const inquiries = await inquiryRepository.listInquiries(inquiryListFilterFor(req.currentUser, req.query));
      res.render('inquiries/index', {
        inquiries,
        filters: req.query,
        ...inquiryFormOptions
      });
    } catch (error) {
      handleInquiryError(error, res, next);
    }
  });

  router.get('/inquiries/new', async (req, res, next) => {
    try {
      const options = await loadCrmOptions({ customerRepository, contactRepository, userRepository }, req.currentUser);
      renderInquiryForm(res, {
        inquiry: {
          source: 'manual',
          priority: 'normal',
          status: 'new',
          assignedUserId: req.currentUser.id
        },
        action: '/inquiries',
        ...options
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/inquiries', async (req, res, next) => {
    try {
      const inquiry = await createInquiry(inquiryRepository, req.currentUser, req.body);
      res.redirect(`/inquiries/${inquiry.id}`);
    } catch (error) {
      handleInquiryError(error, res, next);
    }
  });

  router.get('/inquiries/:id', async (req, res, next) => {
    try {
      const inquiry = await loadInquiryOrSend(inquiryRepository, req, res);
      if (!inquiry) {
        return;
      }
      const options = await loadCrmOptions({ customerRepository, contactRepository, userRepository }, req.currentUser);
      renderInquiryDetail(res, {
        inquiry,
        ...options
      });
    } catch (error) {
      handleInquiryError(error, res, next);
    }
  });

  router.post('/inquiries/:id/review', async (req, res, next) => {
    try {
      const inquiry = await loadInquiryOrSend(inquiryRepository, req, res);
      if (!inquiry) {
        return;
      }
      await updateInquiryReview({
        inquiryRepository,
        customerRepository,
        contactRepository
      }, req.currentUser, inquiry, req.body);
      res.redirect(`/inquiries/${inquiry.id}`);
    } catch (error) {
      handleInquiryError(error, res, next);
    }
  });

  router.post('/inquiries/:id/convert', async (req, res, next) => {
    try {
      const inquiry = await loadInquiryOrSend(inquiryRepository, req, res);
      if (!inquiry) {
        return;
      }
      const opportunity = await convertInquiryToOpportunity({
        inquiryRepository,
        customerRepository,
        contactRepository,
        opportunityRepository
      }, req.currentUser, inquiry, req.body);
      res.redirect(`/opportunities/${opportunity.id}`);
    } catch (error) {
      handleInquiryError(error, res, next);
    }
  });

  return router;
}
