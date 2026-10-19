import test from 'node:test';
import assert from 'node:assert/strict';
import { testDatabase,syntheticUser } from './ai-source-fixtures.mjs';
import { createInquiryRepository } from '../../src/repositories/inquiryRepository.mjs';
import { createAiSourceRepository } from '../../src/integrations/sunkaier-ai/repository.mjs';
import { loadOpportunitySource } from '../../src/services/opportunitySourceService.mjs';

test('source uses stored lead creator and real AI lead links in the database',async()=>{
 const pool=await testDatabase();
 try{
  const recorder=await syntheticUser(pool,'source-original-recorder',['salesperson'],'Synthetic-source-test-only!');
  const manager=await syntheticUser(pool,'source-manager',['sales_manager'],'Synthetic-source-test-only!');
  const lead=(await pool.query("INSERT INTO inquiries(source,submission_type,subject,requirement_text,created_by,assigned_user_id,status) VALUES('manual','sales_lead','Synthetic origin','Synthetic only',$1,$2,'new') RETURNING id",[recorder.id,manager.id])).rows[0];
  const aiSourceRepository=createAiSourceRepository(pool),inquiryRepository=createInquiryRepository(pool);
  const options={opportunity:{id:55,originInquiryId:lead.id,salespersonId:manager.id},user:manager,inquiryRepository,aiSourceRepository,aiSourceEnabled:true,emailCenterEnabled:false};
  let source=await loadOpportunitySource(options);assert.equal(source.kind,'manual');assert.equal(source.creatorName,recorder.displayName);assert.ok(source.createdAt);assert.deepEqual(source.links,[]);
  const accepted=await aiSourceRepository.accept({clientId:'synthetic-source-test',keyId:'synthetic',hash:'a'.repeat(64),kind:'submission',externalLeadId:'synthetic-origin',payload:{external_event_id:'synthetic-event',idempotency_key:'synthetic-key',source_channel:'ai_project_search',title:'Synthetic source',occurred_at:new Date().toISOString(),requirement_summary:'Synthetic only'}});
  source=await loadOpportunitySource(options);assert.equal(source.kind,'manual');
  await pool.query('UPDATE ai_sources SET lead_id=$1 WHERE id=$2',[lead.id,accepted.receipt.submission_reference]);
  source=await loadOpportunitySource(options);assert.equal(source.kind,'ai');assert.equal(source.links[0].url,'/ai-sources/'+accepted.receipt.submission_reference);
 }finally{await pool.end();}
});
