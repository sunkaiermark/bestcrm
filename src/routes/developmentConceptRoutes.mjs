import { Router } from 'express';
import {
  createConceptRevision, decideConceptRevision, getConceptGate,
  getConceptRevisionPreview,
  requestFormalDesignHandoff, submitConceptRevision
} from '../services/developmentConceptService.mjs';

function sendError(error, res, next) {
  if (Number.isInteger(error?.statusCode)) {
    res.status(error.statusCode).json({
      error: error.message,
      fields: error.fields || []
    });
    return;
  }
  if (error?.code === '23505') {
    res.status(409).json({ error: 'A concept action already exists' });
    return;
  }
  next(error);
}

export function developmentConceptRoutes({ developmentConceptRepository }) {
  const router = Router();
  router.use('/development/topics/:id', (req, res, next) => {
    if (!req.currentUser) {
      res.status(401).json({ error: 'Login required' });
      return;
    }
    res.set('Cache-Control', 'no-store');
    next();
  });

  router.get('/development/topics/:id/concept-gate', async (req, res, next) => {
    try {
      res.json(await getConceptGate(developmentConceptRepository, req.currentUser, req.params.id));
    } catch (error) { sendError(error, res, next); }
  });

  router.get('/development/topics/:id/concepts/:revisionId/preview', async (req, res, next) => {
    try {
      const concept = await getConceptRevisionPreview(
        developmentConceptRepository, req.currentUser, req.params.id, req.params.revisionId
      );
      res.render('development/concept-preview', { concept });
    } catch (error) { sendError(error, res, next); }
  });

  router.post('/development/topics/:id/concepts', async (req, res, next) => {
    try {
      res.status(201).json(await createConceptRevision(
        developmentConceptRepository, req.currentUser, req.params.id, req.body
      ));
    } catch (error) { sendError(error, res, next); }
  });

  router.post('/development/topics/:id/concepts/:revisionId/submit', async (req, res, next) => {
    try {
      res.status(201).json(await submitConceptRevision(
        developmentConceptRepository, req.currentUser, req.params.id,
        req.params.revisionId, req.body
      ));
    } catch (error) { sendError(error, res, next); }
  });

  router.post('/development/topics/:id/concepts/:revisionId/decision', async (req, res, next) => {
    try {
      const result = await decideConceptRevision(
        developmentConceptRepository, req.currentUser, req.params.id,
        req.params.revisionId, req.body
      );
      res.status(result.repeated ? 200 : 201).json(result);
    } catch (error) { sendError(error, res, next); }
  });

  router.post('/development/topics/:id/design-handoffs', async (req, res, next) => {
    try {
      const result = await requestFormalDesignHandoff(
        developmentConceptRepository, req.currentUser, req.params.id, req.body
      );
      res.status(result.repeated ? 200 : 201).json(result);
    } catch (error) { sendError(error, res, next); }
  });

  return router;
}
