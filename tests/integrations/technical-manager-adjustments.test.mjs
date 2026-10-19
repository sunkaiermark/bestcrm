import test from 'node:test';import assert from 'node:assert/strict';import request from 'supertest';
import {testDatabase,syntheticUser} from './ai-source-fixtures.mjs';import {createApp} from '../../src/server.mjs';import {loadConfig} from '../../src/config.mjs';
import {createOpportunityCollaborationRepository} from '../../src/repositories/opportunityCollaborationRepository.mjs';
test('Technical Manager edits archived work packages with audit, preserves versions and rejects unrelated or invalid requests',async()=>{
 const pool=await testDatabase();const password='Synthetic-test-only-123!';
 try{
 const manager=await syntheticUser(pool,'synthetic-tech-manager',['technical_manager'],password),lead=await syntheticUser(pool,'synthetic-tech-lead',['quotation_engineer'],password),other=await syntheticUser(pool,'synthetic-tech-other',['technical_manager'],password);
 const support=await syntheticUser(pool,'synthetic-tech-support',['quotation_engineer'],password);
 const customer=(await pool.query('INSERT INTO customers(name,owner_user_id) VALUES($1,$2) RETURNING id',['Synthetic technical customer',lead.id])).rows[0];
 const opp=(await pool.query("INSERT INTO opportunities(opportunity_no,title,customer_id,requirement,status,salesperson_id,quotation_engineer_id,technical_manager_id,archived_at) VALUES('SYN-TECH-ADJUST','Synthetic technical adjustment',$1,'Synthetic only','contract_archived',$2,$2,$3,now()) RETURNING id",[customer.id,lead.id,manager.id])).rows[0];
 const repo=createOpportunityCollaborationRepository(pool);const wp=await repo.createWorkPackage({opportunityId:opp.id,planKind:'technical_solution',title:'Original title',assigneeUserId:lead.id,createdByUserId:lead.id});
 await pool.query("UPDATE opportunity_collaboration_work_packages SET status='accepted' WHERE id=$1",[wp.id]);
 const app=createApp({...loadConfig({}),pool,sessionSecret:password,csrfProtection:true,aiSourceConfig:{enabled:false,workspaceEnabled:false,keys:[]},startEmailPurgeFileCleanupLoop:()=>null});
 const csrf=html=>(html.match(/name="_csrf"\s+value="([^"]+)"/)||[])[1];
 async function login(user){const agent=request.agent(app);const page=await agent.get('/login');await agent.post('/login').type('form').send({username:user.username,password,_csrf:csrf(page.text)});return agent;}
 const agent=await login(manager);const page=await agent.get('/opportunities/'+opp.id);assert.equal(page.status,200);assert.doesNotMatch(page.text,/Edit work package:/);assert.match(page.text,/Project position/);
 assert.match(page.text,/technical-team/);
 const change=ids=>agent.post('/opportunities/'+opp.id+'/workflow').type('form').send({_csrf:csrf(page.text),action:'change_quotation_engineer',quotationEngineerIds:ids,quotationEngineerLeadId:lead.id});
 assert.equal((await change([lead.id,support.id])).status,302);
 assert.equal((await pool.query('SELECT count(*)::int AS count FROM opportunity_members WHERE opportunity_id=$1 AND user_id=$2 AND is_active=true',[opp.id,support.id])).rows[0].count,1);
 assert.equal((await change([lead.id])).status,302);
 assert.equal((await pool.query('SELECT count(*)::int AS count FROM opportunity_members WHERE opportunity_id=$1 AND user_id=$2 AND is_active=true',[opp.id,support.id])).rows[0].count,0);
 assert.equal((await pool.query('SELECT status FROM opportunities WHERE id=$1',[opp.id])).rows[0].status,'contract_archived');
 const url='/opportunities/'+opp.id+'/collaboration-work-packages/'+wp.id+'/update';const body={_csrf:csrf(page.text),title:'Updated title',assigneeUserId:lead.id,plannedStartDate:'2026-10-20',plannedSubmitDate:'2026-10-25'};
 assert.equal((await agent.post(url).type('form').send({...body,plannedSubmitDate:'2026-10-19'})).status,400);
 assert.equal((await agent.post(url).type('form').send({...body,assigneeUserId:other.id})).status,400);
 assert.equal((await agent.post(url).type('form').send(body)).status,302);
 const after=await repo.findWorkPackageById(wp.id);assert.equal(after.title,'Updated title');assert.equal(after.status,'accepted');
 const events=await pool.query("SELECT * FROM opportunity_collaboration_work_package_events WHERE work_package_id=$1 AND event_type='updated'",[wp.id]);assert.equal(events.rows.length,1);assert.match(events.rows[0].note,/Original title/);assert.match(events.rows[0].note,/Updated title/);
 const unrelated=await login(other);assert.equal((await unrelated.post(url).type('form').send(body)).status,403);
 const missing=await agent.post('/opportunities/'+opp.id+'/collaboration-work-packages/999999/update').type('form').send(body);assert.equal(missing.status,404);
 }finally{await pool.end();}
});