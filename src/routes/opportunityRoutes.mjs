import { Router } from 'express';
import { ROLES, hasRole } from '../domain/roles.mjs';
import { requireLogin } from '../middleware/auth.mjs';
import { canViewOpportunity, createOpportunityDraft } from '../services/opportunityService.mjs';

function ownerFilter(user) {
  return hasRole(user, ROLES.ADMINISTRATOR) ? {} : { salespersonId: user.id };
}

export function opportunityRoutes({ customerRepository, contactRepository, opportunityRepository }) {
  const router = Router();

  router.use('/opportunities', requireLogin);
  router.use('/api/opportunities', requireLogin);

  router.get('/opportunities', async (req, res, next) => {
    try {
      const opportunities = await opportunityRepository.listOpportunities(ownerFilter(req.currentUser));
      res.render('opportunities/index', { opportunities });
    } catch (error) {
      next(error);
    }
  });

  router.get('/opportunities/new', async (req, res, next) => {
    try {
      const filter = hasRole(req.currentUser, ROLES.ADMINISTRATOR) ? {} : { ownerUserId: req.currentUser.id };
      const [customers, contacts] = await Promise.all([
        customerRepository.listCustomers(filter),
        contactRepository.listContacts(filter)
      ]);
      res.render('opportunities/form', {
        opportunity: {
          customerId: req.query.customerId,
          primaryContactId: req.query.contactId
        },
        customers,
        contacts,
        action: '/opportunities'
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/opportunities', async (req, res, next) => {
    try {
      const opportunity = await createOpportunityDraft({
        customerRepository,
        contactRepository,
        opportunityRepository
      }, req.currentUser, req.body);
      res.redirect(`/opportunities/${opportunity.id}`);
    } catch (error) {
      next(error);
    }
  });

  router.get('/opportunities/:id', async (req, res, next) => {
    try {
      const opportunity = await opportunityRepository.getOpportunityDetail(req.params.id);
      if (!opportunity) {
        res.status(404).send('Opportunity not found');
        return;
      }
      if (!canViewOpportunity(req.currentUser, opportunity)) {
        res.status(403).send('Forbidden');
        return;
      }
      res.render('opportunities/detail', { opportunity });
    } catch (error) {
      next(error);
    }
  });

  router.get('/api/opportunities', async (req, res, next) => {
    try {
      const opportunities = await opportunityRepository.listOpportunities(ownerFilter(req.currentUser));
      res.json({ opportunities });
    } catch (error) {
      next(error);
    }
  });

  router.post('/api/opportunities', async (req, res, next) => {
    try {
      const opportunity = await createOpportunityDraft({
        customerRepository,
        contactRepository,
        opportunityRepository
      }, req.currentUser, req.body);
      res.status(201).json(opportunity);
    } catch (error) {
      next(error);
    }
  });

  return router;
}
