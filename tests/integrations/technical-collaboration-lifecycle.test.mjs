import {JSDOM} from 'jsdom';
import test from 'node:test';import assert from 'node:assert/strict';import request from 'supertest';
import {mkdtemp,rm} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {testDatabase,syntheticUser} from './ai-source-fixtures.mjs';import {createApp} from '../../src/server.mjs';import {loadConfig} from '../../src/config.mjs';
import {createOpportunityCollaborationRepository} from '../../src/repositories/opportunityCollaborationRepository.mjs';import {createAttachmentRepository} from '../../src/repositories/attachmentRepository.mjs';
test('technical team positions, submission withdrawal and deletion respect approvals and preserve history',async()=>{
 const pool=await testDatabase();const password='Synthetic-tech-lifecycle-only!';const uploadDir=await mkdtemp(path.join(os.tmpdir(),'bestcrm-approval-'));
 try{
 const manager=await syntheticUser(pool,'lifecycle-manager',['technical_manager'],password),lead=await syntheticUser(pool,'lifecycle-lead',['quotation_engineer'],password),support=await syntheticUser(pool,'lifecycle-support',['quotation_engineer'],password),outsider=await syntheticUser(pool,'lifecycle-outsider',['technical_manager'],password);
 const customer=(await pool.query('INSERT INTO customers(name,owner_user_id) VALUES($1,$2) RETURNING id',['Synthetic lifecycle customer',manager.id])).rows[0];
 const opp=(await pool.query("INSERT INTO opportunities(opportunity_no,title,customer_id,requirement,status,salesperson_id,quotation_engineer_id,technical_manager_id) VALUES('SYN-TECH-LIFECYCLE','Synthetic lifecycle',$1,'Synthetic only','technical_solution_in_progress',$2,$3,$2) RETURNING id",[customer.id,manager.id,lead.id])).rows[0];
 const repo=createOpportunityCollaborationRepository(pool),attachments=createAttachmentRepository(pool);
 const app=createApp({...loadConfig({}),pool,uploadDir,sessionSecret:password,csrfProtection:true,aiSourceConfig:{enabled:false,workspaceEnabled:false,keys:[]},startEmailPurgeFileCleanupLoop:()=>null});const csrf=html=>(html.match(/name="_csrf"\s+value="([^"]+)"/)||[])[1];
 async function login(user){const a=request.agent(app),page=await a.get('/login');await a.post('/login').type('form').send({username:user.username,password,_csrf:csrf(page.text)});return a;}
 const a=await login(manager);const page=await a.get('/opportunities/'+opp.id);assert.equal(page.status,200);assert.doesNotMatch(page.text,/Edit work package:/);assert.match(page.text,/Project position/);
 const beforeIndependent=(await pool.query("SELECT count(*) AS n FROM opportunity_collaboration_work_packages WHERE plan_kind='internal_quote'")).rows[0].n;
 const rejectedIndependent=await a.post('/opportunities/'+opp.id+'/collaboration-work-packages').type('form').send({_csrf:csrf(page.text),planKind:'internal_quote',title:'Forbidden standalone quote',assigneeUserId:lead.id});
 assert.equal(rejectedIndependent.status,400);
 assert.equal((await pool.query("SELECT count(*) AS n FROM opportunity_collaboration_work_packages WHERE plan_kind='internal_quote'")).rows[0].n,beforeIndependent);
 const team={reason:'Synthetic technical team configuration',_csrf:csrf(page.text),engineerIds:[lead.id,support.id],['position_'+lead.id]:'lead',['specialty_'+lead.id]:'Overall process',['position_'+support.id]:'support',['specialty_'+support.id]:'Mechanical design'};
 assert.equal((await a.post('/opportunities/'+opp.id+'/technical-team').type('form').send(team)).status,302);
 assert.equal((await repo.listTechnicalTeam(opp.id)).length,2);
 assert.equal((await a.post('/opportunities/'+opp.id+'/technical-team').type('form').send({...team,['position_'+support.id]:'lead'})).status,302);
 const invalidLeadPage=await a.get('/opportunities/'+opp.id);assert.equal(invalidLeadPage.status,200);assert.match(invalidLeadPage.text,/请在勾选的工程师中设置且仅设置一位主任工程师/);assert.match(invalidLeadPage.text,/technical-team-editor"/);assert.match(invalidLeadPage.text,/value="Mechanical design"/);
 assert.equal((await repo.listTechnicalTeam(opp.id)).length,2);
 assert.equal((await a.post('/opportunities/'+opp.id+'/technical-team').type('form').send({...team,['specialty_'+support.id]:''})).status,302);
 const invalidSpecialtyPage=await a.get('/opportunities/'+opp.id);assert.equal(invalidSpecialtyPage.status,200);assert.match(invalidSpecialtyPage.text,/请为每位勾选的工程师填写专业内容/);{const dom=new JSDOM(invalidSpecialtyPage.text);assert.equal(dom.window.document.querySelector('[name="specialty_'+support.id+'"]').value,'');dom.window.close();}
 assert.equal((await repo.listTechnicalTeam(opp.id)).length,2);
 async function pack(title='Synthetic work'){return repo.createWorkPackage({opportunityId:opp.id,planKind:'technical_solution',title,assigneeUserId:lead.id,createdByUserId:manager.id});}
 async function submit(wp){const f=await attachments.createAttachment({opportunityId:opp.id,category:'technical_solution',originalName:'synthetic.pdf',storedPath:'synthetic.pdf',mimeType:'application/pdf',fileSize:100,uploadedBy:lead.id,sha256:'a'.repeat(64)});const v=await repo.submitVersion({workPackageId:wp.id,submittedByUserId:lead.id,attachmentIds:[f.id]});return {f,v};}
 const action=(wp,operation,body={})=>a.post('/opportunities/'+opp.id+'/technical-work-packages/'+wp.id+'/'+operation).type('form').send({_csrf:csrf(page.text),...body});
 const empty=await pack();assert.equal((await action(empty,'delete')).status,302);assert.equal(await repo.findWorkPackageById(empty.id),null);assert.ok((await pool.query('SELECT deleted_at FROM opportunity_collaboration_work_packages WHERE id=$1',[empty.id])).rows[0].deleted_at);
 const wp=await pack(),{f,v}=await submit(wp);
 assert.equal((await action(wp,'withdraw',{versionId:v.id})).status,409);
 assert.equal((await action(wp,'delete')).status,409);
 assert.equal((await action(wp,'delete-file',{versionId:v.id,attachmentId:f.id})).status,409);
 const quote=await repo.ensureInternalQuotePackage(wp.id,opp.id,lead.id);assert.equal(quote.planKind,'internal_quote');
 assert.equal((await repo.ensureInternalQuotePackage(wp.id,opp.id,lead.id)).id,quote.id);
 const other=await login(outsider),otherPage=await other.get('/workbench');
 assert.equal((await other.post('/opportunities/'+opp.id+'/collaboration-files/'+wp.id+'/'+f.id+'/accepted').type('form').send({_csrf:csrf(otherPage.text)})).status,404);
 }finally{await pool.end();await rm(uploadDir,{recursive:true,force:true});}
});
