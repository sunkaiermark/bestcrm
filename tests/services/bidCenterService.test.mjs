import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BID_CENTER_ERROR_CODES,
  BID_CENTER_REPOSITORY_METHODS,
  BidCenterServiceError,
  createBidCenterRepository,
  createBidCenterService
} from '../../src/services/bidCenterService.mjs';

test('bid center service is disabled by default and fails closed', () => {
  const service = createBidCenterService();

  assert.equal(service.enabled, false);
  assert.equal(Object.isFrozen(service), true);
  assert.throws(
    () => service.assertEnabled(),
    (error) => error instanceof BidCenterServiceError
      && error.code === BID_CENTER_ERROR_CODES.DISABLED
      && error.statusCode === 404
  );
});

test('bid center service accepts only the boolean true as enabled', () => {
  assert.equal(createBidCenterService({ enabled: true }).assertEnabled(), true);
  assert.throws(() => createBidCenterService({ enabled: 'true' }).assertEnabled(), /disabled/);
  assert.throws(() => createBidCenterService({ enabled: 1 }).assertEnabled(), /disabled/);
});

test('repository skeleton exposes the frozen interface and fails explicitly when unimplemented', async () => {
  const repository = createBidCenterRepository();

  assert.deepEqual(Object.keys(repository), BID_CENTER_REPOSITORY_METHODS);
  assert.equal(Object.isFrozen(repository), true);
  await assert.rejects(
    () => repository.findWorkspaceByOpportunityId(20),
    (error) => error instanceof BidCenterServiceError
      && error.code === BID_CENTER_ERROR_CODES.REPOSITORY_NOT_IMPLEMENTED
      && error.statusCode === 501
      && error.details.methodName === 'findWorkspaceByOpportunityId'
  );
});

test('repository skeleton supports explicit method implementations', async () => {
  const repository = createBidCenterRepository({
    async findWorkspaceByOpportunityId(opportunityId) {
      return { id: 9, opportunityId };
    }
  });

  assert.deepEqual(await repository.findWorkspaceByOpportunityId(20), { id: 9, opportunityId: 20 });
  await assert.rejects(() => repository.listCommercialDrafts(9), /not implemented/);
});

test('repository skeleton rejects unknown or non-function implementations', () => {
  assert.throws(
    () => createBidCenterRepository({ unknownMethod() {} }),
    /Unknown bid center repository method/
  );
  assert.throws(
    () => createBidCenterRepository({ createWorkspace: true }),
    /createWorkspace must be a function/
  );
  assert.throws(() => createBidCenterRepository([]), /must be an object/);
});
