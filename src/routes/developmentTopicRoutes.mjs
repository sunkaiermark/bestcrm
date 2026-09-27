import { Router } from 'express';
import { getConceptGate } from '../services/developmentConceptService.mjs';
import {
  appendDevelopmentDiscussion,
  canCreateDevelopmentTopic,
  createDevelopmentTopicDraft,
  endDevelopmentMembership,
  getDevelopmentTopicWorkspace,
  inviteDevelopmentMember,
  listDevelopmentDiscussion,
  listDevelopmentTopics
} from '../services/developmentTopicService.mjs';

function wantsJson(req) {
  return Boolean(req.is('application/json')
    || String(req.get('accept') || '').startsWith('application/json'));
}

function sendError(error, req, res, next) {
  if (!Number.isInteger(error?.statusCode)) return next(error);
  if (wantsJson(req)) {
    res.status(error.statusCode).json({ error: error.message, fields: error.fields || [] });
    return;
  }
  res.status(error.statusCode).send(error.message);
}

function directionsFromRequest(req) {
  if (wantsJson(req)) return req.body?.directions;
  const value = req.body?.directions;
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

export function developmentTopicRoutes({ repository, conceptRepository = null }) {
  const router = Router();
  async function loadDetail(actor, topicId, beforeCommentId) {
    const workspace = await getDevelopmentTopicWorkspace(repository, actor, topicId);
    const discussion = await listDevelopmentDiscussion(repository, actor, topicId,
      { beforeId: beforeCommentId });
    const conceptGate = conceptRepository
      ? await getConceptGate(conceptRepository, actor, topicId) : null;
    return { ...workspace, discussion, conceptGate };
  }
  router.use('/development', (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (!req.currentUser) {
      if (wantsJson(req)) res.status(401).json({ error: 'Login required' });
      else res.redirect('/login');
      return;
    }
    next();
  });

  router.get('/development/topics', async (req, res, next) => {
    try {
      const page = req.query.page || 1;
      const result = await listDevelopmentTopics(repository, req.currentUser, { page });
      if (wantsJson(req)) {
        res.json({ ...result, page: Number(page) });
        return;
      }
      res.render('development/topics-index', {
        ...result, page: Number(page), canCreate: canCreateDevelopmentTopic(req.currentUser)
      });
    } catch (error) { sendError(error, req, res, next); }
  });

  router.get('/development/topics/new', (req, res) => {
    if (!canCreateDevelopmentTopic(req.currentUser)) {
      res.status(403).send('Active user required');
      return;
    }
    res.render('development/topic-new', { form: {}, error: null });
  });

  router.post('/development/topics', async (req, res, next) => {
    const form = { ...req.body, directions: directionsFromRequest(req) };
    try {
      const topic = await createDevelopmentTopicDraft(repository, req.currentUser, form);
      if (wantsJson(req)) res.status(201).json(topic);
      else res.redirect(303, `/development/topics/${topic.id}`);
    } catch (error) {
      if (!wantsJson(req) && error?.statusCode === 422) {
        res.status(422).render('development/topic-new', { form, error: error.message });
      } else sendError(error, req, res, next);
    }
  });

  router.get('/development/topics/:id', async (req, res, next) => {
    try {
      const detail = await loadDetail(req.currentUser, req.params.id, req.query.beforeCommentId);
      if (wantsJson(req)) res.json(detail);
      else res.render('development/topic-detail', {
        ...detail, discussionError: null, discussionDraft: ''
      });
    } catch (error) { sendError(error, req, res, next); }
  });

  router.post('/development/topics/:id/discussion', async (req, res, next) => {
    try {
      const comment = await appendDevelopmentDiscussion(repository, req.currentUser,
        req.params.id, req.body);
      if (wantsJson(req)) res.status(201).json(comment);
      else res.redirect(303, `/development/topics/${req.params.id}#discussion`);
    } catch (error) {
      if (!wantsJson(req) && error?.statusCode === 422) {
        try {
          const detail = await loadDetail(req.currentUser, req.params.id);
          res.status(422).render('development/topic-detail', {
            ...detail, discussionError: error.message,
            discussionDraft: typeof req.body?.body === 'string' ? req.body.body : ''
          });
        } catch (accessError) { sendError(accessError, req, res, next); }
      } else sendError(error, req, res, next);
    }
  });

  router.post('/development/topics/:id/members', async (req, res, next) => {
    try {
      const result = await inviteDevelopmentMember(repository, req.currentUser, req.params.id, req.body);
      if (wantsJson(req)) res.status(201).json(result);
      else res.redirect(303, `/development/topics/${req.params.id}`);
    } catch (error) { sendError(error, req, res, next); }
  });

  router.post('/development/topics/:id/members/:userId/end', async (req, res, next) => {
    try {
      const result = await endDevelopmentMembership(repository, req.currentUser,
        req.params.id, req.params.userId);
      if (wantsJson(req)) res.json(result);
      else res.redirect(303, `/development/topics/${req.params.id}`);
    } catch (error) { sendError(error, req, res, next); }
  });

  return router;
}
