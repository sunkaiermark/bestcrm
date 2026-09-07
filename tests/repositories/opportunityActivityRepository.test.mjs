import test from 'node:test';
import assert from 'node:assert/strict';
import { createOpportunityActivityRepository } from '../../src/repositories/opportunityActivityRepository.mjs';

test('activity repository returns the stable timeline contract and enforces opportunity visibility', async () => {
  const queryTarget = {
    calls: [],
    async query(sql, params) {
      this.calls.push({ sql, params });
      return { rowCount: 1, rows: [{
        id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', opportunity_id: '41',
        type_code: 'email', label_en: 'Email', label_zh: '邮件', category: 'communication',
        status: 'received', direction: 'inbound', occurred_at: '2026-09-07T01:00:00.000Z',
        recorded_at: '2026-09-07T01:00:01.000Z', actor_user_id: null, owner_user_id: '7',
        subject: 'RFQ', summary: 'Inbound email', visibility: 'opportunity_team',
        source_system: 'email_messages', source_external_key: '99', correlation_id: null,
        parent_activity_id: null, supersedes_activity_id: null, snapshot_schema_version: 1,
        snapshot: { rawEmlSha256: 'abc' }, participants: [{ role: 'contact', contactId: 8 }],
        source: { linkRole: 'primary', emailMessageId: 99 }
      }] };
    }
  };
  const repository = createOpportunityActivityRepository(queryTarget);
  const activities = await repository.listByOpportunity(41, { visibleToUserId: 7, limit: 20 });

  assert.equal(activities[0].id, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
  assert.deepEqual(activities[0].type, { code: 'email', labelEn: 'Email', labelZh: '邮件', category: 'communication' });
  assert.deepEqual(activities[0].source, { linkRole: 'primary', emailMessageId: 99 });
  assert.match(queryTarget.calls[0].sql, /opportunity\.salesperson_id = \$2/);
  assert.match(queryTarget.calls[0].sql, /FROM opportunity_members member/);
  assert.match(queryTarget.calls[0].sql, /JOIN contract_approval_steps step/);
  assert.deepEqual(queryTarget.calls[0].params, [41, 7, 20]);
});
