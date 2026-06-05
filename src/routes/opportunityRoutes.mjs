import { Router } from 'express';
import { ROLES, hasRole } from '../domain/roles.mjs';
import { ACTIONS, getAllowedActions } from '../domain/workflow.mjs';
import { requireLogin } from '../middleware/auth.mjs';
import { canViewOpportunity, createOpportunityDraft } from '../services/opportunityService.mjs';
import { applyWorkflowAction } from '../services/workflowService.mjs';

function ownerFilter(user) {
  return hasRole(user, ROLES.ADMINISTRATOR) ? {} : { salespersonId: user.id };
}

const assignmentRoles = [
  ROLES.SALES_MANAGER,
  ROLES.QUOTATION_ENGINEER,
  ROLES.TECHNICAL_MANAGER,
  ROLES.COMMERCIAL_MANAGER,
  ROLES.LEGAL_REVIEWER
];

const numericPayloadFields = new Set([
  'salesManagerId',
  'quotationEngineerId',
  'technicalManagerId',
  'commercialManagerId',
  'legalReviewerId',
  'finalDealAmount'
]);

async function loadUsersByRole(userRepository) {
  const entries = await Promise.all(assignmentRoles.map(async (role) => {
    if (typeof userRepository?.listUsersByRole !== 'function') {
      return [role, []];
    }
    return [role, await userRepository.listUsersByRole(role)];
  }));
  return Object.fromEntries(entries);
}

function userSelectField(name, label, users) {
  return { type: 'userSelect', name, label, users };
}

function textareaField(name, label, required = true) {
  return { type: 'textarea', name, label, required };
}

function inputField(name, label, inputType = 'text', required = true) {
  return { type: 'input', name, label, inputType, required };
}

function formForAction(action, usersByRole) {
  switch (action) {
    case ACTIONS.SUBMIT_INITIATION:
      return {
        action,
        title: 'Submit Initiation',
        button: 'Submit to Sales Manager',
        fields: [
          userSelectField('salesManagerId', 'Sales Manager', usersByRole[ROLES.SALES_MANAGER] || []),
          textareaField('comment', 'Comment', false)
        ]
      };
    case ACTIONS.WITHDRAW_INITIATION:
      return {
        action,
        title: 'Withdraw Initiation',
        button: 'Withdraw',
        fields: [textareaField('reason', 'Reason')]
      };
    case ACTIONS.APPROVE_INITIATION:
      return {
        action,
        title: 'Approve Initiation',
        button: 'Approve and Assign',
        fields: [
          userSelectField('quotationEngineerId', 'Quotation Engineer', usersByRole[ROLES.QUOTATION_ENGINEER] || []),
          textareaField('comment', 'Comment', false)
        ]
      };
    case ACTIONS.REJECT_INITIATION:
      return {
        action,
        title: 'Reject Initiation',
        button: 'Reject',
        fields: [textareaField('reason', 'Reason')]
      };
    case ACTIONS.SUBMIT_TECHNICAL_SOLUTION:
      return {
        action,
        title: 'Submit Technical Solution',
        button: 'Submit to Technical Manager',
        fields: [
          userSelectField('technicalManagerId', 'Technical Manager', usersByRole[ROLES.TECHNICAL_MANAGER] || []),
          textareaField('comment', 'Comment', false)
        ]
      };
    case ACTIONS.WITHDRAW_TECHNICAL_SOLUTION:
      return {
        action,
        title: 'Withdraw Technical Solution',
        button: 'Withdraw',
        fields: [textareaField('reason', 'Reason')]
      };
    case ACTIONS.APPROVE_TECHNICAL_SOLUTION:
      return {
        action,
        title: 'Approve Technical Solution',
        button: 'Approve',
        fields: [textareaField('comment', 'Comment', false)]
      };
    case ACTIONS.REJECT_TECHNICAL_SOLUTION:
      return {
        action,
        title: 'Reject Technical Solution',
        button: 'Reject',
        fields: [textareaField('reason', 'Reason')]
      };
    case ACTIONS.SUBMIT_COMMERCIAL_QUOTE:
      return {
        action,
        title: 'Submit Commercial Quote',
        button: 'Submit to Commercial Manager',
        fields: [
          userSelectField('commercialManagerId', 'Commercial Manager', usersByRole[ROLES.COMMERCIAL_MANAGER] || []),
          textareaField('comment', 'Comment', false)
        ]
      };
    case ACTIONS.WITHDRAW_COMMERCIAL_QUOTE:
      return {
        action,
        title: 'Withdraw Commercial Quote',
        button: 'Withdraw',
        fields: [textareaField('reason', 'Reason')]
      };
    case ACTIONS.APPROVE_COMMERCIAL_QUOTE:
      return {
        action,
        title: 'Approve Commercial Quote',
        button: 'Approve',
        fields: [textareaField('comment', 'Comment', false)]
      };
    case ACTIONS.REJECT_COMMERCIAL_QUOTE:
      return {
        action,
        title: 'Reject Commercial Quote',
        button: 'Reject',
        fields: [textareaField('reason', 'Reason')]
      };
    case ACTIONS.MARK_LOST:
      return {
        action,
        title: 'Record Lost Result',
        button: 'Archive as Lost',
        fields: [textareaField('lostReason', 'Lost Reason')]
      };
    case ACTIONS.MARK_WON:
      return {
        action,
        title: 'Record Won Result',
        button: 'Mark Won',
        fields: [
          textareaField('wonDescription', 'Won Description'),
          inputField('finalDealAmount', 'Final Deal Amount', 'number')
        ]
      };
    case ACTIONS.SUBMIT_CONTRACT_APPROVAL:
      return {
        action,
        title: 'Submit Contract Approval',
        button: 'Submit Contract Approval',
        fields: [
          userSelectField('legalReviewerId', 'Legal Reviewer', usersByRole[ROLES.LEGAL_REVIEWER] || []),
          textareaField('comment', 'Comment', false)
        ]
      };
    case ACTIONS.WITHDRAW_CONTRACT_APPROVAL:
      return {
        action,
        title: 'Withdraw Contract Approval',
        button: 'Withdraw',
        fields: [textareaField('reason', 'Reason')]
      };
    default:
      return null;
  }
}

function buildWorkflowForms(user, opportunity, usersByRole) {
  const allowedActions = getAllowedActions({
    userId: user.id,
    roles: user.roles,
    opportunity
  });
  return allowedActions
    .map((action) => formForAction(action, usersByRole))
    .filter(Boolean);
}

function parseWorkflowPayload(body) {
  const payload = {};
  for (const [key, value] of Object.entries(body)) {
    if (key === 'action' || value === undefined || value === null || value === '') {
      continue;
    }
    payload[key] = numericPayloadFields.has(key) ? Number(value) : String(value).trim();
  }
  return payload;
}

async function loadOpportunityActivity({ opportunityId, workflowEventRepository, todoRepository }) {
  const [timelineEvents, todos] = await Promise.all([
    typeof workflowEventRepository?.listByOpportunity === 'function'
      ? workflowEventRepository.listByOpportunity(opportunityId)
      : [],
    typeof todoRepository?.listByOpportunity === 'function'
      ? todoRepository.listByOpportunity(opportunityId)
      : []
  ]);
  return { timelineEvents, todos };
}

export function opportunityRoutes({
  customerRepository,
  contactRepository,
  opportunityRepository,
  userRepository,
  workflowEventRepository,
  todoRepository
}) {
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
      const [usersByRole, activity] = await Promise.all([
        loadUsersByRole(userRepository),
        loadOpportunityActivity({
          opportunityId: opportunity.id,
          workflowEventRepository,
          todoRepository
        })
      ]);
      const workflowForms = buildWorkflowForms(req.currentUser, opportunity, usersByRole);
      res.render('opportunities/detail', {
        opportunity,
        workflowForms,
        timelineEvents: activity.timelineEvents,
        todos: activity.todos
      });
    } catch (error) {
      next(error);
    }
  });

  router.post('/opportunities/:id/workflow', async (req, res, next) => {
    try {
      await applyWorkflowAction({
        actor: req.currentUser,
        opportunityId: req.params.id,
        action: req.body.action,
        payload: parseWorkflowPayload(req.body),
        repositories: {
          opportunityRepository,
          workflowEventRepository,
          todoRepository
        }
      });
      res.redirect(`/opportunities/${req.params.id}`);
    } catch (error) {
      if (error.message === 'Opportunity not found') {
        res.status(404).send('Opportunity not found');
        return;
      }
      if (error.message === 'Action not allowed') {
        res.status(403).send('Forbidden');
        return;
      }
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
