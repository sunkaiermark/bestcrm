import {applyWorkflowAction} from '../../src/services/workflowService.mjs';
import {ACTIONS} from '../../src/domain/workflow.mjs';
import {createSalesCommercialQuotationDraftRepository} from '../../src/repositories/salesCommercialQuotationDraftRepository.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {testDatabase,syntheticUser} from './ai-source-fixtures.mjs';
import {createOpportunityCollaborationRepository} from '../../src/repositories/opportunityCollaborationRepository.mjs';
import {createAttachmentRepository} from '../../src/repositories/attachmentRepository.mjs';
import {createProjectExecutionRepository} from '../../src/repositories/projectExecutionRepository.mjs';
import {startProjectAfterContractApproval} from '../../src/services/projectExecutionService.mjs';
import {createWorkflowTransaction} from '../../src/db/workflowTransaction.mjs';

test('commercial starts only after every active technical package and its paired quote are approved',async()=>{
 const pool=await testDatabase();try{
 const user=await syntheticUser(pool,'gate-manager',['technical_manager','quotation_engineer'],'Synthetic-only!');
 const c=(await pool.query('INSERT INTO customers(name,owner_user_id) VALUES($1,$2) RETURNING id',['Stage gate synthetic',user.id])).rows[0];
 const o=(await pool.query("INSERT INTO opportunities(opportunity_no,title,customer_id,requirement,status,salesperson_id,quotation_engineer_id,technical_manager_id) VALUES('GATE-1','Gate',$1,'test','technical_solution_in_progress',$2,$2,$2) RETURNING id",[c.id,user.id])).rows[0];
 const repo=createOpportunityCollaborationRepository(pool),files=createAttachmentRepository(pool);
 assert.equal((await repo.commercialReadiness(o.id)).ready,false);

 const packages=[];
 for(const title of ['Process','Mechanical']){const technical=await repo.createWorkPackage({opportunityId:o.id,planKind:'technical_solution',title,assigneeUserId:user.id,createdByUserId:user.id});const quote=await repo.ensureInternalQuotePackage(technical.id,o.id,user.id);packages.push({technical,quote});}
 await pool.query("UPDATE opportunities SET status='commercial_quote_in_progress' WHERE id=$1",[o.id]);
 await assert.rejects(createSalesCommercialQuotationDraftRepository(pool).submitFormalVersion({opportunityId:o.id,actorUserId:user.id,commercialManagerId:user.id,expectedRevisionNo:0,snapshot:{}}),error=>error.code==='BESTCRM_COLLABORATION_NOT_READY');
 await pool.query("UPDATE opportunities SET status='technical_solution_in_progress' WHERE id=$1",[o.id]);
 async function approve(wp){const f=await files.createAttachment({opportunityId:o.id,category:wp.planKind||'technical_solution',originalName:'test.txt',storedPath:'synthetic/test.txt',mimeType:'text/plain',fileSize:10,sha256:'a'.repeat(64),uploadedBy:user.id});const v=await repo.submitVersion({workPackageId:wp.id,submittedByUserId:user.id,attachmentIds:[f.id]});assert.ok(await repo.fileDecision({opportunityId:o.id,workPackageId:wp.id,attachmentId:f.id,actorUserId:user.id,action:'accepted'}));}
 await approve(packages[0].technical);await approve(packages[0].quote);await approve(packages[1].quote);
 assert.equal((await repo.commercialReadiness(o.id)).ready,false);
 assert.equal((await pool.query('SELECT status FROM opportunities WHERE id=$1',[o.id])).rows[0].status,'technical_solution_in_progress');
 await approve(packages[1].technical);
 assert.equal((await repo.commercialReadiness(o.id)).ready,true);
 const sources=await createSalesCommercialQuotationDraftRepository(pool).listTechnicalSources(o.id);
 assert.ok(sources.length>0);assert.ok(sources.every(source=>source.technicalStatus==='approved'));
 const snapshots=await pool.query(`SELECT count(*)::int AS n FROM opportunity_technical_drafts WHERE opportunity_id=$1 AND source_metadata->>'workPackageApprovalSnapshot'='true'`,[o.id]);assert.equal(snapshots.rows[0].n,1);
 assert.equal((await pool.query('SELECT status FROM opportunities WHERE id=$1',[o.id])).rows[0].status,'commercial_quote_in_progress');
 assert.equal(await repo.advanceCommercialWhenReady(o.id,user.id),false);
 const events=await pool.query("SELECT count(*)::int AS n FROM workflow_events WHERE opportunity_id=$1 AND event_type='technical_and_internal_quote_approved'",[o.id]);assert.equal(events.rows[0].n,1);
 }finally{await pool.end();}
});

test('contract-approved project creation shares the workflow transaction and is idempotent',async()=>{
 const pool=await testDatabase();try{
 const user=await syntheticUser(pool,'auto-project-reviewer',['legal_reviewer'],'Synthetic-only!');
 const c=(await pool.query('INSERT INTO customers(name,owner_user_id) VALUES($1,$2) RETURNING id',['Automatic project synthetic',user.id])).rows[0];
 const o=(await pool.query("INSERT INTO opportunities(opportunity_no,title,customer_id,requirement,status,salesperson_id) VALUES('GATE-2','Contract gate',$1,'test','contract_archived',$2) RETURNING id",[c.id,user.id])).rows[0];
 const contract=await createAttachmentRepository(pool).createAttachment({opportunityId:o.id,category:'contract',originalName:'approved.pdf',storedPath:'synthetic/approved.pdf',mimeType:'application/pdf',fileSize:10,sha256:'b'.repeat(64),uploadedBy:user.id});
 const run=createWorkflowTransaction(pool);const opportunity={id:o.id,status:'contract_archived'};
 await assert.rejects(run(async repos=>{await startProjectAfterContractApproval(repos,user,opportunity);throw Error('rollback probe');}),/rollback probe/);
 assert.equal(await createProjectExecutionRepository(pool).findByOpportunity(o.id),null);
 const first=await run(repos=>startProjectAfterContractApproval(repos,user,opportunity));assert.equal(first.created,true);assert.equal(first.projectExecution.signedContractAttachmentId,contract.id);assert.equal(first.projectExecution.projectOwnerUserId,null);
 const second=await run(repos=>startProjectAfterContractApproval(repos,user,opportunity));assert.equal(second.created,false);assert.equal(first.projectExecution.id,second.projectExecution.id);
 await assert.rejects(run(repos=>startProjectAfterContractApproval(repos,user,{...opportunity,status:'contract_approval_in_progress'})),/Contract approval is required/);
 }finally{await pool.end();}
});
test('authorized contract approval starts execution through the real workflow transaction',async()=>{
 const pool=await testDatabase();try{
 const sales=await syntheticUser(pool,'auto-contract-sales',['salesperson'],'Synthetic-only!');
 const reviewer=await syntheticUser(pool,'auto-contract-reviewer',['legal_reviewer'],'Synthetic-only!');
 const c=(await pool.query('INSERT INTO customers(name,owner_user_id) VALUES($1,$2) RETURNING id',['Workflow project synthetic',sales.id])).rows[0];
 const o=(await pool.query("INSERT INTO opportunities(opportunity_no,title,customer_id,requirement,status,salesperson_id) VALUES('GATE-3','Contract approval gate',$1,'test','contract_approval_in_progress',$2) RETURNING id",[c.id,sales.id])).rows[0];
 await createAttachmentRepository(pool).createAttachment({opportunityId:o.id,category:'contract',originalName:'approved-contract.pdf',storedPath:'synthetic/contract.pdf',mimeType:'application/pdf',fileSize:10,sha256:'c'.repeat(64),uploadedBy:sales.id});
 // An existing authorized approval is supplied as a fixture; project and opportunity writes use the real database transaction.
 let approvalRecorded=false;
 const run=createWorkflowTransaction(pool);
 const after=await applyWorkflowAction({actor:reviewer,opportunityId:o.id,action:ACTIONS.APPROVE_CONTRACT,repositories:{workflowTransaction:callback=>run(repos=>callback({...repos,contractApprovalRepository:{async findActiveByOpportunity(){return {id:1,stepId:1,reviewerUserId:reviewer.id};},async approveActive(){approvalRecorded=true;}}}))}});
 assert.equal(approvalRecorded,true);
 assert.equal(after.status,'contract_archived');
 const project=await createProjectExecutionRepository(pool).findByOpportunity(o.id);assert.ok(project);assert.equal(project.projectOwnerUserId,null);
 }finally{await pool.end();}
});
