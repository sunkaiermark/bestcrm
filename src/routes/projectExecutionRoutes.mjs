import { Router } from 'express';
import { requireLogin } from '../middleware/auth.mjs';
import {
  confirmProjectExecution,
  getProjectExecutionDetail,
  loadProjectExecutionConfirmationContext
} from '../services/projectExecutionService.mjs';

function respondProjectExecutionError(error, res, next) {
  if (error.message === 'Forbidden') {
    res.status(403).send('Forbidden');
    return;
  }
  if (error.message === 'Opportunity not found' || error.message === 'Project Execution not found') {
    res.status(404).send(error.message);
    return;
  }
  if (error.message.includes('required') || error.message.includes('only be created')) {
    res.status(400).send(error.message);
    return;
  }
  next(error);
}

export function projectExecutionRoutes({
  opportunityRepository,
  projectExecutionRepository,
  approvalSettingRepository
}) {
  const router = Router();
  const repositories = {
    opportunityRepository,
    projectExecutionRepository,
    approvalSettingRepository
  };

  router.use('/project-executions', requireLogin);
  router.use('/opportunities/:opportunityId/project-execution', requireLogin);

  router.get('/project-executions/:id', async (req, res, next) => {
    try {
      const projectExecution = await getProjectExecutionDetail(
        repositories,
        req.currentUser,
        req.params.id
      );
      res.render('project-executions/detail', { projectExecution });
    } catch (error) {
      respondProjectExecutionError(error, res, next);
    }
  });

  router.get('/opportunities/:opportunityId/project-execution/confirm', async (req, res, next) => {
    try {
      const context = await loadProjectExecutionConfirmationContext(
        repositories,
        req.currentUser,
        req.params.opportunityId
      );
      if (context.projectExecution) {
        res.redirect(`/project-executions/${context.projectExecution.id}`);
        return;
      }
      res.render('project-executions/confirm', { opportunity: context.opportunity });
    } catch (error) {
      respondProjectExecutionError(error, res, next);
    }
  });

  router.post('/opportunities/:opportunityId/project-execution/confirm', async (req, res, next) => {
    try {
      const result = await confirmProjectExecution(
        repositories,
        req.currentUser,
        req.params.opportunityId,
        req.body
      );
      res.redirect(`/project-executions/${result.projectExecution.id}`);
    } catch (error) {
      respondProjectExecutionError(error, res, next);
    }
  });

  return router;
}
