import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {createInquiryRepository} from '../../src/repositories/inquiryRepository.mjs';
import {normalizeLeadSubmissionInput} from '../../src/services/leadSubmissionService.mjs';
test('reviewed report and transaction roles round trip through actual lead update SQL',async()=>{
 const db=new PGlite();try{
 await db.exec(`CREATE TABLE inquiries(id int primary key,submission_type text,status text,created_by int,source_channel text,subject text,company_name text,company_website text,contact_name text,contact_email text,contact_phone text,country text,product_interest text,product_category_code text,confirmed_product_category_codes text[],product_category_reviewed_by int,product_category_reviewed_at timestamptz,opportunity_type text,requirement_text text,raw_payload jsonb,priority text,assigned_user_id int,recommended_salesperson_id int,review_note text,reviewed_by int,reviewed_at timestamptz,updated_at timestamptz)`);
 await db.query(`INSERT INTO inquiries(id,submission_type,status,created_by,raw_payload) VALUES(1,'sales_lead','new',7,'{"emailThreadId":4,"retained":"original"}')`);
 const input={...normalizeLeadSubmissionInput({companyName:'Agent',contactName:'Buyer',contactEmail:'a@example.invalid',contactPhone:'123',requirementText:'Human reviewed requirement',transactionRole:'agent',endUserName:'Factory',customerAnalysisReport:'Reviewed customer report',assignedUserId:2,recommendedSalespersonId:7},{id:7,isActive:true,roles:['salesperson']}),actorUserId:7};
 const repository=createInquiryRepository(db);const saved=await repository.updatePendingLead(1,input);assert.equal(saved.rawPayload.retained,'original');assert.equal(saved.rawPayload.emailThreadId,4);assert.equal(saved.rawPayload.leadAnalysis.endUserName,'Factory');assert.equal(saved.rawPayload.leadAnalysis.customerAnalysisReport,'Reviewed customer report');assert.equal(saved.requirementText,'Human reviewed requirement');
 assert.equal(await repository.updatePendingLead(1,{...input,actorUserId:8}),null);
 await db.query("UPDATE inquiries SET status='returned' WHERE id=1");const resubmitted=await repository.resubmitLead(1,input);assert.equal(resubmitted.status,'new');assert.equal(resubmitted.rawPayload.leadAnalysis.transactionRole,'agent');
 }finally{await db.close();}
});