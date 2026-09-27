import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import { hasRole, ROLES } from '../domain/roles.mjs';
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

function isForm(req) {
  return Boolean(req.is('application/x-www-form-urlencoded'));
}

function formText(value) {
  return typeof value === 'string' ? value : '';
}

function conceptFormValues(source = {}) {
  return {
    problem: formText(source.problem),
    application: formText(source.application),
    scope: formText(source.scope),
    options: Array.from({ length: 8 }, (_, index) => ({
      name: formText(source.options?.[index]?.name ?? source[`option${index + 1}Name`]),
      benefits: formText(source.options?.[index]?.benefits ?? source[`option${index + 1}Benefits`]),
      tradeoffs: formText(source.options?.[index]?.tradeoffs ?? source[`option${index + 1}Tradeoffs`])
    })),
    preferredOptionIndex: formText(source.preferredOptionIndex)
      || String((source.options || []).findIndex((option) =>
        option.name && option.name === source.preferredOption) + 1 || ''),
    assumptions: Array.isArray(source.assumptions) ? source.assumptions.join('\n') : formText(source.assumptions),
    risks: Array.isArray(source.risks) ? source.risks.join('\n') : formText(source.risks),
    evidence: Array.isArray(source.evidence) ? source.evidence.join('\n') : formText(source.evidence),
    nextStepEffort: formText(source.nextStepEffort),
    customerOpportunityRelation: formText(source.customerOpportunityRelation)
  };
}

function conceptSnapshotFromForm(body = {}) {
  const options = Array.from({ length: 8 }, (_, index) => ({
    name: body[`option${index + 1}Name`] ?? '',
    benefits: body[`option${index + 1}Benefits`] ?? '',
    tradeoffs: body[`option${index + 1}Tradeoffs`] ?? ''
  }));
  const preferredIndex = Number(body.preferredOptionIndex);
  const lines = (value) => typeof value === 'string' ? value.split(/\r?\n/) : value ?? [];
  return {
    problem: body.problem, application: body.application, scope: body.scope,
    options: options.filter((option) => Object.values(option).some((value) =>
      typeof value !== 'string' || value.trim())),
    preferredOption: Number.isInteger(preferredIndex) && preferredIndex >= 1 && preferredIndex <= 8
      ? options[preferredIndex - 1].name : '',
    assumptions: lines(body.assumptions), risks: lines(body.risks),
    evidence: lines(body.evidence), nextStepEffort: body.nextStepEffort,
    customerOpportunityRelation: body.customerOpportunityRelation
  };
}

function htmlError(res, error, topicId) {
  res.status(Number.isInteger(error?.statusCode) ? error.statusCode : 500)
    .render('development/action-error', {
      topicId, message: error?.message || 'Development action failed'
    });
}

function actionError(error, req, res, next) {
  if (!isForm(req) && req.method !== 'GET') return sendError(error, res, next);
  if (!Number.isInteger(error?.statusCode)) return next(error);
  htmlError(res, error, req.params.id);
}

function mayEditConcept(gate, actor) {
  return Number(gate.ownerUserId) === Number(actor.id)
    && ['idea', 'exploration', 'concept_review', 'detailed_design'].includes(gate.phase)
    && !(gate.submittedAt && !gate.decisionCode);
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

  router.get('/development/topics/:id/concepts/new', async (req, res, next) => {
    if (!res.locals.developmentWorkspaceEnabled) return res.sendStatus(404);
    try {
      const gate = await getConceptGate(developmentConceptRepository, req.currentUser, req.params.id);
      if (!mayEditConcept(gate, req.currentUser)) {
        htmlError(res, { statusCode: 403, message: 'Only the current topic owner may draft a concept revision' }, req.params.id);
        return;
      }
      res.render('development/concept-form', {
        gate, form: conceptFormValues(gate.currentSnapshot || {}), error: null
      });
    } catch (error) { actionError(error, req, res, next); }
  });

  router.get('/development/topics/:id/concepts/:revisionId/preview', async (req, res, next) => {
    try {
      const concept = await getConceptRevisionPreview(
        developmentConceptRepository, req.currentUser, req.params.id, req.params.revisionId
      );
      res.render('development/concept-preview', { concept });
    } catch (error) { sendError(error, res, next); }
  });

  router.get('/development/topics/:id/concepts/:revisionId/review', async (req, res, next) => {
    if (!res.locals.developmentWorkspaceEnabled) return res.sendStatus(404);
    try {
      if (!hasRole(req.currentUser, ROLES.TECHNICAL_MANAGER)) {
        htmlError(res, { statusCode: 403, message: 'Only a technical manager may review a concept' }, req.params.id);
        return;
      }
      const gate = await getConceptGate(developmentConceptRepository, req.currentUser, req.params.id);
      if (Number(gate.currentRevisionId) !== Number(req.params.revisionId)
          || !gate.submittedAt || gate.decisionCode || gate.phase !== 'concept_review') {
        htmlError(res, { statusCode: 409, message: 'Concept is not awaiting review; reload the topic' }, req.params.id);
        return;
      }
      const concept = await getConceptRevisionPreview(developmentConceptRepository,
        req.currentUser, req.params.id, req.params.revisionId);
      res.render('development/concept-review', {
        gate, concept, idempotencyKey: randomUUID(), error: null, form: {}
      });
    } catch (error) { actionError(error, req, res, next); }
  });

  router.post('/development/topics/:id/concepts', async (req, res, next) => {
    if (isForm(req) && !res.locals.developmentWorkspaceEnabled) return res.sendStatus(404);
    try {
      const input = isForm(req)
        ? { expectedRowVersion: req.body.expectedRowVersion,
          snapshot: conceptSnapshotFromForm(req.body) }
        : req.body;
      const result = await createConceptRevision(
        developmentConceptRepository, req.currentUser, req.params.id, input
      );
      if (isForm(req)) res.redirect(303, `/development/topics/${req.params.id}#development`);
      else res.status(201).json(result);
    } catch (error) {
      if (isForm(req) && error?.statusCode === 422) {
        try {
          const gate = await getConceptGate(developmentConceptRepository,
            req.currentUser, req.params.id);
          res.status(422).render('development/concept-form', {
            gate, form: conceptFormValues(req.body), error: error.message
          });
        } catch (accessError) { actionError(accessError, req, res, next); }
      } else actionError(error, req, res, next);
    }
  });

  router.post('/development/topics/:id/concepts/:revisionId/submit', async (req, res, next) => {
    if (isForm(req) && !res.locals.developmentWorkspaceEnabled) return res.sendStatus(404);
    try {
      const result = await submitConceptRevision(
        developmentConceptRepository, req.currentUser, req.params.id,
        req.params.revisionId, req.body
      );
      if (isForm(req)) res.redirect(303, `/development/topics/${req.params.id}#development`);
      else res.status(201).json(result);
    } catch (error) { actionError(error, req, res, next); }
  });

  router.post('/development/topics/:id/concepts/:revisionId/decision', async (req, res, next) => {
    if (isForm(req) && !res.locals.developmentWorkspaceEnabled) return res.sendStatus(404);
    try {
      const result = await decideConceptRevision(
        developmentConceptRepository, req.currentUser, req.params.id,
        req.params.revisionId, req.body
      );
      if (isForm(req)) res.redirect(303, `/development/topics/${req.params.id}#development`);
      else res.status(result.repeated ? 200 : 201).json(result);
    } catch (error) { actionError(error, req, res, next); }
  });

  router.post('/development/topics/:id/design-handoffs', async (req, res, next) => {
    if (isForm(req) && !res.locals.developmentWorkspaceEnabled) return res.sendStatus(404);
    try {
      const result = await requestFormalDesignHandoff(
        developmentConceptRepository, req.currentUser, req.params.id, req.body
      );
      if (isForm(req)) res.redirect(303, `/development/topics/${req.params.id}#development`);
      else res.status(result.repeated ? 200 : 201).json(result);
    } catch (error) { actionError(error, req, res, next); }
  });

  return router;
}
