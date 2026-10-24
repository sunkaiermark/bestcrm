import test from 'node:test';
import assert from 'node:assert/strict';
import {createOpportunityCollaborationRepository} from '../../src/repositories/opportunityCollaborationRepository.mjs';

function pgPool(query) {
  const statements=[];
  let acquired=0, released=0, reconnected=0;
  const client={
    connect(){reconnected++;throw Error('Client has already been connected. You cannot reuse a client.');},
    async query(sql, values){statements.push(sql);if(['BEGIN','COMMIT','ROLLBACK'].includes(sql))return {rows:[]};return query(sql,values);},
    release(){released++;}
  };
  return {pool:{async connect(){acquired++;return client;}},statements,check(){assert.equal(acquired,1);assert.equal(released,1);assert.equal(reconnected,0);}};
}

for(const method of ['saveTechnicalTeam','fileDecision','applyTechnicalLifecycle']) {
  test(`${method} rolls back query failures without reconnecting a pg pooled client`,async()=>{
    const failure=new Error('Synthetic database failure');
    const pg=pgPool(()=>{throw failure;});
    const repo=createOpportunityCollaborationRepository(pg.pool);
    await assert.rejects(repo[method]({opportunityId:1,workPackageId:2,status:'accepted',assignments:[]}),error=>error===failure);
    assert.equal(pg.statements[0],'BEGIN');assert.equal(pg.statements.at(-1),'ROLLBACK');
    assert.ok(!pg.statements.includes('COMMIT'));pg.check();
  });
}
test('obsolete batch approval is rejected before connecting to the database',async()=>{
 const pg=pgPool(()=>{throw Error('must not query');});
 await assert.rejects(createOpportunityCollaborationRepository(pg.pool).reviewVersion({}),error=>error.statusCode===409);
 assert.equal(pg.statements.length,0);
});