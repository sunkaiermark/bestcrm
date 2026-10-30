import test from 'node:test';
import assert from 'node:assert/strict';
import {testDatabase,syntheticUser} from './ai-source-fixtures.mjs';
import {createOpportunityCollaborationRepository} from '../../src/repositories/opportunityCollaborationRepository.mjs';
import {createOpportunityRevisionRepository} from '../../src/repositories/opportunityRevisionRepository.mjs';
import request from 'supertest';
import {mkdir,writeFile} from 'node:fs/promises';
import {createApp} from '../../src/server.mjs';
import {loadConfig} from '../../src/config.mjs';
import {createCommercialQuoteRepository} from '../../src/repositories/commercialQuoteRepository.mjs';
import {createContractApprovalRepository} from '../../src/repositories/contractApprovalRepository.mjs';

test('three customer-feedback rounds preserve approval versions, reject stale cost, and bind final contract to chosen quote',async()=>{
 const pool=await testDatabase();
 try{
  const password='Synthetic-round-only!';
  const sales=await syntheticUser(pool,'round-sales',['salesperson'],password),lead=await syntheticUser(pool,'round-engineer',['quotation_engineer'],password),reviewer=await syntheticUser(pool,'round-reviewer',['technical_manager','commercial_manager','legal_reviewer'],password);
  const customer=(await pool.query('INSERT INTO customers(name,owner_user_id) VALUES($1,$2) RETURNING id',['Synthetic rounds',sales.id])).rows[0];
  const op=(await pool.query("INSERT INTO opportunities(opportunity_no,title,customer_id,requirement,status,salesperson_id,quotation_engineer_id,technical_manager_id,commercial_manager_id) VALUES('SYN-ROUNDS','搅拌设备技术方案与商务报价（示例）',$1,'Synthetic','technical_solution_in_progress',$2,$3,$4,$4) RETURNING id",[customer.id,sales.id,lead.id,reviewer.id])).rows[0];
  const collab=createOpportunityCollaborationRepository(pool),rounds=createOpportunityRevisionRepository(pool),quoteRepo=createCommercialQuoteRepository(pool),contracts=createContractApprovalRepository(pool);
  const tech={...await collab.createWorkPackage({opportunityId:op.id,planKind:'technical_solution',title:'Mixer',assigneeUserId:lead.id,createdByUserId:sales.id}),planKind:'technical_solution'};
  const cost=await collab.ensureInternalQuotePackage(tech.id,op.id,sales.id);
  const attachment=(category,name,hash)=>({opportunityId:op.id,category,originalName:name,storedPath:name,mimeType:'application/octet-stream',fileSize:100,uploadedBy:lead.id,sha256:hash.repeat(64)});
  async function upload(wp,name,hash,revision=false,replacementAttachmentId=null){
   await collab.stageFiles({workPackageId:wp.id,actorUserId:lead.id,revision,replacementAttachmentId,attachments:[attachment(wp.planKind,name,hash)]});
   const row=(await pool.query('SELECT attachment_id FROM opportunity_collaboration_work_package_files f JOIN opportunity_collaboration_work_package_versions v ON v.id=f.work_package_version_id WHERE v.work_package_id=$1 ORDER BY v.version_no DESC,f.sort_order DESC LIMIT 1',[wp.id])).rows[0];
   return Number(row.attachment_id);
  }
  async function approve(wp,file){await collab.fileDecision({opportunityId:op.id,workPackageId:wp.id,attachmentId:file,actorUserId:lead.id,action:'submit',isManager:false});await collab.fileDecision({opportunityId:op.id,workPackageId:wp.id,attachmentId:file,actorUserId:reviewer.id,action:'accepted',isManager:true});}
  async function quote(price){return quoteRepo.createQuote({opportunityId:op.id,totalPrice:price,paymentTerms:'30% advance',validityDate:'2027-01-01',remarks:'Synthetic quotation',submittedBy:lead.id,items:[]});}
  async function approveQuote(q){await quoteRepo.reviewLatestPending({opportunityId:op.id,status:'approved',reviewedBy:reviewer.id,reviewComment:'Approved'});await pool.query("UPDATE opportunities SET status='customer_negotiation' WHERE id=$1",[op.id]);}
  async function roundAttachment(category,name,hash){const r=(await rounds.load(op.id)).rounds.find(r=>!r.closed_at);return rounds.createRevisionAttachment(category==='requirement'?sales:lead,op.id,r?.id||0,attachment(category,name,hash));}
  const req0=await roundAttachment('requirement','initial-customer-requirement.pdf','0');
  const t1=await upload(tech,'technical-v1.pdf','a');
  const t1b=await upload(tech,'technical-drawing-v1.pdf','e');await approve(tech,t1);await approve(tech,t1b);
  const initialTech=(await collab.listByOpportunity(op.id)).find(w=>w.id===tech.id).latestVersion;
  const carried=initialTech.files.find(f=>f.originalName==='technical-v1.pdf');
  const c1=await upload(cost,'cost-v1.xlsx','b');await approve(cost,c1);
  await roundAttachment('commercial_quote','customer-quotation-v1.pdf','1');
  const q1=await quote(1000);await approveQuote(q1);
  let workspace=await rounds.load(op.id);assert.equal(workspace.rounds[0].round_no,1);
  const originalBasis=(await pool.query('SELECT approval_basis FROM commercial_quotes WHERE id=$1',[q1.id])).rows[0].approval_basis;
  assert.equal(Number(originalBasis.requirement.files[0].attachmentId),req0.id);
  assert.equal(originalBasis.commercialFiles[0].name,'customer-quotation-v1.pdf');
  await assert.rejects(()=>roundAttachment('requirement','cannot-change-approved-basis.pdf','9'),/已提交正式商务报价/);
  await assert.rejects(()=>rounds.start({...sales,roles:['salesperson']},op.id,{expectedRoundNo:99,revisionKind:'technical',feedback:'Stale tab'}),/轮次已变化/);
  await rounds.start({...sales,roles:['salesperson']},op.id,{expectedRoundNo:1,revisionKind:'technical',feedback:'客户要求加大电机，修订技术方案及对应价格核算。'});
  await assert.rejects(()=>quote(1100),/尚未全部批准/);
  await roundAttachment('requirement','customer-motor-change.pdf','2');
  const t2=await upload(tech,'technical-v2.pdf','c',true,carried.id);
  const staged=(await collab.listByOpportunity(op.id)).find(w=>w.id===tech.id).latestVersion;
  const second=staged.files.find(f=>f.originalName==='technical-drawing-v1.pdf');
  const t2b=await upload(tech,'technical-drawing-v2.pdf','f',false,second.id);
  await approve(tech,t2);await approve(tech,t2b);
  assert.equal((await collab.commercialReadiness(op.id)).ready,false,'approved old cost cannot follow a changed technical version');
  await assert.rejects(()=>quote(1100),/尚未全部批准/);
  const c2=await upload(cost,'cost-v2.xlsx','d',true,c1);await approve(cost,c2);
  assert.equal((await collab.commercialReadiness(op.id)).ready,true);
  await roundAttachment('commercial_quote','customer-quotation-v2.pdf','3');
  const q2=await quote(1100);await approveQuote(q2);
  assert.deepEqual((await pool.query('SELECT approval_basis FROM commercial_quotes WHERE id=$1',[q1.id])).rows[0].approval_basis,originalBasis);
  assert.equal((await pool.query('SELECT status FROM opportunity_collaboration_work_package_files WHERE attachment_id=$1',[t1])).rows[0].status,'accepted');
  assert.equal((await pool.query('SELECT retired_at FROM attachments WHERE id=$1',[t1])).rows[0].retired_at,null);
  await rounds.start({...sales,roles:['salesperson']},op.id,{expectedRoundNo:2,revisionKind:'commercial',feedback:'客户协商价格与付款条件，技术方案不变。'});
  assert.equal((await collab.commercialReadiness(op.id)).ready,true,'commercial-only feedback retains approved technical/cost basis');
  await roundAttachment('commercial_quote','customer-quotation-v3.pdf','4');
  const q3=await quote(1050);await approveQuote(q3);
  await assert.rejects(()=>rounds.accept({...sales,roles:['salesperson']},op.id,{expectedRoundNo:3,quoteKind:'legacy',quoteId:q2.id,note:'Wrong historical round'}),/current approved quotation/);
  await assert.rejects(()=>contracts.createApproval({opportunityId:op.id,submittedBy:sales.id,reviewerUserId:reviewer.id}),/最终接受/);
  const app=createApp({...loadConfig({}),pool,sessionSecret:password,csrfProtection:true,aiSourceConfig:{enabled:false,workspaceEnabled:false,keys:[]},startEmailPurgeFileCleanupLoop:()=>null});
  const csrf=html=>(html.match(/name="_csrf"\s+value="([^"]+)"/)||[])[1];
  async function login(user){const agent=request.agent(app),page=await agent.get('/login');await agent.post('/login').type('form').send({username:user.username,password,_csrf:csrf(page.text)});return agent;}
  const seller=await login(sales),engineer=await login(lead);
  const page=await seller.get('/opportunities/'+op.id).set('Accept-Language','zh-CN');assert.equal(page.status,200);assert.match(page.text,/第3轮/);
  const route='/opportunities/'+op.id+'/revision-rounds/';
  const body={expectedRoundNo:3,quoteChoice:'legacy:'+q3.id,note:'Customer email accepts final V3'};
  assert.equal((await seller.post(route+'accept').type('form').send(body)).status,403,'CSRF required');
  const engineerPage=await engineer.get('/opportunities/'+op.id);
  assert.equal((await engineer.post(route+'accept').type('form').send({...body,_csrf:csrf(engineerPage.text)})).status,403,'engineer cannot confirm customer acceptance');
  assert.equal((await seller.post(route+'start').type('form').send({_csrf:csrf(page.text),expectedRoundNo:2,revisionKind:'technical',feedback:'Stale browser'})).status,409);
  assert.equal((await seller.post(route+'accept').type('form').send({...body,_csrf:csrf(page.text)})).status,302);
  assert.equal((await seller.post(route+'accept').type('form').send({...body,_csrf:csrf(page.text)})).status,409,'double confirmation does not replace accepted choice');
  if(process.env.BESTCRM_CAPTURE_REVISION_PREVIEW==='1'){
   await mkdir('output/revision-round-preview',{recursive:true});
   await writeFile('output/revision-round-preview/negotiation.html',page.text);
   const accepted=await seller.get('/opportunities/'+op.id).set('Accept-Language','zh-CN');await writeFile('output/revision-round-preview/accepted.html',accepted.text);
  }
  const won=await seller.post('/opportunities/'+op.id+'/workflow').type('form').send({_csrf:csrf(page.text),action:'mark_won',wonDescription:'Customer accepted V3',finalDealAmount:1050});
  assert.equal(won.status,302,won.text);
  const contract=await contracts.createApproval({opportunityId:op.id,submittedBy:sales.id,reviewerUserId:reviewer.id});
  const frozen=(await pool.query('SELECT * FROM contract_approvals WHERE id=$1',[contract.id])).rows[0];
  assert.equal(Number(frozen.final_quote_id),q3.id);assert.equal(frozen.final_quote_snapshot.roundNo,3);
  assert.equal(frozen.final_quote_snapshot.quote.version_no,3);
  assert.equal(frozen.final_quote_snapshot.quote.approval_basis.commercialFiles[0].name,'customer-quotation-v3.pdf');
  assert.equal(frozen.final_quote_snapshot.quote.approval_basis.requirementHistory.length,2);
  assert.deepEqual(frozen.final_quote_snapshot.quote.approval_basis.technical.map(t=>t.versionNo),[2]);
  await assert.rejects(()=>pool.query('UPDATE contract_approvals SET final_quote_id=$2 WHERE id=$1',[contract.id,q1.id]),/immutable/);
  workspace=await rounds.load(op.id);assert.equal(workspace.rounds.length,3);assert.equal(workspace.quotes.length,3);
  await pool.query("UPDATE opportunities SET status='contract_approval_in_progress' WHERE id=$1",[op.id]);
  await assert.rejects(()=>rounds.start({...sales,roles:['salesperson']},op.id,{expectedRoundNo:3,revisionKind:'commercial',feedback:'Too late'}),/不能发起修订/);
 }finally{await pool.end();}
});
