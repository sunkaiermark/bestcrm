import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertConceptReadyForSubmission,
  conceptSnapshotSha256,
  normalizeConceptSnapshot
} from '../../src/domain/developmentConcepts.mjs';
import {
  createConceptRevision,
  decideConceptRevision,
  requestFormalDesignHandoff
} from '../../src/services/developmentConceptService.mjs';

export const completeConcept = {
  problem: 'Reduce cleaning downtime for a viscous reactor',
  application: 'Customer batch polymerization line',
  scope: 'Agitator and vessel internals, excluding downstream packaging',
  options: [
    { name: 'Twin cone', benefits: 'Strong mixing', tradeoffs: 'Higher sealing risk' },
    { name: 'Conventional', benefits: 'Known build', tradeoffs: 'Longer cleaning time' }
  ],
  preferredOption: 'Twin cone',
  assumptions: ['Viscosity remains below 50 Pa·s'],
  risks: ['Seal wear is unverified'],
  evidence: ['Small-scale washout trial 2026-09-24, internal notebook'],
  nextStepEffort: 'Two engineers for two weeks; bench verification first',
  customerOpportunityRelation: 'Customer idea; no opportunity required'
};

test('one-page concept has field-specific submit errors and a stable digest', () => {
  const partial = normalizeConceptSnapshot({ problem: 'Idea' });
  assert.throws(() => assertConceptReadyForSubmission(partial), (error) =>
    error.statusCode === 422 && error.fields.includes('options')
      && error.fields.includes('evidence'));
  const snapshot = assertConceptReadyForSubmission(completeConcept);
  assert.equal(snapshot.options.length, 2);
  assert.equal(snapshot.customerOpportunityRelation, completeConcept.customerOpportunityRelation);
  const reversed = Object.fromEntries(Object.entries(snapshot).reverse());
  assert.equal(conceptSnapshotSha256(snapshot), conceptSnapshotSha256(reversed));
  assert.throws(() => normalizeConceptSnapshot({
    ...completeConcept, options: [{ name: 12 }]
  }), /options.name must be text/);
  assert.throws(() => assertConceptReadyForSubmission({
    ...completeConcept, preferredOption: 'Unlisted'
  }), (error) => error.fields.includes('preferredOption'));
});

test('concept writes require active actors, versions and technical-manager decision role', async () => {
  const calls = [];
  const repository = {
    async createConceptRevision(input) { calls.push(input); return input; },
    async decideConceptRevision(input) { calls.push(input); return input; },
    async requestFormalDesignHandoff(input) { calls.push(input); return input; }
  };
  const owner = { id: 4, isActive: true, roles: ['salesperson'] };
  await assert.rejects(createConceptRevision(repository, { ...owner, isActive: false }, 2, {
    expectedRowVersion: 1, snapshot: completeConcept
  }), /Active login required/);
  await assert.rejects(decideConceptRevision(repository, owner, 2, 7, {
    expectedRowVersion: 2, decisionCode: 'approved', reason: 'Ready',
    idempotencyKey: 'once'
  }), (error) => error.statusCode === 403);
  await assert.rejects(decideConceptRevision(repository, {
    ...owner, roles: ['technical_manager']
  }, 2, 7, {
    expectedRowVersion: 2, decisionCode: 'paused', reason: 'Wait',
    idempotencyKey: 'once'
  }), (error) => error.statusCode === 422);
  assert.equal(calls.length, 0);
  const revision = await createConceptRevision(repository, owner, 2, {
    expectedRowVersion: 1, snapshot: completeConcept
  });
  assert.equal(revision.topicId, 2);
  assert.match(revision.snapshotSha256, /^[0-9a-f]{64}$/);
  await assert.rejects(requestFormalDesignHandoff(repository, owner, 2, {
    revisionId: 7, expectedRowVersion: 0, idempotencyKey: 'once'
  }), /expectedRowVersion/);
});
