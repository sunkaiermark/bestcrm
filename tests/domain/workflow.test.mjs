import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTIONS, getAllowedActions, transition } from '../../src/domain/workflow.mjs';
import { STATUSES } from '../../src/domain/statuses.mjs';
import { ROLES } from '../../src/domain/roles.mjs';

test('salesperson can submit and withdraw initiation before Sales Manager approval', () => {
  const context = { userId: 1, roles: [ROLES.SALESPERSON], opportunity: { status: STATUSES.DRAFT, salespersonId: 1 } };
  assert.deepEqual(getAllowedActions(context), [ACTIONS.SUBMIT_INITIATION]);

  const submitted = transition(context, ACTIONS.SUBMIT_INITIATION, { salesManagerId: 2 });
  assert.equal(submitted.status, STATUSES.INITIATION_PENDING);
  assert.equal(submitted.salesManagerId, 2);

  const withdrawn = transition({ ...context, opportunity: submitted }, ACTIONS.WITHDRAW_INITIATION, { reason: 'revise amount' });
  assert.equal(withdrawn.status, STATUSES.DRAFT);
});

test('Sales Manager approval assigns quotation engineer and moves to technical work', () => {
  const context = {
    userId: 2,
    roles: [ROLES.SALES_MANAGER],
    opportunity: { status: STATUSES.INITIATION_PENDING, salespersonId: 1, salesManagerId: 2 }
  };

  const next = transition(context, ACTIONS.APPROVE_INITIATION, { quotationEngineerId: 3 });

  assert.equal(next.status, STATUSES.TECHNICAL_SOLUTION_IN_PROGRESS);
  assert.equal(next.quotationEngineerId, 3);
});

test('Sales Manager can change quotation engineer after initial assignment', () => {
  const context = {
    userId: 2,
    roles: [ROLES.SALES_MANAGER],
    opportunity: {
      status: STATUSES.COMMERCIAL_QUOTE_IN_PROGRESS,
      salespersonId: 1,
      salesManagerId: 2,
      quotationEngineerId: 3
    }
  };

  assert.deepEqual(getAllowedActions(context), [ACTIONS.CHANGE_QUOTATION_ENGINEER]);

  const next = transition(context, ACTIONS.CHANGE_QUOTATION_ENGINEER, { quotationEngineerId: 8 });

  assert.equal(next.status, STATUSES.COMMERCIAL_QUOTE_IN_PROGRESS);
  assert.equal(next.quotationEngineerId, 8);
  assert.throws(() => transition(context, ACTIONS.CHANGE_QUOTATION_ENGINEER, { quotationEngineerId: 3 }), /Action not allowed/);
});

test('Sales Manager rejection returns initiation to rejected state', () => {
  const next = transition({
    userId: 2,
    roles: [ROLES.SALES_MANAGER],
    opportunity: { status: STATUSES.INITIATION_PENDING, salespersonId: 1, salesManagerId: 2 }
  }, ACTIONS.REJECT_INITIATION, { reason: 'missing budget' });

  assert.equal(next.status, STATUSES.INITIATION_REJECTED);
});

test('quotation engineer can withdraw pending technical and commercial submissions', () => {
  const technical = transition({
    userId: 3,
    roles: [ROLES.QUOTATION_ENGINEER],
    opportunity: { status: STATUSES.TECHNICAL_SOLUTION_PENDING, quotationEngineerId: 3 }
  }, ACTIONS.WITHDRAW_TECHNICAL_SOLUTION, { reason: 'replace drawing' });
  assert.equal(technical.status, STATUSES.TECHNICAL_SOLUTION_IN_PROGRESS);

  const commercial = transition({
    userId: 3,
    roles: [ROLES.QUOTATION_ENGINEER],
    opportunity: { status: STATUSES.COMMERCIAL_QUOTE_PENDING, quotationEngineerId: 3 }
  }, ACTIONS.WITHDRAW_COMMERCIAL_QUOTE, { reason: 'adjust payment terms' });
  assert.equal(commercial.status, STATUSES.COMMERCIAL_QUOTE_IN_PROGRESS);
});

test('technical approval moves approved solution into commercial quote work', () => {
  const submitted = transition({
    userId: 3,
    roles: [ROLES.QUOTATION_ENGINEER],
    opportunity: { status: STATUSES.TECHNICAL_SOLUTION_IN_PROGRESS, quotationEngineerId: 3 }
  }, ACTIONS.SUBMIT_TECHNICAL_SOLUTION, { technicalManagerId: 4 });
  assert.equal(submitted.status, STATUSES.TECHNICAL_SOLUTION_PENDING);
  assert.equal(submitted.technicalManagerId, 4);

  const approved = transition({
    userId: 4,
    roles: [ROLES.TECHNICAL_MANAGER],
    opportunity: submitted
  }, ACTIONS.APPROVE_TECHNICAL_SOLUTION, { comment: 'approved' });
  assert.equal(approved.status, STATUSES.COMMERCIAL_QUOTE_IN_PROGRESS);
});

test('commercial approval moves quote into customer negotiation', () => {
  const submitted = transition({
    userId: 3,
    roles: [ROLES.QUOTATION_ENGINEER],
    opportunity: { status: STATUSES.COMMERCIAL_QUOTE_IN_PROGRESS, quotationEngineerId: 3 }
  }, ACTIONS.SUBMIT_COMMERCIAL_QUOTE, { commercialManagerId: 5 });
  assert.equal(submitted.status, STATUSES.COMMERCIAL_QUOTE_PENDING);
  assert.equal(submitted.commercialManagerId, 5);

  const approved = transition({
    userId: 5,
    roles: [ROLES.COMMERCIAL_MANAGER],
    opportunity: submitted
  }, ACTIONS.APPROVE_COMMERCIAL_QUOTE, { comment: 'approved' });
  assert.equal(approved.status, STATUSES.CUSTOMER_NEGOTIATION);
});

test('salesperson records lost or won customer result after quote approval', () => {
  const lost = transition({
    userId: 1,
    roles: [ROLES.SALESPERSON],
    opportunity: { status: STATUSES.CUSTOMER_NEGOTIATION, salespersonId: 1 }
  }, ACTIONS.MARK_LOST, { lostReason: 'price too high' });
  assert.equal(lost.status, STATUSES.LOST_ARCHIVED);
  assert.equal(lost.lostReason, 'price too high');
  assert.ok(lost.archivedAt);

  const won = transition({
    userId: 1,
    roles: [ROLES.SALESPERSON],
    opportunity: { status: STATUSES.CUSTOMER_NEGOTIATION, salespersonId: 1 }
  }, ACTIONS.MARK_WON, { wonDescription: 'selected by client', finalDealAmount: 180000 });
  assert.equal(won.status, STATUSES.WON_CONTRACT_PENDING);
  assert.equal(won.wonDescription, 'selected by client');
  assert.equal(won.finalDealAmount, 180000);
});

test('salesperson can submit and withdraw contract approval before reviewer action', () => {
  const submittedFromNegotiation = transition({
    userId: 1,
    roles: [ROLES.SALESPERSON],
    opportunity: { status: STATUSES.CUSTOMER_NEGOTIATION, salespersonId: 1 }
  }, ACTIONS.SUBMIT_CONTRACT_APPROVAL, { legalReviewerId: 6 });
  assert.equal(submittedFromNegotiation.status, STATUSES.CONTRACT_APPROVAL_IN_PROGRESS);

  const submitted = transition({
    userId: 1,
    roles: [ROLES.SALESPERSON],
    opportunity: { status: STATUSES.WON_CONTRACT_PENDING, salespersonId: 1 }
  }, ACTIONS.SUBMIT_CONTRACT_APPROVAL, { legalReviewerId: 6, comment: 'contract uploaded' });
  assert.equal(submitted.status, STATUSES.CONTRACT_APPROVAL_IN_PROGRESS);

  const resubmitted = transition({
    userId: 1,
    roles: [ROLES.SALESPERSON],
    opportunity: { status: STATUSES.CONTRACT_REJECTED, salespersonId: 1 }
  }, ACTIONS.SUBMIT_CONTRACT_APPROVAL, { legalReviewerId: 6, comment: 'revised contract uploaded' });
  assert.equal(resubmitted.status, STATUSES.CONTRACT_APPROVAL_IN_PROGRESS);

  const withdrawn = transition({
    userId: 1,
    roles: [ROLES.SALESPERSON],
    opportunity: submitted
  }, ACTIONS.WITHDRAW_CONTRACT_APPROVAL, { reason: 'replace contract' });
  assert.equal(withdrawn.status, STATUSES.WON_CONTRACT_PENDING);
});

test('legal reviewer approves or rejects active contract approval', () => {
  const approved = transition({
    userId: 6,
    roles: [ROLES.LEGAL_REVIEWER],
    opportunity: {
      status: STATUSES.CONTRACT_APPROVAL_IN_PROGRESS,
      salespersonId: 1,
      legalReviewerId: 6
    }
  }, ACTIONS.APPROVE_CONTRACT, { comment: 'legal approved' });
  assert.equal(approved.status, STATUSES.CONTRACT_ARCHIVED);
  assert.ok(approved.archivedAt);

  const rejected = transition({
    userId: 6,
    roles: [ROLES.LEGAL_REVIEWER],
    opportunity: {
      status: STATUSES.CONTRACT_APPROVAL_IN_PROGRESS,
      salespersonId: 1,
      legalReviewerId: 6
    }
  }, ACTIONS.REJECT_CONTRACT, { reason: 'missing clause' });
  assert.equal(rejected.status, STATUSES.WON_CONTRACT_PENDING);
});

test('workflow rejects invalid role status and assignee combinations', () => {
  assert.throws(() => transition({
    userId: 9,
    roles: [ROLES.SALESPERSON],
    opportunity: { status: STATUSES.INITIATION_PENDING, salespersonId: 1 }
  }, ACTIONS.WITHDRAW_INITIATION, { reason: 'not owner' }), /Action not allowed/);

  assert.throws(() => transition({
    userId: 2,
    roles: [ROLES.SALES_MANAGER],
    opportunity: { status: STATUSES.DRAFT, salespersonId: 1, salesManagerId: 2 }
  }, ACTIONS.APPROVE_INITIATION, { quotationEngineerId: 3 }), /Action not allowed/);
});
