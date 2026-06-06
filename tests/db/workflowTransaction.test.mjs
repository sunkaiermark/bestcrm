import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkflowTransaction } from '../../src/db/workflowTransaction.mjs';

test('workflow transaction uses a connected client and commits after callback succeeds', async () => {
  const queries = [];
  const client = {
    async query(sql, params) {
      queries.push([String(sql).trim().split(/\s+/)[0], params]);
      if (String(sql).includes('FROM opportunities')) {
        return {
          rows: [{
            id: 10,
            opportunity_no: '800000',
            title: 'Factory upgrade',
            customer_id: 20,
            primary_contact_id: null,
            requirement: 'Upgrade line',
            estimated_amount: 1000,
            project_type: 'Automation',
            delivery_cycle: '30 days',
            expected_bid_date: '2026-07-01',
            status: 'draft',
            salesperson_id: 7,
            sales_manager_id: null,
            quotation_engineer_id: null,
            technical_manager_id: null,
            commercial_manager_id: null,
            final_deal_amount: null,
            lost_reason: null,
            won_description: null,
            archived_at: null
          }]
        };
      }
      return { rows: [] };
    },
    release() {
      queries.push(['RELEASE']);
    }
  };
  const pool = {
    async connect() {
      queries.push(['CONNECT']);
      return client;
    },
    async query() {
      throw new Error('workflow transaction should not use pool.query');
    }
  };

  const transaction = createWorkflowTransaction(pool);
  const result = await transaction(async (repositories) => {
    const opportunity = await repositories.opportunityRepository.findById(10);
    assert.equal(opportunity.id, 10);
    return 'ok';
  });

  assert.equal(result, 'ok');
  assert.deepEqual(queries.map((entry) => entry[0]), ['CONNECT', 'BEGIN', 'SELECT', 'COMMIT', 'RELEASE']);
});

test('workflow transaction rolls back and releases the client when callback fails', async () => {
  const queries = [];
  const client = {
    async query(sql) {
      queries.push([String(sql).trim().split(/\s+/)[0]]);
      return { rows: [] };
    },
    release() {
      queries.push(['RELEASE']);
    }
  };
  const pool = {
    async connect() {
      queries.push(['CONNECT']);
      return client;
    }
  };

  const transaction = createWorkflowTransaction(pool);
  await assert.rejects(() => transaction(async () => {
    throw new Error('workflow failed');
  }), /workflow failed/);

  assert.deepEqual(queries.map((entry) => entry[0]), ['CONNECT', 'BEGIN', 'ROLLBACK', 'RELEASE']);
});
