import {createUserRepository} from '../repositories/userRepository.mjs';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {readFile} from 'node:fs/promises';
import {officeError,officeContentHash,signOfficeToken,verifyOfficeToken,downloadOfficeResult} from './officeEditingService.mjs';
import {inspectStoredAttachmentFile,storeAttachmentBuffer,removeStoredAttachmentFile} from './attachmentFileService.mjs';
import {createAttachmentRepository} from '../repositories/attachmentRepository.mjs';
import {createOpportunityRepository} from '../repositories/opportunityRepository.mjs';
import {createOpportunityCollaborationRepository} from '../repositories/opportunityCollaborationRepository.mjs';
import {canViewOpportunity} from './opportunityService.mjs';
import {loadOfficeWorkPackageContext} from './officeWorkPackageService.mjs';
import {extractOfficeReviewComments} from './officeReviewComments.mjs';
export function assertOfficeReviewPermission({attachment,opportunity,context,user,write=false}){
 if(!attachment||(write&&attachment.retiredAt)||!user||user.isActive===false||!context||(write&&context.deleted)||!opportunity||(write&&opportunity.archivedAt)||Number(context.opportunityId)!==Number(attachment.opportunityId)||!canViewOpportunity(user,opportunity))throw officeError('无权查看此审核稿。',403);
 if(!['.docx','.xlsx'].includes(path.extname(attachment.originalName).toLowerCase()))throw officeError('仅支持 DOCX 和 XLSX 批注。',400);
 if(write&&(!user.roles?.includes('technical_manager')||Number(opportunity.technicalManagerId)!==Number(user.id)||context.versionId!==context.latestVersionId||context.versionStatus!=='submitted'))throw officeError('仅本商机批准人可对最新待审核文件添加批注；原文不可修改。',403);
 return context;
}
export function createOfficeReviewService({config,pool,uploadDir,userRepository,fetchImpl=fetch}){
 const attachmentRepo=createAttachmentRepository(pool);
 async function authorize(attachment,user,write=false,target=pool,lock=false){
  if(lock)await target.query('SELECT id FROM opportunities WHERE id=$1 FOR UPDATE',[attachment.opportunityId]);
  const opportunity=await createOpportunityRepository(target).findById(attachment.opportunityId);
  if(opportunity){const team=await createOpportunityCollaborationRepository(target).listTechnicalTeam(opportunity.id);opportunity.teamMembers=team.map(r=>({userId:Number(r.user_id),roleCode:'quotation_engineer',isActive:true}));}
  const context=await loadOfficeWorkPackageContext(target,attachment.id,{lock});
  return assertOfficeReviewPermission({attachment,opportunity,context,user,write});
 }
 const latest=async(id,target=pool)=>(await target.query('SELECT * FROM office_review_snapshots WHERE attachment_id=$1 ORDER BY id DESC LIMIT 1',[id])).rows[0];
 async function access(attachment,user){try{await authorize(attachment,user,true);return true;}catch(e){if([400,403,404].includes(e.statusCode))return false;throw e;}}
 async function start(attachment,user){
  const client=await pool.connect();try{
   await client.query('BEGIN');const context=await authorize(attachment,user,true,client,true);
   await client.query("UPDATE office_review_sessions SET state='closed' WHERE attachment_id=$1 AND expires_at<=now() AND state='editing'",[attachment.id]);
   const existing=(await client.query("SELECT * FROM office_review_sessions WHERE attachment_id=$1 AND state='editing'",[attachment.id])).rows[0];
   if(existing&&Number(existing.actor_user_id)!==Number(user.id))throw officeError('该文件已有审核窗口，请先关闭原窗口。',409);
   const id=existing?.id||randomUUID();
   if(!existing)await client.query("INSERT INTO office_review_sessions(id,attachment_id,work_package_version_id,actor_user_id,expires_at) VALUES($1,$2,$3,$4,now()+interval '24 hours')",[id,attachment.id,context.versionId,user.id]);
   await client.query('COMMIT');return id;
  }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
 }
 async function editor(id,user){
  const session=(await pool.query('SELECT * FROM office_review_sessions WHERE id=$1',[id])).rows[0];
  if(!session||Number(session.actor_user_id)!==Number(user.id))throw officeError('Not found',404);
  if(session.state!=='editing'||new Date(session.expires_at)<=new Date())throw officeError('审核窗口已结束，请重新打开。',409);
  const attachment=await attachmentRepo.findById(session.attachment_id);await authorize(attachment,user,true);
  const saved=await latest(attachment.id),token=signOfficeToken({session:id,purpose:'review-download',exp:Math.floor(new Date(session.expires_at).getTime()/1000)},config.secret);
  const settings={documentType:attachment.originalName.toLowerCase().endsWith('.xlsx')?'cell':'word',type:'desktop',width:'100%',height:'100%',document:{key:id,fileType:path.extname(attachment.originalName).slice(1).toLowerCase(),title:attachment.originalName+'（审核批注稿）',url:`${config.baseUrl}/office-review-service/${id}/file?token=${encodeURIComponent(token)}`,permissions:{edit:false,comment:true,review:false,fillForms:false,editCommentAuthorOnly:true,deleteCommentAuthorOnly:true,download:false,print:true}},editorConfig:{mode:'edit',lang:'zh-CN',callbackUrl:`${config.baseUrl}/office-review-service/${id}/callback`,user:{id:String(user.id),name:user.displayName||user.username||String(user.id)},customization:{forcesave:true,autosave:true,comments:true}}};
  return {session,attachment,saved,settings:{...settings,token:signOfficeToken(settings,config.secret)},scriptUrl:`${config.documentServerUrl}/web-apps/apps/api/documents/api.js`};
 }
 async function source(id,token){
  const signed=verifyOfficeToken(token,config.secret),session=(await pool.query('SELECT * FROM office_review_sessions WHERE id=$1',[id])).rows[0];
  if(signed.session!==id||signed.purpose!=='review-download'||!session||session.state!=='editing'||new Date(session.expires_at)<=new Date())throw officeError('Forbidden',403);
  const user=await userRepository.findByIdWithRoles(Number(session.actor_user_id)),attachment=await attachmentRepo.findById(session.attachment_id);await authorize(attachment,user,true);
  const saved=await latest(attachment.id),storedPath=saved?.stored_path||attachment.storedPath,sha256=saved?.sha256||attachment.sha256;const file=await inspectStoredAttachmentFile({uploadDir,storedPath});if(sha256&&file.sha256!==sha256)throw officeError('审核稿校验失败。',409);return {...attachment,storedPath,sha256};
 }
 async function callback(id,token){
  const signed=verifyOfficeToken(token,config.secret),data=signed.payload||signed;if(data.key!==id||!Number.isInteger(data.status))throw officeError('Invalid callback',403);
  const client=await pool.connect();let stored;
  try{
   await client.query('BEGIN');const session=(await client.query('SELECT * FROM office_review_sessions WHERE id=$1 FOR UPDATE',[id])).rows[0];
   if(!session)throw officeError('Not found',404);if(session.state==='closed'){await client.query('COMMIT');return;}
   if(new Date(session.expires_at)<=new Date())throw officeError('审核会话已过期。',403);
   if([2,6].includes(data.status)){
    const attachment=await createAttachmentRepository(client).findById(session.attachment_id),user=await createUserRepository(client).findByIdWithRoles(Number(session.actor_user_id));
    const context=await authorize(attachment,user,true,client,true);
    if(context.versionId!==Number(session.work_package_version_id))throw officeError('审核版本已变更。',409);
    const buffer=await downloadOfficeResult(data.url,config,fetchImpl),extension=path.extname(attachment.originalName).toLowerCase();await officeContentHash(buffer,extension);
    const comments=extractOfficeReviewComments(buffer,extension),contentHash=(await import('node:crypto')).createHash('sha256').update(JSON.stringify(comments)).digest('hex');
    const prior=await latest(attachment.id,client);
    let previousHash=prior?.content_hash;
    if(!prior){const original=await inspectStoredAttachmentFile({uploadDir,storedPath:attachment.storedPath});if(attachment.sha256&&original.sha256!==attachment.sha256)throw officeError('原附件校验失败。',409);const originalComments=extractOfficeReviewComments(await readFile(original.absolutePath),extension);previousHash=(await import('node:crypto')).createHash('sha256').update(JSON.stringify(originalComments)).digest('hex');}
    // Archive comments separately. Never update an attachment, work package version or approval.
    if(previousHash!==contentHash){
     stored=await storeAttachmentBuffer({uploadDir,originalName:attachment.originalName,content:buffer,prefix:'office-reviews'});
     await client.query('INSERT INTO office_review_snapshots(session_id,attachment_id,work_package_version_id,actor_user_id,stored_path,sha256,content_hash,comments) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb)',[id,attachment.id,context.versionId,user.id,stored.storedPath,stored.sha256,contentHash,JSON.stringify(comments)]);
    }
   }
   if([2,4].includes(data.status))await client.query("UPDATE office_review_sessions SET state='closed' WHERE id=$1",[id]);
   if([3,7].includes(data.status))throw officeError('批注保存失败，请保留审核窗口。',502);
   await client.query('COMMIT');stored=null;
  }catch(e){await client.query('ROLLBACK');if(stored)await removeStoredAttachmentFile(stored.absolutePath);throw e;}finally{client.release();}
 }
 async function history(attachment,user){await authorize(attachment,user);return (await pool.query('SELECT r.*,u.display_name,u.username FROM office_review_snapshots r JOIN users u ON u.id=r.actor_user_id WHERE r.attachment_id=$1 ORDER BY r.id DESC',[attachment.id])).rows;}
 async function snapshot(snapshotId,user){const row=(await pool.query('SELECT * FROM office_review_snapshots WHERE id=$1',[snapshotId])).rows[0];if(!row)throw officeError('Not found',404);const attachment=await attachmentRepo.findById(row.attachment_id);await authorize(attachment,user);const file=await inspectStoredAttachmentFile({uploadDir,storedPath:row.stored_path});if(file.sha256!==row.sha256)throw officeError('批注稿校验失败。',409);return {...attachment,storedPath:row.stored_path};}
 async function historyIfLinked(attachment,user){if(!['.docx','.xlsx'].includes(path.extname(attachment.originalName).toLowerCase()))return [];const context=await loadOfficeWorkPackageContext(pool,attachment.id);if(!context)return [];return history(attachment,user);}
 async function viewer(snapshotId,user){const attachment=await snapshot(snapshotId,user);const token=signOfficeToken({snapshot:String(snapshotId),actor:user.id,purpose:'review-view',exp:Math.floor(Date.now()/1000)+3600},config.secret);const settings={documentType:attachment.originalName.toLowerCase().endsWith('.xlsx')?'cell':'word',width:'100%',height:'100%',document:{key:'review-snapshot-'+snapshotId,fileType:path.extname(attachment.originalName).slice(1).toLowerCase(),title:attachment.originalName+'（审核批注稿）',url:config.baseUrl+'/office-review-service/snapshots/'+snapshotId+'/file?token='+encodeURIComponent(token),permissions:{edit:false,comment:false,review:false,fillForms:false,download:false,print:true}},editorConfig:{mode:'view',lang:'zh-CN',customization:{comments:true}}};return {attachment,settings:{...settings,token:signOfficeToken(settings,config.secret)},scriptUrl:config.documentServerUrl+'/web-apps/apps/api/documents/api.js'};}
 async function viewerSource(snapshotId,token){const signed=verifyOfficeToken(token,config.secret);if(signed.purpose!=='review-view'||signed.snapshot!==String(snapshotId))throw officeError('Forbidden',403);return snapshot(snapshotId,await userRepository.findByIdWithRoles(Number(signed.actor)));}
 return {access,start,editor,source,callback,history,historyIfLinked,snapshot,viewer,viewerSource};
}
