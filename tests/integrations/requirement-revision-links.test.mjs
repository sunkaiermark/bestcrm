import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import {mkdtemp,rm,mkdir,writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {testDatabase,syntheticUser} from './ai-source-fixtures.mjs';
import {createApp} from '../../src/server.mjs';
import {loadConfig} from '../../src/config.mjs';
import {createOpportunityCollaborationRepository} from '../../src/repositories/opportunityCollaborationRepository.mjs';

test('requirements bind uploads and source emails to their own round; historical files stay read-only and stale tabs cannot act',async()=>{
 const pool=await testDatabase(),uploadDir=await mkdtemp(path.join(os.tmpdir(),'bestcrm-requirement-round-'));
 try{
  const password='Synthetic-requirement-only!';
  const sales=await syntheticUser(pool,'req-sales',['salesperson'],password),engineer=await syntheticUser(pool,'req-engineer',['quotation_engineer'],password),manager=await syntheticUser(pool,'req-manager',['technical_manager'],password);
  const customer=(await pool.query("INSERT INTO customers(name,owner_user_id) VALUES('Requirement rounds',$1) RETURNING id",[sales.id])).rows[0];
  const op=(await pool.query("INSERT INTO opportunities(opportunity_no,title,customer_id,requirement,status,salesperson_id,quotation_engineer_id,technical_manager_id) VALUES('SYN-REQ-LINKS','Requirement rounds',$1,'Initial customer requirement','draft',$2,$3,$4) RETURNING id",[customer.id,sales.id,engineer.id,manager.id])).rows[0];
  const thread=(await pool.query("INSERT INTO email_threads(mailbox_key,opportunity_id,last_message_at) VALUES('synthetic@example.invalid',$1,now()) RETURNING id",[op.id])).rows[0];
  const email=(await pool.query("INSERT INTO email_messages(thread_id,direction,from_address,subject,delivery_status,received_at) VALUES($1,'inbound','customer@example.invalid','Customer changes motor','received',now()) RETURNING id",[thread.id])).rows[0];
  const foreignThread=(await pool.query("INSERT INTO email_threads(mailbox_key,last_message_at) VALUES('synthetic@example.invalid',now()) RETURNING id")).rows[0];
  const foreignEmail=(await pool.query("INSERT INTO email_messages(thread_id,direction,from_address,delivery_status,received_at) VALUES($1,'inbound','other@example.invalid','received',now()) RETURNING id",[foreignThread.id])).rows[0];
  const app=createApp({...loadConfig({}),pool,uploadDir,emailCenter:{enabled:true},sessionSecret:password,csrfProtection:true,aiSourceConfig:{enabled:false,workspaceEnabled:false,keys:[]},startEmailPurgeFileCleanupLoop:()=>null});
  const csrf=html=>(html.match(/name="_csrf"\s+value="([^"]+)"/)||[])[1];
  async function login(user){const a=request.agent(app),p=await a.get('/login');await a.post('/login').type('form').send({username:user.username,password,_csrf:csrf(p.text)});return a;}
  const seller=await login(sales),worker=await login(engineer),reviewer=await login(manager);
  const page=await seller.get('/opportunities/'+op.id);assert.equal(page.status,200);
  const upload=(agent,token,roundId,name)=>agent.post('/opportunities/'+op.id+'/attachments').field('_csrf',token).field('category','requirement').field('requirementRoundId',String(roundId)).attach('attachment',Buffer.from('%PDF-1.4\nSynthetic requirement'),{filename:name,contentType:'application/pdf'});
  assert.equal((await upload(seller,csrf(page.text),0,'R0-customer.pdf')).status,302);
  assert.equal((await seller.post('/opportunities/'+op.id+'/requirement-updates').type('form').send({_csrf:csrf(page.text),requirementText:'Initial supplementary requirement',reason:'Customer clarification'})).status,302);
  await pool.query("UPDATE opportunities SET status='technical_solution_in_progress' WHERE id=$1",[op.id]);
  const repo=createOpportunityCollaborationRepository(pool),wp=await repo.createWorkPackage({opportunityId:op.id,planKind:'technical_solution',title:'Mixer',assigneeUserId:engineer.id,createdByUserId:sales.id});
  const file=name=>({opportunityId:op.id,category:'technical_solution',originalName:name,storedPath:name,mimeType:'application/pdf',fileSize:10,uploadedBy:engineer.id,sha256:'a'.repeat(64)});
  await repo.stageFiles({workPackageId:wp.id,actorUserId:engineer.id,attachments:[file('R0-technical.pdf')]});
  let workspace=await repo.loadRevisionWorkspace(op.id),initial=workspace.rounds[0];
  const form={_csrf:csrf(page.text),expectedRoundNo:1,revisionKind:'technical',feedback:'Customer requests 45kW motor'};
  assert.equal((await seller.post('/opportunities/'+op.id+'/revision-rounds/start').type('form').send({...form,sourceEmailMessageId:foreignEmail.id})).status,400);
  assert.equal((await seller.post('/opportunities/'+op.id+'/revision-rounds/start').type('form').send({...form,sourceEmailMessageId:email.id})).status,302);
  workspace=await repo.loadRevisionWorkspace(op.id);const current=workspace.rounds[0];
  assert.equal(Number(current.source_email_message_id),Number(email.id));assert.equal(workspace.rounds.length,2);
  assert.equal((await upload(seller,csrf(page.text),initial.id,'stale.pdf')).status,409);
  const workerPage=await worker.get('/opportunities/'+op.id);
  assert.equal((await upload(worker,csrf(workerPage.text),current.id,'not-authorized.pdf')).status,403);
  assert.equal((await upload(seller,csrf(page.text),current.id,'R1-customer.pdf')).status,302);
  await repo.stageFiles({workPackageId:wp.id,actorUserId:engineer.id,expectedRevisionRoundId:current.id,attachments:[file('R1-technical.pdf')]});
  const packages=await repo.listByOpportunity(op.id),latest=packages[0].latestVersion;
  assert.equal(packages[0].versionHistory.length,2,'new requirement creates a new version even if the previous upload was not approved');
  const reviewerPage=await reviewer.get('/opportunities/'+op.id);
  assert.equal((await reviewer.post('/opportunities/'+op.id+'/collaboration-files/'+wp.id+'/'+latest.files[0].id+'/accepted').type('form').send({_csrf:csrf(reviewerPage.text),expectedRevisionRoundId:initial.id})).status,409);
  const history=await reviewer.get('/opportunities/'+op.id+'?revisionRound='+initial.id).set('Accept-Language','zh-CN');
  assert.equal(history.status,200);assert.match(history.text,/Initial supplementary requirement/);assert.match(history.text,/R0-customer\.pdf/);assert.doesNotMatch(history.text,/R1-customer\.pdf/);
  assert.match(history.text,/R0-technical\.pdf/);assert.doesNotMatch(history.text,/R1-technical\.pdf/);
  assert.doesNotMatch(history.text,/action="[^\"]*collaboration-files[^\"]*"/);
  assert.equal((await seller.get('/opportunities/'+op.id+'?revisionRound=999999')).status,404);
  workspace=await repo.loadRevisionWorkspace(op.id);assert.equal(workspace.linkedAttachments.length,2);
  if(process.env.BESTCRM_CAPTURE_REVISION_PREVIEW==='1'){
   await mkdir('output/revision-round-preview',{recursive:true});
   const live=await seller.get('/opportunities/'+op.id).set('Accept-Language','zh-CN');
   await writeFile('output/revision-round-preview/requirements-live.html',live.text);
   await writeFile('output/revision-round-preview/requirements-history.html',history.text);
   const engineerView=await worker.get('/opportunities/'+op.id).set('Accept-Language','zh-CN');
   await writeFile('output/revision-round-preview/requirements-engineer.html',engineerView.text);
   await repo.fileDecision({opportunityId:op.id,workPackageId:wp.id,attachmentId:latest.files[0].id,action:'submit',actorUserId:engineer.id,expectedRevisionRoundId:current.id});
   const reviewView=await reviewer.get('/opportunities/'+op.id).set('Accept-Language','zh-CN');
   await writeFile('output/revision-round-preview/requirements-reviewer.html',reviewView.text);
  }
 }finally{await pool.end();await rm(uploadDir,{recursive:true,force:true});}
});
