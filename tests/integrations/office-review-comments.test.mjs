import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {testDatabase,syntheticUser} from './ai-source-fixtures.mjs';
import {createOpportunityCollaborationRepository} from '../../src/repositories/opportunityCollaborationRepository.mjs';
import {createAttachmentRepository} from '../../src/repositories/attachmentRepository.mjs';
import {createUserRepository} from '../../src/repositories/userRepository.mjs';
import {createOfficeReviewService} from '../../src/services/officeReviewService.mjs';
import {extractOfficeReviewComments} from '../../src/services/officeReviewComments.mjs';
import {storeAttachmentBuffer} from '../../src/services/attachmentFileService.mjs';
async function document(comment=''){
 const z=new JSZip();z.file('[Content_Types].xml','<Types/>');z.file('word/document.xml','<w:document xmlns:w="urn:word"><w:p><w:commentRangeStart w:id="0"/><w:r><w:t>设备压力</w:t></w:r><w:commentRangeEnd w:id="0"/></w:p></w:document>');
 if(comment)z.file('word/comments.xml','<w:comments xmlns:w="urn:word"><w:comment w:id="0" w:author="审核人" w:date="2026-10-24T01:00:00Z"><w:p><w:r><w:t>'+comment+'</w:t></w:r></w:p></w:comment></w:comments>');return z.generateAsync({type:'nodebuffer'});
}
test('Word range and Excel cell comments retain locations and plain escaped text',async()=>{
 const comments=extractOfficeReviewComments(await document('请核对压力 &amp; 温度'),'.docx');assert.equal(comments[0].location,'设备压力');assert.equal(comments[0].text,'请核对压力 & 温度');
 const zip=new JSZip();zip.file('xl/workbook.xml','<workbook xmlns:r="urn:rel"><sheets><sheet name="设备表" r:id="r1"/></sheets></workbook>');zip.file('xl/_rels/workbook.xml.rels','<Relationships><Relationship Id="r1" Target="worksheets/sheet1.xml"/></Relationships>');zip.file('xl/worksheets/_rels/sheet1.xml.rels','<Relationships><Relationship Type="urn/comments" Target="../comments/comment1.xml"/></Relationships>');zip.file('xl/comments/comment1.xml','<comments><authors><author>工程师</author></authors><commentList><comment ref="B3" authorId="0"><text><t>核对材质</t></text></comment></commentList></comments>');
 const result=extractOfficeReviewComments(await zip.generateAsync({type:'nodebuffer'}),'.xlsx');assert.equal(result[0]?.location,'设备表!B3');assert.equal(result[0]?.text,'核对材质');
});
test('reviewer online modification is disabled without touching original files or historic snapshots',async()=>{
 const pool=await testDatabase(),uploadDir=await mkdtemp(path.join(os.tmpdir(),'office-review-'));try{
 const password='Synthetic-review-only!';const manager=await syntheticUser(pool,'review-manager',['technical_manager'],password),lead=await syntheticUser(pool,'review-lead',['quotation_engineer'],password),outsider=await syntheticUser(pool,'review-outsider',['technical_manager'],password);
 const customer=(await pool.query('INSERT INTO customers(name,owner_user_id) VALUES($1,$2) RETURNING id',['Review synthetic',manager.id])).rows[0];
 const opportunity=(await pool.query("INSERT INTO opportunities(opportunity_no,title,customer_id,requirement,status,salesperson_id,quotation_engineer_id,technical_manager_id) VALUES('SYN-REVIEW','Synthetic review',$1,'Synthetic','technical_solution_in_progress',$2,$3,$2) RETURNING id",[customer.id,manager.id,lead.id])).rows[0];
 const repo=createOpportunityCollaborationRepository(pool),attachments=createAttachmentRepository(pool);
 const wp=await repo.createWorkPackage({opportunityId:opportunity.id,planKind:'technical_solution',title:'Review work',assigneeUserId:lead.id,createdByUserId:manager.id});
 const original=await document(),stored=await storeAttachmentBuffer({uploadDir,originalName:'protocol.docx',content:original});
 const file=await attachments.createAttachment({opportunityId:opportunity.id,category:'technical_solution',originalName:'protocol.docx',mimeType:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',uploadedBy:lead.id,...stored});
 const version=await repo.submitVersion({workPackageId:wp.id,submittedByUserId:lead.id,attachmentIds:[file.id]});
 let response=original;const config={baseUrl:'https://crm.test',documentServerUrl:'https://docs.test',secret:'synthetic-review-secret-'.repeat(3)};
 const service=createOfficeReviewService({config,pool,uploadDir,userRepository:createUserRepository(pool),fetchImpl:async()=>new Response(response)});
 assert.equal(await service.access(file,manager),false);assert.equal(await service.access(file,lead),false);assert.equal(await service.access(file,outsider),false);
 await assert.rejects(()=>service.start(file,manager),error=>error.statusCode===403&&/线下修改/.test(error.message));
 assert.deepEqual(await readFile(stored.absolutePath),original);
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM office_review_sessions')).rows[0].n,0);
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM office_edit_versions')).rows[0].n,0);
 }finally{await pool.end();await rm(uploadDir,{recursive:true,force:true});}
});
