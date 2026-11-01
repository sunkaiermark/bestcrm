import {createHash} from 'node:crypto';
import {lstat, readFile, readdir, realpath} from 'node:fs/promises';
import path from 'node:path';

const hash=value=>createHash('sha256').update(value).digest('hex');

// Receipts are administrator-controlled audit files, never request parameters.
export async function loadAttachmentPurgeReceipts(directory='/var/log/bestcrm-test-cleanup') {
 let info;
 try {info=await lstat(directory);} catch(error) {if(error.code==='ENOENT')return [];throw error;}
 if(!info.isDirectory()||info.isSymbolicLink()||info.uid!==0||(info.mode&0o022)||await realpath(directory)!==directory)throw Error('Unsafe attachment purge receipt directory');
 const receipts=[];
 for(const name of (await readdir(directory)).filter(n=>/^800054-\d+\.json$/.test(n)).sort()) {
  const file=path.join(directory,name),st=await lstat(file);
  if(!st.isFile()||st.isSymbolicLink()||st.uid!==0||(st.mode&0o022)||st.size>1048576)throw Error('Unsafe attachment purge receipt');
  const text=await readFile(file,'utf8');
  const receipt=JSON.parse(text);
  if(typeof receipt.reason!=='string'||!Array.isArray(receipt.files))throw Error('Invalid attachment purge receipt');
  receipts.push({receiptFile:name,receiptText:text,receiptSha256:hash(text)});
 }
 return receipts;
}

export function validateAttachmentPurgeEvidence(entry) {
 const e=entry.purgeEvidence;
 if(entry.model!=='opportunity_attachment'||entry.lifecycleState!=='purged'||entry.size!==0||entry.verified!==true||entry.sourceInquiryAttachmentId!==undefined)throw Error('Invalid purged attachment identity');
 if(!e||e.opportunityId!==55||![150,151,154,156,157,253].includes(entry.recordId)||!Number.isSafeInteger(e.originalSize)||e.originalSize<0||typeof e.originalName!=='string'||!e.originalName||e.reason!=='800054：用户确认清理测试历史附件，原文件物理删除；保留版本与审计关联。'||!/^800054-\d+\.json$/.test(e.receiptFile||'')||typeof e.receiptText!=='string'||e.receiptText.length>1048576||hash(e.receiptText)!==e.receiptSha256)throw Error('Invalid attachment purge evidence');
 const receipt=JSON.parse(e.receiptText);
 const matches=receipt.files?.filter(f=>Number(f.id)===entry.recordId&&f.name===e.originalName&&f.sha256===entry.sha256&&f.path===path.posix.join('/var/bestcrm/uploads',entry.storedPath));
 if(receipt.reason!==e.reason||matches?.length!==1)throw Error('Attachment purge receipt identity mismatch');
 return e;
}

export function purgedAttachmentEntry(row, receipts) {
 if(row.model!=='opportunity_attachment'||row.lifecycle_state!=='retired'||row.source_inquiry_attachment_id!=null||Number(row.opportunity_id)!==55)return null;
 for(const receipt of receipts) {
  const entry={model:row.model,recordId:Number(row.record_id),storedPath:row.stored_path,size:0,sha256:row.sha256,lifecycleState:'purged',verified:true,purgeEvidence:{...receipt,opportunityId:55,originalSize:Number(row.file_size),originalName:row.original_name,reason:row.retirement_reason}};
  try {validateAttachmentPurgeEvidence(entry);return entry;} catch { /* A receipt for a different file does not authorize this one. */ }
 }
 return null;
}
