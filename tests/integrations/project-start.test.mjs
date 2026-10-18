import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,readdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import request from 'supertest';
import {testDatabase,syntheticUser} from './ai-source-fixtures.mjs';
import {createApp} from '../../src/server.mjs';
import {loadConfig} from '../../src/config.mjs';
import {createOpportunityRepository} from '../../src/repositories/opportunityRepository.mjs';
import {createAttachmentRepository} from '../../src/repositories/attachmentRepository.mjs';
import {createUserRepository} from '../../src/repositories/userRepository.mjs';
import {createProjectExecutionRepository} from '../../src/repositories/projectExecutionRepository.mjs';
import {receiveSignedContract,saveGeneralManagerPlan,configureProjectExecutionWorkflow,updateProjectWorkPackage} from '../../src/services/projectExecutionService.mjs';

test('Sales upload automatically creates one project; only GM plans four departments; assignees execute without reallocating',async()=>{

 const pool=await testDatabase();
 const uploadDir=await mkdtemp(path.join(tmpdir(),'bestcrm-project-start-'));
 const password='Synthetic-local-only-'+Date.now();
 try{
  const sales=await syntheticUser(pool,'synthetic-project-sales',['salesperson'],password);
  const other=await syntheticUser(pool,'synthetic-project-other',['salesperson'],password);
  const gm=await syntheticUser(pool,'synthetic-project-gm',['general_manager'],password);
  const admin=await syntheticUser(pool,'synthetic-project-admin',['administrator'],password);
  const owner=await syntheticUser(pool,'synthetic-project-owner',[],password);
  const engineer=await syntheticUser(pool,'synthetic-project-engineer',['quotation_engineer'],password);
  const supply=await syntheticUser(pool,'synthetic-project-supply',[],password);
  const quality=await syntheticUser(pool,'synthetic-project-quality',[],password);
  const technical=await syntheticUser(pool,'synthetic-project-reviewer',['technical_manager'],password);
  const repos={opportunityRepository:createOpportunityRepository(pool),attachmentRepository:createAttachmentRepository(pool),userRepository:createUserRepository(pool),projectExecutionRepository:createProjectExecutionRepository(pool)};
  const customer=(await pool.query('INSERT INTO customers(name,owner_user_id) VALUES($1,$2) RETURNING id',['Synthetic execution customer',sales.id])).rows[0];
  const createOpportunity=async(number,status='contract_archived')=>Number((await pool.query('INSERT INTO opportunities(opportunity_no,title,customer_id,requirement,status,salesperson_id,archived_at) VALUES($1,$2,$3,$4,$5,$6,now()) RETURNING id',[number,'Synthetic project',customer.id,'Synthetic only',status,sales.id])).rows[0].id);
  const id=await createOpportunity('SYN-AUTO-PROJECT');
  const unapproved=await createOpportunity('SYN-NOT-APPROVED','contract_approval_in_progress');
  const app=createApp({...loadConfig({}),pool,uploadDir,sessionSecret:password,sessionStore:undefined,csrfProtection:true,aiSourceConfig:{enabled:false,workspaceEnabled:false,keys:[]},startEmailPurgeFileCleanupLoop:()=>null});
  const csrf=html=>(html.match(/name="_csrf" value="([^"]+)"/)||[])[1];
  async function login(user){const agent=request.agent(app);const page=await agent.get('/login');assert.equal((await agent.post('/login').type('form').send({username:user.username,password,_csrf:csrf(page.text)})).status,302);return agent;}
  const agent=await login(sales);
  const form=await agent.get('/opportunities/'+id+'/project-execution/start');assert.equal(form.status,200);
  assert.doesNotMatch(form.text,/name="(projectOwnerUserId|contractSignedOn)"/);
  const upload=()=>agent.post('/opportunities/'+id+'/attachments').field('_csrf',csrf(form.text)).field('category','signed_contract').field('projectOwnerUserId',sales.id).field('contractSignedOn','2099-01-01').attach('attachment',Buffer.from('%PDF-1.4 Synthetic contract only'),{filename:'signed.pdf',contentType:'application/pdf'});

  const first=await upload();assert.equal(first.status,302);assert.match(first.headers.location,/^\/project-executions\/\d+$/);
  const project=await repos.projectExecutionRepository.findByOpportunity(id);assert.equal(project.projectOwnerUserId,null);assert.equal(project.contractSignedOn,null);
  const projectId=project.id;

  const second=await upload();assert.equal(second.headers.location,first.headers.location);
  assert.equal(Number((await pool.query('SELECT count(*) FROM project_executions WHERE opportunity_id=$1',[id])).rows[0].count),1);
  assert.equal((await repos.attachmentRepository.listByOpportunity(id)).filter(f=>f.category==='signed_contract').length,2);
  assert.equal((await repos.projectExecutionRepository.findById(projectId)).signedContractAttachmentId,project.signedContractAttachmentId);
  const stranger=await login(other);
  assert.equal((await stranger.get('/opportunities/'+id+'/project-execution/start')).status,403);
  const rejected=await agent.post('/opportunities/'+unapproved+'/attachments').field('_csrf',csrf(form.text)).field('category','signed_contract').attach('attachment',Buffer.from('%PDF-1.4 blocked'),{filename:'blocked.pdf',contentType:'application/pdf'});assert.equal(rejected.status,403);
  const original=await agent.post('/opportunities/'+id+'/project-execution/start').type('form').send({_csrf:csrf(form.text)});assert.equal(original.status,410);
  const input={plannedStartOn:'2026-10-20',plannedCompletionOn:'2026-11-20',projectUserId:owner.id,technicalUserId:engineer.id,supply_chainUserId:supply.id,quality_controlUserId:quality.id,projectInstruction:'项目协调与交付',technicalInstruction:'图纸与技术文件',supply_chainInstruction:'采购与物料交付',quality_controlInstruction:'检验与质量控制'};
  await assert.rejects(()=>saveGeneralManagerPlan(repos,sales,projectId,input),/Forbidden/);
  await assert.rejects(()=>saveGeneralManagerPlan(repos,admin,projectId,input),/Forbidden/);
  await assert.rejects(()=>saveGeneralManagerPlan(repos,gm,projectId,{...input,quality_controlUserId:99999}),/Active department owner/);
  await assert.rejects(()=>saveGeneralManagerPlan(repos,gm,projectId,{...input,technicalStartOn:'2026-10-19'}),/within the project plan/);
  assert.equal((await repos.projectExecutionRepository.listWorkPackages(projectId)).length,0);

  await saveGeneralManagerPlan(repos,gm,projectId,input);
  const tasks=await repos.projectExecutionRepository.listWorkPackages(projectId);assert.equal(tasks.length,4);assert.deepEqual(new Set(tasks.map(t=>t.departmentCode)),new Set(['project','technical','supply_chain','quality_control']));

  const gmAgent=await login(gm);const gmPage=await gmAgent.get('/project-executions/'+projectId);assert.equal(gmPage.status,200);assert.match(gmPage.text,/General Manager plan and department assignments/);
  const contract=await gmAgent.get('/project-executions/'+projectId+'/signed-contract');assert.equal(contract.status,200);assert.match(contract.headers['content-type'],/application\/pdf/);
  const unrelated=await stranger.get('/project-executions/'+projectId+'/signed-contract');assert.equal(unrelated.status,403);
  const salesPage=await agent.get('/project-executions/'+projectId);assert.doesNotMatch(salesPage.text,/action="[^"]*department-plan"/);
  const task=tasks.find(t=>t.departmentCode==='supply_chain');
  await updateProjectWorkPackage(repos,supply,projectId,task.id,{status:'in_progress',responsibleUserId:sales.id,plannedStartOn:'2099-01-01',blockerNote:'',acceptanceNote:'采购准备'});
  const progress=await repos.projectExecutionRepository.findWorkPackage(task.id);assert.equal(progress.responsibleUserId,supply.id);assert.equal(progress.plannedStartOn,'2026-10-20');
  await saveGeneralManagerPlan(repos,gm,projectId,{...input,supply_chainUserId:other.id});
  const reassigned=await repos.projectExecutionRepository.findWorkPackage(task.id);assert.equal(reassigned.status,'in_progress');assert.equal(reassigned.responsibleUserId,other.id);
  assert.equal((await repos.projectExecutionRepository.listWorkPackages(projectId)).length,4);

  const failingId=await createOpportunity('SYN-ROLLBACK-PROJECT');
  const filePath=path.join(uploadDir,'rollback.pdf');await writeFile(filePath,Buffer.from('%PDF-1.4 rollback fixture'));
  const failing={...repos,projectExecutionRepository:{withTransaction:work=>repos.projectExecutionRepository.withTransaction((tx,client)=>work({...tx,appendAuditEvent:async()=>{throw Error('synthetic audit failure');}},client))}};
  await assert.rejects(()=>receiveSignedContract(failing,sales,failingId,{path:filePath,originalname:'rollback.pdf',mimetype:'application/pdf'},uploadDir),/synthetic audit failure/);
  assert.equal(await repos.projectExecutionRepository.findByOpportunity(failingId),null);assert.equal((await repos.attachmentRepository.listByOpportunity(failingId)).length,0);
  assert.equal((await readdir(uploadDir)).includes('rollback.pdf'),false);
  await configureProjectExecutionWorkflow(repos,gm,projectId,{projectEngineerUserId:engineer.id,processEngineerUserId:supply.id,technicalManagerUserId:technical.id,approverUserId:gm.id,publisherUserId:owner.id});
  assert.ok(await repos.projectExecutionRepository.findReleaseWorkflow(projectId));
 }finally{await pool.end();if(path.dirname(path.resolve(uploadDir))!==path.resolve(tmpdir()))throw Error('Unexpected cleanup path');await rm(uploadDir,{recursive:true,force:true});}
});
