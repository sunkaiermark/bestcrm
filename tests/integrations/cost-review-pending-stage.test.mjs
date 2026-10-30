import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import {mkdtemp,rm} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {testDatabase,syntheticUser} from './ai-source-fixtures.mjs';
import {createApp} from '../../src/server.mjs';
import {loadConfig} from '../../src/config.mjs';
import {createOpportunityCollaborationRepository} from '../../src/repositories/opportunityCollaborationRepository.mjs';
import {createAttachmentRepository} from '../../src/repositories/attachmentRepository.mjs';

test('pending commercial quote permits only independent cost-file reviews and retains later-stage protection',async()=>{
 const pool=await testDatabase(),password='Synthetic-cost-review-only!',uploadDir=await mkdtemp(path.join(os.tmpdir(),'bestcrm-cost-review-'));
 try{
  const reviewer=await syntheticUser(pool,'cost-reviewer',['technical_manager'],password);
  const lead=await syntheticUser(pool,'cost-lead',['quotation_engineer'],password);
  const customer=(await pool.query('INSERT INTO customers(name,owner_user_id) VALUES($1,$2) RETURNING id',['Synthetic cost review',reviewer.id])).rows[0];
  const op=(await pool.query("INSERT INTO opportunities(opportunity_no,title,customer_id,requirement,status,salesperson_id,quotation_engineer_id,technical_manager_id) VALUES('SYN-COST-REVIEW','Synthetic cost review',$1,'Synthetic only','commercial_quote_pending',$2,$3,$2) RETURNING id",[customer.id,reviewer.id,lead.id])).rows[0];
  const repo=createOpportunityCollaborationRepository(pool),attachments=createAttachmentRepository(pool);
  const wp=await repo.createWorkPackage({opportunityId:op.id,planKind:'internal_quote',title:'Cost files',assigneeUserId:lead.id,createdByUserId:reviewer.id});
  async function file(){return attachments.createAttachment({opportunityId:op.id,category:'internal_quote',originalName:'synthetic.xlsx',storedPath:'synthetic.xlsx',mimeType:'application/octet-stream',fileSize:100,uploadedBy:lead.id,sha256:'a'.repeat(64)});}
  const a=await file(),b=await file();await repo.submitVersion({workPackageId:wp.id,submittedByUserId:lead.id,attachmentIds:[a.id,b.id]});
  const app=createApp({...loadConfig({}),pool,uploadDir,sessionSecret:password,csrfProtection:true,aiSourceConfig:{enabled:false,workspaceEnabled:false,keys:[]},startEmailPurgeFileCleanupLoop:()=>null});
  const agent=request.agent(app),csrf=html=>(html.match(/name="_csrf"\s+value="([^"]+)"/)||[])[1];
  const login=await agent.get('/login');await agent.post('/login').type('form').send({username:reviewer.username,password,_csrf:csrf(login.text)});
  const page=await agent.get('/opportunities/'+op.id);assert.equal(page.status,200);assert.ok(page.text.includes('/collaboration-files/'+wp.id+'/'+a.id+'/accepted'));
  const action=(id,act,body={})=>agent.post('/opportunities/'+op.id+'/collaboration-files/'+wp.id+'/'+id+'/'+act).type('form').send({_csrf:csrf(page.text),...body});
  const engineer=request.agent(app),engineerLogin=await engineer.get('/login');
  await engineer.post('/login').type('form').send({username:lead.username,password,_csrf:csrf(engineerLogin.text)});
  const engineerPage=await engineer.get('/opportunities/'+op.id);
  assert.equal((await engineer.post('/opportunities/'+op.id+'/collaboration-files/'+wp.id+'/'+a.id+'/accepted').type('form').send({_csrf:csrf(engineerPage.text)})).status,403);
  assert.equal((await action(a.id,'accepted')).status,302);
  assert.equal((await pool.query('SELECT status FROM opportunity_collaboration_work_package_files WHERE attachment_id=$1',[b.id])).rows[0].status,'submitted');
  assert.equal((await action(b.id,'returned',{note:'Please revise',confirmRejection:'yes'})).status,302);
  assert.equal((await pool.query('SELECT status FROM opportunity_collaboration_work_package_files WHERE attachment_id=$1',[a.id])).rows[0].status,'accepted');
  assert.equal((await pool.query('SELECT status FROM opportunities WHERE id=$1',[op.id])).rows[0].status,'commercial_quote_pending');
  const later=await file();await repo.submitVersion({workPackageId:wp.id,submittedByUserId:lead.id,attachmentIds:[later.id],staged:true});
  assert.equal((await action(later.id,'submit')).status,409);
  assert.equal((await action(later.id,'withdraw')).status,409);
  const technical=await repo.createWorkPackage({opportunityId:op.id,planKind:'technical_solution',title:'Technical',assigneeUserId:lead.id,createdByUserId:reviewer.id});
  const t=await file();await repo.submitVersion({workPackageId:technical.id,submittedByUserId:lead.id,attachmentIds:[t.id]});
  await assert.rejects(()=>repo.fileDecision({opportunityId:op.id,workPackageId:technical.id,attachmentId:t.id,action:'accepted',actorUserId:reviewer.id,isManager:true}),/当前阶段/);
  for(const state of ['customer_negotiation','contract_approval_in_progress']){
   await pool.query('UPDATE opportunities SET status=$2 WHERE id=$1',[op.id,state]);
   assert.equal((await action(later.id,'accepted')).status,409);
  }
 }finally{await pool.end();await rm(uploadDir,{recursive:true,force:true});}
});
