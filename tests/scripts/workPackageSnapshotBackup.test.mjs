import test from 'node:test';
import assert from 'node:assert/strict';
import {PGlite} from '@electric-sql/pglite';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {exportAttachmentEvidenceInventory} from '../../scripts/export-attachment-evidence-inventory.mjs';
import {parseAttachmentEvidenceInventory} from '../../scripts/verify-backup-artifacts.mjs';

test('real SQL validates snapshot provenance; exporter and restore parser retain both immutable identities',async()=>{
 const db=new PGlite(),root=await mkdtemp(path.join(tmpdir(),'crm-snapshot-backup-'));
 const content='CAD sample',sha=createHash('sha256').update(content).digest('hex'),stored='2026/11/sample.dwg';
 try{
  await db.exec(`
   CREATE TABLE attachments(id bigint,stored_path text,file_size bigint,sha256 text,source_inquiry_attachment_id bigint,retired_at timestamptz,opportunity_id bigint,original_name text,retirement_reason text);
   CREATE TABLE inquiry_attachments(id bigint,stored_path text,file_size bigint,sha256 text);
   CREATE TABLE inquiry_attachment_purge_file_jobs(id bigint,stored_path text,expected_size bigint,expected_sha256 text,status text);
   CREATE TABLE development_material_file_activations(id bigint,material_version_id bigint,material_id bigint);
   CREATE TABLE development_material_versions(id bigint,material_id bigint,stored_path text,file_size bigint,sha256 text);
   CREATE TABLE development_materials(id bigint,topic_id bigint);
   CREATE TABLE opportunity_collaboration_work_package_files(attachment_id bigint,carried_from_attachment_id bigint);
   CREATE TABLE opportunity_technical_draft_attachments(attachment_id bigint,technical_draft_id bigint);
   CREATE TABLE opportunity_technical_drafts(id bigint,opportunity_id bigint,template_code_snapshot text,source_metadata jsonb);
  `);
  for(const id of [418,420])await db.query('INSERT INTO attachments(id,stored_path,file_size,sha256,opportunity_id,original_name) VALUES($1,$2,$3,$4,55,$5)',[id,stored,content.length,sha,'drawing.dwg']);
  await db.exec("INSERT INTO opportunity_technical_draft_attachments VALUES(420,32)");
  const metadata={workPackageApprovalSnapshot:true,approvals:[{attachment_id:418,stored_path:stored,file_size:content.length,sha256:sha}]};
  await db.query("INSERT INTO opportunity_technical_drafts VALUES(32,55,'WORK_PACKAGE_APPROVALS',$1)",[JSON.stringify(metadata)]);
  await mkdir(path.join(root,'2026/11'),{recursive:true});await writeFile(path.join(root,stored),content);
  const run=async()=>{await exportAttachmentEvidenceInventory({queryTarget:db,uploadDir:root,outputPath:path.join(root,'inventory.jsonl'),strict:true});return parseAttachmentEvidenceInventory(await readFile(path.join(root,'inventory.jsonl'),'utf8'));};
  const entries=await run();assert.equal(entries.length,2);assert.deepEqual(entries[1].sharedSourceAttachmentIds,[418]);
  const mutate=(records,change)=>{const copy=structuredClone(records);change(copy);assert.throws(()=>parseAttachmentEvidenceInventory(copy.map(r=>JSON.stringify(r)).join('\n')));};
  mutate(entries,r=>r[1].opportunityId=56);mutate(entries,r=>r[1].sha256='a'.repeat(64));mutate(entries,r=>delete r[1].sharedSourceAttachmentIds);
  mutate(entries,r=>r[0].sharedSourceAttachmentIds=[420]);mutate(entries,r=>r[1].sharedSourceAttachmentIds=[999]);
  mutate(entries,r=>r[1].verified=false);mutate(entries,r=>r[1].sharedSourceAttachmentIds=[418,418]);
  await db.exec('UPDATE opportunity_technical_drafts SET opportunity_id=56');await assert.rejects(run,/Duplicate/);
  await db.exec('UPDATE opportunity_technical_drafts SET opportunity_id=55');
  await db.query('UPDATE opportunity_technical_drafts SET source_metadata=$1',[JSON.stringify({...metadata,approvals:[{...metadata.approvals[0],sha256:'a'.repeat(64)}]})]);await assert.rejects(run,/Duplicate/);
  await db.exec('DELETE FROM opportunity_technical_draft_attachments');await db.exec('INSERT INTO opportunity_collaboration_work_package_files VALUES(420,418)');
  assert.equal((await run()).length,2);
  assert.deepEqual((await db.query('SELECT id,stored_path FROM attachments ORDER BY id')).rows.map(r=>Number(r.id)),[418,420]);
 }finally{await db.close();await rm(root,{recursive:true,force:true});}
});
