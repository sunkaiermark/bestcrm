import test from 'node:test';
import assert from 'node:assert/strict';
import { createTechnicalDocumentCustomerReleaseRepository } from '../../src/repositories/technicalDocumentCustomerReleaseRepository.mjs';

function target(rows = []) {
  return {
    queries: [],
    async query(sql, params) {
      this.queries.push({ sql, params });
      return { rows: rows.shift() || [] };
    }
  };
}

test('a release request binds an exact approved file, opportunity, customer and checksum', async () => {
  const db = target([[{
    id: '1', technical_document_id: '61', opportunity_id: '20', customer_id: '30',
    file_sha256: 'a'.repeat(64), purpose: 'Customer offer', status: 'pending', requested_by: '7'
  }]]);
  const repository = createTechnicalDocumentCustomerReleaseRepository(db);
  const release = await repository.request({
    opportunityId: 20, customerId: 30, draftId: 41, documentId: 61,
    fileSha256: 'a'.repeat(64), purpose: 'Customer offer', actorUserId: 7
  });
  assert.equal(release.technicalDocumentId, 61);
  assert.equal(release.status, 'pending');
  assert.match(db.queries[0].sql, /draft\.status = 'approved'/);
  assert.match(db.queries[0].sql, /NOT draft\.self_approval_test/);
  assert.match(db.queries[0].sql, /opportunity\.customer_id = \$2/);
  assert.match(db.queries[0].sql, /document\.sha256 = \$5/);
  assert.deepEqual(db.queries[0].params, [20, 30, 41, 61, 'a'.repeat(64), 'Customer offer', 7]);
});

test('only an independent pending request may be reviewed and only approval may be revoked', async () => {
  const db = target([[], []]);
  const repository = createTechnicalDocumentCustomerReleaseRepository(db);
  await repository.review({
    opportunityId: 20, customerId: 30, documentId: 61, fileSha256: 'a'.repeat(64),
    decision: 'approved', comment: '', actorUserId: 9
  });
  await repository.revoke({
    opportunityId: 20, customerId: 30, documentId: 61, fileSha256: 'a'.repeat(64),
    reason: 'Superseded', actorUserId: 9
  });
  assert.match(db.queries[0].sql, /rel\.status = 'pending' AND rel\.requested_by <> \$7/);
  assert.match(db.queries[1].sql, /rel\.status = 'approved'/);
  assert.deepEqual(db.queries[1].params, [20, 30, 61, 'a'.repeat(64), 'Superseded', 9]);
});
