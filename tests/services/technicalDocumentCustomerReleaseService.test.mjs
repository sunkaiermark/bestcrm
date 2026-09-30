import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLES } from '../../src/domain/roles.mjs';
import {
  canRequestTechnicalDocumentCustomerRelease,
  canReviewTechnicalDocumentCustomerRelease,
  requestTechnicalDocumentCustomerRelease,
  reviewTechnicalDocumentCustomerRelease,
  revokeTechnicalDocumentCustomerRelease
} from '../../src/services/technicalDocumentCustomerReleaseService.mjs';

const engineer = { id: 7, roles: [ROLES.QUOTATION_ENGINEER] };
const manager = { id: 9, roles: [ROLES.TECHNICAL_MANAGER] };
const opportunity = {
  id: 20, customerId: 30, quotationEngineerId: 7, technicalManagerId: 9
};
const draft = {
  id: 41, status: 'approved', selfApprovalTest: false,
  documents: [{ id: 61, sha256: 'a'.repeat(64) }]
};

test('approved technical files remain internal until the lead engineer requests exact-version customer release', async () => {
  assert.equal(canRequestTechnicalDocumentCustomerRelease(engineer, opportunity, draft), true);
  assert.equal(canRequestTechnicalDocumentCustomerRelease(manager, opportunity, draft), false);
  assert.equal(canRequestTechnicalDocumentCustomerRelease(engineer, opportunity, { ...draft, selfApprovalTest: true }), false);
  const requests = [];
  const repository = {
    async request(input) { requests.push(input); return { id: 1, status: 'pending', ...input }; }
  };
  await requestTechnicalDocumentCustomerRelease(repository, engineer, opportunity, draft, {
    documentId: 61, purpose: 'Customer technical offer'
  });
  assert.deepEqual(requests[0], {
    opportunityId: 20, customerId: 30, draftId: 41, documentId: 61,
    fileSha256: 'a'.repeat(64), purpose: 'Customer technical offer', actorUserId: 7
  });
  await assert.rejects(
    () => requestTechnicalDocumentCustomerRelease(repository, manager, opportunity, draft, { documentId: 61, purpose: 'test' }),
    (error) => error.statusCode === 403
  );
  await assert.rejects(
    () => requestTechnicalDocumentCustomerRelease(repository, engineer, opportunity, draft, { documentId: 62, purpose: 'test' }),
    (error) => error.statusCode === 404
  );
});

test('only the assigned technical manager can decide and revoke a separate customer release', async () => {
  assert.equal(canReviewTechnicalDocumentCustomerRelease(manager, opportunity, draft), true);
  assert.equal(canReviewTechnicalDocumentCustomerRelease(engineer, opportunity, draft), false);
  const reviews = [];
  const revocations = [];
  const repository = {
    async review(input) { reviews.push(input); return { status: input.decision }; },
    async revoke(input) { revocations.push(input); return { status: 'revoked' }; }
  };
  await reviewTechnicalDocumentCustomerRelease(repository, manager, opportunity, draft, {
    documentId: 61, decision: 'approved', comment: 'Checked for external use'
  });
  assert.equal(reviews[0].fileSha256, 'a'.repeat(64));
  assert.equal(reviews[0].customerId, 30);
  assert.equal(reviews[0].actorUserId, 9);
  await assert.rejects(
    () => reviewTechnicalDocumentCustomerRelease(repository, manager, opportunity, draft, {
      documentId: 61, decision: 'rejected', comment: ''
    }),
    (error) => error.statusCode === 400
  );
  await revokeTechnicalDocumentCustomerRelease(repository, manager, opportunity, draft, {
    documentId: 61, reason: 'Incorrect scope'
  });
  assert.equal(revocations[0].reason, 'Incorrect scope');
  await assert.rejects(
    () => revokeTechnicalDocumentCustomerRelease(repository, engineer, opportunity, draft, {
      documentId: 61, reason: 'test'
    }),
    (error) => error.statusCode === 403
  );
});
