import request from 'supertest';
import {createApp} from '../../src/server.mjs';
import {loadConfig} from '../../src/config.mjs';
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
import {signOfficeToken} from '../../src/services/officeEditingService.mjs';
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
test('review comments are independently archived; original, approval and technical versions remain immutable',async()=>{
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
 assert.equal(await service.access(file,manager),true);assert.equal(await service.access(file,lead),false);assert.equal(await service.access(file,outsider),false);
 const session=await service.start(file,manager);const editor=await service.editor(session,manager);assert.equal(editor.settings.document.permissions.edit,false);assert.equal(editor.settings.document.permissions.comment,true);assert.equal(editor.settings.document.permissions.review,false);
 const save=status=>service.callback(session,signOfficeToken({key:session,status,url:'https://docs.test/cache/a.docx'},config.secret));
 await save(6);assert.equal((await service.history(file,lead)).length,0);
 response=await document('请核对设计压力');await save(6);await save(6);
 const history=await service.history(file,lead);assert.equal(history.length,1);assert.equal(history[0].comments[0].text,'请核对设计压力');
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM attachments')).rows[0].n,1);
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM opportunity_collaboration_work_package_versions')).rows[0].n,1);
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM office_edit_versions')).rows[0].n,0);
 assert.deepEqual(await readFile(stored.absolutePath),original);
 const app=createApp({...loadConfig({}),pool,uploadDir,sessionSecret:password,csrfProtection:true,officeConfig:{...config,enabled:true},aiSourceConfig:{enabled:false,workspaceEnabled:false,keys:[]},startEmailPurgeFileCleanupLoop:()=>null});
 const csrf=html=>(html.match(/name="_csrf"\s+value="([^"]+)"/)||[])[1];
 async function login(user){const agent=request.agent(app),page=await agent.get('/login');await agent.post('/login').type('form').send({username:user.username,password,_csrf:csrf(page.text)});return agent;}
 const managerAgent=await login(manager),leadAgent=await login(lead);
 const previewUrl='/opportunities/'+opportunity.id+'/attachments/'+file.id+'/preview';
 const managerPreview=await managerAgent.get(previewUrl);assert.equal(managerPreview.status,200);assert.match(managerPreview.text,/审核批注/);assert.match(managerPreview.text,/请先由有权限的人撤回提交/);assert.doesNotMatch(managerPreview.text,/>在线编辑</);
 assert.equal((await managerAgent.post(previewUrl.replace('/preview','/review'))).status,403);
 const opened=await managerAgent.post(previewUrl.replace('/preview','/review')).type('form').send({_csrf:csrf(managerPreview.text)});assert.equal(opened.status,302);assert.match(opened.headers.location,/office-review/);
 const leadPreview=await leadAgent.get(previewUrl);assert.equal(leadPreview.status,200);assert.match(leadPreview.text,/请核对设计压力/);assert.doesNotMatch(leadPreview.text,/action="[^"]*\/review"/);
 const reviewPage=await leadAgent.get('/office-review/snapshots/'+history[0].id+'/view');assert.equal(reviewPage.status,200);assert.match(reviewPage.text,/只供|仅供/);
 assert.equal((await request(app).get('/health')).status,200);
 assert.equal((await request(app).post('/office-review-service/'+session+'/callback').send({token:'invalid'})).status,403);
 const viewer=await service.viewer(history[0].id,lead);assert.equal(viewer.settings.editorConfig.mode,'view');assert.equal(viewer.settings.document.permissions.comment,false);await assert.rejects(()=>service.viewer(history[0].id,outsider));
 await assert.rejects(()=>repo.reviewVersion({workPackageId:wp.id,versionId:version.id,status:'returned',reviewedByUserId:manager.id,note:'见审核批注',requireOfficeReviewClosed:true}),/关闭审核窗口/);
 await save(2);await repo.reviewVersion({workPackageId:wp.id,versionId:version.id,status:'returned',reviewedByUserId:manager.id,note:'见审核批注',requireOfficeReviewClosed:true});
 assert.equal((await service.history(file,lead)).length,1);assert.equal(await service.access(file,manager),false);
 assert.equal((await pool.query("SELECT count(*)::int AS n FROM notifications WHERE user_id=$1 AND event_type='collaboration_review'",[lead.id])).rows[0].n,1);
 const archived=(await service.snapshot(history[0].id,lead));assert.notEqual(archived.storedPath,file.storedPath);
 }finally{await pool.end();await rm(uploadDir,{recursive:true,force:true});}
});
