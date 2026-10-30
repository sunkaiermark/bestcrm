import test from 'node:test';
import assert from 'node:assert/strict';
import {testDatabase,syntheticUser} from './ai-source-fixtures.mjs';
import {createSalesCommercialQuotationDraftRepository} from '../../src/repositories/salesCommercialQuotationDraftRepository.mjs';
import {createOpportunityRevisionRepository} from '../../src/repositories/opportunityRevisionRepository.mjs';
import {createContractApprovalRepository} from '../../src/repositories/contractApprovalRepository.mjs';

test('formal quotation revisions block stale signing and bind the final signed version to contract',async()=>{
 const pool=await testDatabase();
 try{
  const password='Synthetic-formal-round-only!';
  const sales=await syntheticUser(pool,'formal-round-sales',['salesperson'],password);
  const manager=await syntheticUser(pool,'formal-round-manager',['commercial_manager'],password);
  const mark=await syntheticUser(pool,'杨胜华',['administrator'],password);
  const insert=async(sql,args=[])=> (await pool.query(sql,args)).rows[0];
  const customer=await insert("INSERT INTO customers(name,owner_user_id) VALUES('Formal rounds',$1) RETURNING id",[sales.id]);
  const op=await insert("INSERT INTO opportunities(opportunity_no,title,customer_id,requirement,status,salesperson_id,quotation_engineer_id,commercial_manager_id) VALUES('SYN-FORMAL-ROUNDS','Formal rounds',$1,'Synthetic','commercial_quote_in_progress',$2,$2,$3) RETURNING id",[customer.id,sales.id,manager.id]);
  const technical=await insert(`INSERT INTO opportunity_technical_drafts(opportunity_id,draft_revision_no,source_kind,language,template_code_snapshot,template_name_snapshot,template_revision_no_snapshot,content_schema_snapshot,variable_schema_snapshot,rendered_content,created_by,updated_by)
   VALUES($1,1,'uploaded_file','en','TS-D1','Technical',1,'{}','[]','{}',$2,$2) RETURNING id`,[op.id,sales.id]);
  const attachment=await insert(`INSERT INTO attachments(opportunity_id,category,original_name,stored_path,mime_type,file_size,uploaded_by,sha256) VALUES($1,'technical_solution','source.pdf','synthetic/source.pdf','application/pdf',10,$2,$3) RETURNING id`,[op.id,sales.id,'a'.repeat(64)]);
  await pool.query('INSERT INTO opportunity_technical_draft_attachments(technical_draft_id,attachment_id,sort_order,added_by) VALUES($1,$2,1,$3)',[technical.id,attachment.id,sales.id]);
  await pool.query("UPDATE opportunity_technical_drafts SET uploaded_attachment_id=$2,status='approved',formal_version_no=1,submitted_by=$3,submitted_at=now(),reviewed_by=$4,reviewed_at=now() WHERE id=$1",[technical.id,attachment.id,sales.id,manager.id]);
  await pool.query(`INSERT INTO sales_commercial_quotation_drafts(opportunity_id,source_technical_draft_id,source_attachment_id,source_sha256,source_file_name,language,currency,seller_entity_code,seller_entity_name,line_items,term_selections,created_by,updated_by)
   VALUES($1,$2,$3,$4,'source.pdf','en','USD','sunkaier_china','江苏胜开尔工业技术有限公司','[]','{}',$5,$5)`,[op.id,technical.id,attachment.id,'a'.repeat(64),sales.id]);
  const repository=createSalesCommercialQuotationDraftRepository(pool),rounds=createOpportunityRevisionRepository(pool);
  const snapshot={seller:{code:'sunkaier_china',legalName:'江苏胜开尔工业技术有限公司'}};
  const submit=async revision=>repository.submitFormalVersion({opportunityId:op.id,expectedRevisionNo:revision,actorUserId:sales.id,commercialManagerId:manager.id,snapshot});
  const q1=await submit(1);
  await assert.rejects(()=>rounds.start(sales,op.id,{expectedRoundNo:1,revisionKind:'commercial',feedback:'Cannot skip pending approval'}),/不能发起修订/);
  await repository.reviewFormalVersion({id:q1.id,opportunityId:op.id,decision:'approved',actorUserId:manager.id});
  await rounds.start(sales,op.id,{expectedRoundNo:1,revisionKind:'commercial',feedback:'Customer negotiates price'});
  assert.equal((await repository.getFormalVersion(q1.id)).isCurrentRevision,false);
  const sign=id=>repository.signFormalVersion({id,opportunityId:op.id,actorUserId:mark.id,signedAt:new Date().toISOString(),signatureSha256:'c'.repeat(64),sealSha256:null,pdfStoredPath:'synthetic/formal.pdf',pdfSha256:'b'.repeat(64),pdfFileSize:42,sourceAttachmentId:attachment.id});
  await assert.rejects(()=>sign(q1.id),/轮次已变化/);
  const q2=await submit(2);
  await repository.reviewFormalVersion({id:q2.id,opportunityId:op.id,decision:'approved',actorUserId:manager.id});
  const signed=await sign(q2.id);assert.equal(signed.status,'signed');
  await rounds.accept(sales,op.id,{expectedRoundNo:2,quoteChoice:'formal:'+q2.id,note:'Customer confirmed signed V2'});
  const contract=await createContractApprovalRepository(pool).createApproval({opportunityId:op.id,submittedBy:sales.id,reviewerUserId:manager.id});
  const frozen=await insert('SELECT final_quote_kind,final_quote_id,final_quote_snapshot FROM contract_approvals WHERE id=$1',[contract.id]);
  assert.equal(frozen.final_quote_kind,'formal');assert.equal(Number(frozen.final_quote_id),q2.id);
  assert.equal(frozen.final_quote_snapshot.quote.pdf_sha256,'b'.repeat(64));
  assert.equal(frozen.final_quote_snapshot.roundNo,2);
  await assert.rejects(()=>pool.query("UPDATE sales_commercial_quotation_versions SET approval_basis='{}' WHERE id=$1",[q1.id]),/immutable/);
 }finally{await pool.end();}
});
