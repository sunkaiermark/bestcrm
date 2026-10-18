import { Router } from 'express';
import { requireLogin } from '../middleware/auth.mjs';
import {
  confirmProjectExecution,
  createProjectMilestone,
  createProjectWorkPackage,
  advanceProjectReleaseWorkflow,
  listProjectExecutions,
  loadProjectExecutionConfirmationContext,
  loadProjectExecutionWorkspace,
  updateProjectExecution,
  updateProjectMilestone,
  updateProjectWorkPackage
} from '../services/projectExecutionService.mjs';

function respondProjectExecutionError(error, res, next) {
  if (error.message === 'Forbidden') {
    res.status(403).send('Forbidden');
    return;
  }
  if (error.message === 'Opportunity not found' || error.message === 'Project Execution not found' || error.message === 'Work package not found' || error.message === 'Project release workflow not found') {
    res.status(404).send(error.message);
    return;
  }
  if (error.message.includes('required') || error.message.includes('must') || error.message.includes('only be created') || error.message.includes('cannot be before') || error.message.includes('not available')) {
    res.status(400).send(error.message);
    return;
  }
  next(error);
}

export function projectExecutionRoutes({
  opportunityRepository,
  projectExecutionRepository,
  approvalSettingRepository,
  userRepository
}) {
  const router = Router();
  const repositories = {
    opportunityRepository,
    projectExecutionRepository,
    approvalSettingRepository,
    userRepository
  };

  router.use('/project-executions', requireLogin);
  router.use('/opportunities/:opportunityId/project-execution', requireLogin);

  router.get('/project-executions', async (req, res, next) => {
    try {
      const projectExecutions = await listProjectExecutions(repositories, req.currentUser);
      res.render('project-executions/index', { projectExecutions });
    } catch (error) {
      respondProjectExecutionError(error, res, next);
    }
  });

  router.get('/project-executions/:id', async (req, res, next) => {
    try {
      const workspace = await loadProjectExecutionWorkspace(
        repositories,
        req.currentUser,
        req.params.id
      );
      res.render('project-executions/detail', workspace);
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
      res.render('project-executions/confirm', { opportunity: context.opportunity, users: context.users });
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

  router.post('/project-executions/:id', async (req, res, next) => {
    try {
      await updateProjectExecution(repositories, req.currentUser, req.params.id, req.body);
      res.redirect(`/project-executions/${req.params.id}`);
    } catch (error) { respondProjectExecutionError(error, res, next); }
  });

  router.post('/project-executions/:id/milestones', async (req, res, next) => {
    try {
      await createProjectMilestone(repositories, req.currentUser, req.params.id, req.body);
      res.redirect(`/project-executions/${req.params.id}#milestones`);
    } catch (error) { respondProjectExecutionError(error, res, next); }
  });

  router.post('/project-executions/:id/milestones/:milestoneId', async (req, res, next) => {
    try {
      await updateProjectMilestone(repositories, req.currentUser, req.params.id, req.params.milestoneId, req.body);
      res.redirect(`/project-executions/${req.params.id}#milestones`);
    } catch (error) { respondProjectExecutionError(error, res, next); }
  });

  router.post('/project-executions/:id/work-packages', async (req, res, next) => {
    try {
      await createProjectWorkPackage(repositories, req.currentUser, req.params.id, req.body);
      res.redirect(`/project-executions/${req.params.id}#work-packages`);
    } catch (error) { respondProjectExecutionError(error, res, next); }
  });

  router.post('/project-executions/:id/work-packages/:workPackageId', async (req, res, next) => {
    try {
      await updateProjectWorkPackage(repositories, req.currentUser, req.params.id, req.params.workPackageId, req.body);
      res.redirect(`/project-executions/${req.params.id}#work-packages`);
    } catch (error) { respondProjectExecutionError(error, res, next); }
  });

  router.post('/project-executions/:id/release-workflow', async (req, res, next) => {
    try {
      await advanceProjectReleaseWorkflow(repositories, req.currentUser, req.params.id, req.body);
      res.redirect(`/project-executions/${req.params.id}#release-workflow`);
    } catch (error) { respondProjectExecutionError(error, res, next); }
  });

  return router;
}
