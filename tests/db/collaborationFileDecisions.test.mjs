import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {createOpportunityCollaborationRepository} from '../../src/repositories/opportunityCollaborationRepository.mjs';
test('independent file decisions preserve siblings, returned originals and migrate old batch decisions',async()=>{
 const db=new PGlite();try{
 await db.exec(`CREATE TABLE users(id bigserial PRIMARY KEY,display_name text,username text); INSERT INTO users VALUES(1,'Engineer','engineer'),(2,'Manager','manager');
 CREATE TABLE opportunities(id bigserial PRIMARY KEY,status text,archived_at timestamptz,quotation_engineer_id bigint);INSERT INTO opportunities VALUES(1,'technical_solution_in_progress',NULL,1);
 CREATE TABLE attachments(id bigserial PRIMARY KEY,opportunity_id bigint,category text,original_name text,stored_path text,mime_type text,file_size bigint,uploaded_by bigint,source_inquiry_attachment_id bigint,sha256 text,uploaded_at timestamptz DEFAULT now(),retired_at timestamptz);
 CREATE TABLE notifications(id bigserial PRIMARY KEY,user_id bigint,event_type text,title text,body text,action_url text,source_type text,source_id bigint,actor_user_id bigint);`);
 for(const name of ['119_opportunity_collaboration_work_packages.sql','125_technical_collaboration_lifecycle.sql','126_technical_upload_before_submit.sql','128_collaboration_approved_versions.sql'])await db.exec(await readFile(new URL('../../src/db/migrations/'+name,import.meta.url),'utf8'));
 await db.exec(`ALTER TABLE opportunity_collaboration_work_packages ADD COLUMN source_work_package_id bigint;
 INSERT INTO opportunity_collaboration_work_packages(id,opportunity_id,plan_kind,title,assignee_user_id,created_by_user_id) VALUES(1,1,'technical_solution','Mixer',1,1);
 INSERT INTO opportunity_collaboration_work_package_versions(id,work_package_id,version_no,submitted_by_user_id,status,submitted_at) VALUES(1,1,1,1,'submitted',now());
 INSERT INTO attachments(id,opportunity_id,category,original_name,uploaded_by) VALUES(1,1,'technical_solution','a.docx',1),(2,1,'technical_solution','b.xlsx',1);
 SELECT setval('attachments_id_seq',2);SELECT setval('opportunity_collaboration_work_package_versions_id_seq',1);
 INSERT INTO opportunity_collaboration_work_package_files(work_package_version_id,attachment_id,sort_order,added_by_user_id) VALUES(1,1,1,1),(1,2,2,1);`);
 await db.exec(await readFile(new URL('../../src/db/migrations/133_collaboration_file_decisions.sql',import.meta.url),'utf8'));
 await db.exec('CREATE TABLE opportunity_revision_rounds(id bigint,opportunity_id bigint,closed_at timestamptz); ALTER TABLE opportunity_collaboration_work_package_versions ADD COLUMN revision_round_id bigint; ALTER TABLE opportunity_collaboration_work_package_files ADD COLUMN carried_from_attachment_id bigint');
 const repo=createOpportunityCollaborationRepository(db,{inTransaction:true});
 // This deliberately pre-134 fixture checks historical file-decision migration only.
 // Full revision readiness is exercised against all migrations in opportunity-revision-rounds.test.mjs.
 repo.commercialReadiness=async()=>({technicalCount:1,ready:false});
 const state=async()=> (await db.query('SELECT attachment_id,status,superseded_by_attachment_id FROM opportunity_collaboration_work_package_files ORDER BY attachment_id')).rows;
 assert.deepEqual((await state()).map(f=>f.status),['submitted','submitted']);
 const decision=(attachmentId,action,actorUserId=2,note='')=>repo.fileDecision({opportunityId:1,workPackageId:1,attachmentId,action,actorUserId,note});
 await assert.rejects(decision(1,'withdraw',1),/未提交/);
 await assert.rejects(decision(1,'returned',2,''),/驳回意见/);
 await decision(1,'returned',2,'Please correct the dimensions');
 assert.deepEqual((await state()).map(f=>f.status),['returned','submitted']);
 await assert.rejects(decision(1,'accepted'),/待审核/);
 await repo.stageFiles({workPackageId:1,actorUserId:1,replacementAttachmentId:1,attachments:[{opportunityId:1,category:'technical_solution',originalName:'a-revised.docx',storedPath:'new.docx',mimeType:'application/octet-stream',fileSize:3,uploadedBy:1,sha256:'abc'}]});
 assert.equal(Number((await state())[0].superseded_by_attachment_id),3);
 assert.equal((await state())[0].status,'returned');
 assert.equal((await state())[1].status,'submitted');
 assert.equal((await state())[2].status,'uploaded');
 await assert.rejects(decision(3,'submit',2),/上传者/);
 await decision(3,'submit',1);
 await decision(2,'accepted');
 assert.deepEqual((await state()).map(f=>f.status),['returned','accepted','submitted']);
 await decision(3,'accepted');
 assert.equal((await db.query('SELECT status FROM opportunity_collaboration_work_package_versions WHERE id=1')).rows[0].status,'accepted');
 const listed=await repo.listByOpportunity(1);assert.equal(listed[0].latestVersion.files[0].reviewNote,'Please correct the dimensions');
 await repo.stageFiles({workPackageId:1,actorUserId:1,revision:true,attachments:[{opportunityId:1,category:'technical_solution',originalName:'extra.pdf',storedPath:'extra.pdf',mimeType:'application/pdf',fileSize:3,uploadedBy:1,sha256:'xyz'}]});
 const versions=await db.query('SELECT status FROM opportunity_collaboration_work_package_versions ORDER BY version_no');assert.deepEqual(versions.rows.map(v=>v.status),['accepted','uploaded']);
 const latest=(await repo.listByOpportunity(1))[0].latestVersion;assert.deepEqual(latest.files.map(f=>f.status),['accepted','accepted','uploaded']);
 await assert.rejects(repo.reviewVersion({workPackageId:1}),/逐文件/);
 }finally{await db.close();}
});
