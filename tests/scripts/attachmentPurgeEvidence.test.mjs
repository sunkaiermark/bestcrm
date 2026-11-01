import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {purgedAttachmentEntry,validateAttachmentPurgeEvidence,loadAttachmentPurgeReceipts} from '../../src/services/attachmentPurgeEvidence.mjs';
import {parseAttachmentEvidenceInventory} from '../../scripts/verify-backup-artifacts.mjs';
import {exportAttachmentEvidenceInventory} from '../../scripts/export-attachment-evidence-inventory.mjs';
const sha=x=>createHash('sha256').update(x).digest('hex');
const reason='800054：用户确认清理测试历史附件，原文件物理删除；保留版本与审计关联。';
const row={model:'opportunity_attachment',record_id:'150',opportunity_id:'55',stored_path:'2026/08/test.dwg',original_name:'test.dwg',file_size:'123',sha256:sha('original'),lifecycle_state:'retired',retirement_reason:reason};
const receiptText=JSON.stringify({reason,files:[{id:150,name:'test.dwg',path:'/var/bestcrm/uploads/2026/08/test.dwg',sha256:row.sha256,missing:false}]});
const receipts=[{receiptFile:'800054-1793490062557.json',receiptText,receiptSha256:sha(receiptText)}];
test('purge evidence requires the exact authorized retired record and unmodified administrator receipt',()=>{
 const entry=purgedAttachmentEntry(row,receipts);
 assert.equal(entry.lifecycleState,'purged');assert.equal(entry.size,0);assert.equal(entry.purgeEvidence.originalSize,123);
 assert.deepEqual(parseAttachmentEvidenceInventory(JSON.stringify(entry)),[entry]);
 for(const changed of [{lifecycle_state:'active'},{opportunity_id:'56'},{record_id:'152'},{stored_path:'2026/08/other.dwg'},{original_name:'other'},{retirement_reason:'removed'},{sha256:sha('different')},{source_inquiry_attachment_id:2}])assert.equal(purgedAttachmentEntry({...row,...changed},receipts),null);
 assert.equal(purgedAttachmentEntry(row,[]),null);
 for(const changed of [{receiptText:receiptText+' '},{receiptSha256:sha('bad')},{originalSize:-1},{opportunityId:56}])assert.throws(()=>validateAttachmentPurgeEvidence({...entry,purgeEvidence:{...entry.purgeEvidence,...changed}}));
 assert.throws(()=>parseAttachmentEvidenceInventory(JSON.stringify({...entry,size:123})));
});
test('ordinary missing and retired files remain fatal without matching purge evidence',async()=>{
 const root=await mkdtemp(path.join(os.tmpdir(),'bestcrm-purge-evidence-test-'));
 try {
  await mkdir(path.join(root,'uploads'));
  for(const lifecycle_state of ['active','retired'])await assert.rejects(exportAttachmentEvidenceInventory({queryTarget:{query:async()=>({rows:[{...row,lifecycle_state}]})},uploadDir:path.join(root,'uploads'),outputPath:path.join(root,'inventory.jsonl'),purgeReceipts:receipts}),{code:'ENOENT'});
  assert.deepEqual(await loadAttachmentPurgeReceipts(path.join(root,'absent')),[]);
 }finally{await rm(root,{recursive:true,force:true});}
});
