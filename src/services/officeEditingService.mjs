import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { readOfficePackageParts } from '../utils/attachmentPreview.mjs';
import { readFile } from 'node:fs/promises';
import { inspectStoredAttachmentFile, storeAttachmentBuffer, removeStoredAttachmentFile } from './attachmentFileService.mjs';
export function officeError(message, statusCode=400) { return Object.assign(new Error(message),{statusCode}); }
export function loadOfficeConfig(env=process.env) {
  const enabled=env.OFFICE_EDIT_ENABLED==='true';
  if(!enabled)return {enabled:false};
  const documentServerUrl=new URL(env.OFFICE_DOCUMENT_SERVER_URL);
  const baseUrl=new URL(env.OFFICE_CRM_BASE_URL);
  if([documentServerUrl,baseUrl].some(u=>!['http:','https:'].includes(u.protocol)||u.username||u.password||u.search||u.hash))throw officeError('Invalid Office service URL');
  if(env.NODE_ENV==='production'&&[documentServerUrl,baseUrl].some(u=>u.protocol!=='https:'))throw officeError('Office service requires HTTPS');
  const secret=String(env.OFFICE_JWT_SECRET||'');if(Buffer.byteLength(secret)<32)throw officeError('OFFICE_JWT_SECRET must contain at least 32 bytes');
  return {enabled,documentServerUrl:documentServerUrl.href.replace(/\/$/,''),baseUrl:baseUrl.href.replace(/\/$/,''),secret};
}
export function signOfficeToken(payload,secret) {
  const h=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url'),p=Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${h}.${p}.${createHmac('sha256',secret).update(`${h}.${p}`).digest('base64url')}`;
}
export function verifyOfficeToken(token,secret) {
  try{
    const [h,p,s,...extra]=String(token||'').split('.');if(extra.length||JSON.parse(Buffer.from(h,'base64url')).alg!=='HS256')throw Error();
    const expected=createHmac('sha256',secret).update(`${h}.${p}`).digest(),actual=Buffer.from(s,'base64url');
    if(actual.length!==expected.length||!timingSafeEqual(actual,expected))throw Error();
    const payload=JSON.parse(Buffer.from(p,'base64url'));if(payload.exp&&payload.exp<=Date.now()/1000)throw Error();return payload;
  }catch{throw officeError('Invalid Office token',403);}
}
export async function officeContentHash(buffer,extension) {
  if(!['.docx','.xlsx'].includes(extension))throw officeError('Only DOCX and XLSX can be edited');
  const parts=new Map(readOfficePackageParts(buffer).map(part=>[part.name,part.data]));const names=[...parts.keys()].sort();
  if(names.length>5000||!names.includes('[Content_Types].xml')||!names.includes(extension==='.docx'?'word/document.xml':'xl/workbook.xml'))throw officeError('Invalid Office document');
  const hash=createHash('sha256');let size=0;
  for(const name of names){
    let data=parts.get(name);size+=data.length;if(size>80*1024*1024)throw officeError('Office document exceeds expanded size limit');
    if(/vbaProject\.bin$/i.test(name))throw officeError('Macro-enabled documents cannot be edited');
    if(name==='docProps/core.xml')data=Buffer.from(data.toString('utf8').replace(/<(?:dcterms:modified|cp:lastModifiedBy|cp:revision)\b[^>]*>[\s\S]*?<\/(?:dcterms:modified|cp:lastModifiedBy|cp:revision)>/g,''));
    hash.update(name).update('\0').update(data).update('\0');
  }
  return hash.digest('hex');
}
export async function downloadOfficeResult(url,config,fetchImpl=fetch) {
  const target=new URL(url),server=new URL(config.documentServerUrl);
  if(target.origin!==server.origin||target.username||target.password||!target.pathname.startsWith(`${server.pathname.replace(/\/$/,'')}/`))throw officeError('Unexpected document download origin',403);
  const r=await fetchImpl(target,{redirect:'error',signal:AbortSignal.timeout(60000)});
  if(!r.ok||Number(r.headers.get('content-length'))>25*1024*1024)throw officeError('Document download failed',502);
  const parts=[];let total=0;for await(const part of r.body){total+=part.length;if(total>25*1024*1024)throw officeError('Document exceeds 25 MB');parts.push(part);}return Buffer.concat(parts);
}
export function createOfficeEditingService({config,pool,uploadDir,authorize,fetchImpl=fetch}) {
  async function currentAttachment(id,target=pool){const {createAttachmentRepository}=await import('../repositories/attachmentRepository.mjs');return createAttachmentRepository(target).findById(id);}
  async function find(id){const r=await pool.query('SELECT * FROM office_edit_sessions WHERE id=$1',[id]);return r.rows[0];}
  async function start(attachment,user){
    await authorize(attachment,user);
    const file=await inspectStoredAttachmentFile({uploadDir,storedPath:attachment.storedPath});
    if(attachment.sha256&&file.sha256!==attachment.sha256)throw officeError('Attachment integrity check failed',409);
    const contentHash=await officeContentHash(await readFile(file.absolutePath),path.extname(attachment.originalName).toLowerCase());
    await pool.query("UPDATE office_edit_sessions SET state='closed' WHERE current_attachment_id=$1 AND state='editing' AND expires_at<=now()",[attachment.id]);
    const existing=await pool.query("SELECT id,actor_user_id FROM office_edit_sessions WHERE current_attachment_id=$1 AND state='editing'",[attachment.id]);
    if(existing.rows[0]&&Number(existing.rows[0].actor_user_id)===Number(user.id))return existing.rows[0].id;
    const parent=await pool.query('SELECT root_attachment_id,version_no FROM office_edit_sessions WHERE current_attachment_id=$1 ORDER BY created_at DESC LIMIT 1',[attachment.id]);
    const rootId=parent.rows[0]?.root_attachment_id||attachment.id;
    const versionNo=parent.rows[0]?.version_no||0;
    const id=randomUUID();
    // An active session owns this document until it is closed; concurrent starts cannot fork silently.
    try{await pool.query(`INSERT INTO office_edit_sessions(id,source_attachment_id,current_attachment_id,opportunity_id,actor_user_id,content_hash,root_attachment_id,version_no,expires_at) VALUES($1,$2,$2,$3,$4,$5,$6,$7,now()+interval '24 hours')`,[id,attachment.id,attachment.opportunityId,user.id,contentHash,rootId,versionNo]);}
    catch(e){if(e.code==='23505')throw officeError('该文档已有编辑会话，请返回原编辑窗口。',409);throw e;}
    return id;
  }
  async function editor(id,user){
    const session=await find(id);if(!session||Number(session.actor_user_id)!==Number(user.id))throw officeError('Not found',404);
    if(session.state!=='editing'||new Date(session.expires_at)<=new Date())throw officeError('编辑会话已结束，请重新打开当前版本。',409);
    const attachment=await currentAttachment(session.current_attachment_id);await authorize(attachment,user);
    const token=signOfficeToken({session:id,purpose:'download',exp:Math.floor(new Date(session.expires_at).getTime()/1000)},config.secret);
    const settings={documentType:attachment.originalName.toLowerCase().endsWith('.xlsx')?'cell':'word',type:'desktop',height:'100%',width:'100%',document:{key:id,fileType:path.extname(attachment.originalName).slice(1).toLowerCase(),title:attachment.originalName,url:`${config.baseUrl}/office-service/${id}/file?token=${encodeURIComponent(token)}`,permissions:{edit:true,download:true,print:true}},editorConfig:{mode:'edit',lang:'zh-CN',callbackUrl:`${config.baseUrl}/office-service/${id}/callback`,user:{id:String(user.id),name:user.displayName||user.username||String(user.id)},customization:{forcesave:true,autosave:true}}};
    return {session,attachment,settings:{...settings,token:signOfficeToken(settings,config.secret)},scriptUrl:`${config.documentServerUrl}/web-apps/apps/api/documents/api.js`};
  }
  async function source(id,token){const signed=verifyOfficeToken(token,config.secret),s=await find(id);if(signed.session!==id||signed.purpose!=='download'||!s||s.state!=='editing'||new Date(s.expires_at)<=new Date())throw officeError('Forbidden',403);return currentAttachment(s.current_attachment_id);}
  async function callback(id,token){
    const signed=verifyOfficeToken(token,config.secret),data=signed.payload||signed;
    if(data.key!==id||!Number.isInteger(data.status))throw officeError('Invalid callback',403);
    const client=await pool.connect();let stored;
    try{
      await client.query('BEGIN');const result=await client.query('SELECT * FROM office_edit_sessions WHERE id=$1 FOR UPDATE',[id]),s=result.rows[0];
      if(!s)throw officeError('Not found',404);
      if(s.state==='closed'){await client.query('COMMIT');return;}
      if(new Date(s.expires_at)<=new Date())throw officeError('Session expired',403);
      if([2,6].includes(data.status)){
        const attachment=await currentAttachment(s.current_attachment_id,client);
        await authorize(attachment,{id:Number(s.actor_user_id)},true,client);
        const buffer=await downloadOfficeResult(data.url,config,fetchImpl),hash=await officeContentHash(buffer,path.extname(attachment.originalName).toLowerCase());
        if(hash!==s.content_hash){
          const accessContext=await authorize(attachment,{id:Number(s.actor_user_id)},true,client);
          stored=await storeAttachmentBuffer({uploadDir,originalName:attachment.originalName,content:buffer,prefix:'office-edits'});
          const {createAttachmentRepository}=await import('../repositories/attachmentRepository.mjs');
          const saved=accessContext?.workPackage ? await (await import('./officeWorkPackageService.mjs')).saveOfficeWorkPackageRevision({client,context:accessContext.workPackage,attachment,stored,actorUserId:Number(s.actor_user_id)}) : await createAttachmentRepository(client).replaceAttachment({originalAttachmentId:attachment.id,actorUserId:Number(s.actor_user_id),reason:'office_edit_new_version',replacement:{opportunityId:attachment.opportunityId,category:attachment.category,originalName:attachment.originalName,mimeType:attachment.mimeType,uploadedBy:Number(s.actor_user_id),...stored}});
          if(!saved)throw officeError('附件已变更，请刷新后重试。',409);
          await client.query('INSERT INTO office_edit_versions(session_id,version_no,attachment_id,content_hash) VALUES($1,$2,$3,$4)',[id,s.version_no+1,saved.id,hash]);
          await client.query('UPDATE office_edit_sessions SET current_attachment_id=$2,content_hash=$3,version_no=version_no+1 WHERE id=$1',[id,saved.id,hash]);
        }
      }
      if([2,4].includes(data.status))await client.query("UPDATE office_edit_sessions SET state='closed' WHERE id=$1",[id]);
      if([3,7].includes(data.status))throw officeError('Document server failed to save',502);
      await client.query('COMMIT');stored=null;
    }catch(e){await client.query('ROLLBACK');if(stored)await removeStoredAttachmentFile(stored.absolutePath);throw e;}finally{client.release();}
  }
  async function history(attachmentId){return (await pool.query(`SELECT v.*,a.original_name,a.uploaded_at FROM office_edit_versions v JOIN office_edit_sessions s ON s.id=v.session_id JOIN attachments a ON a.id=v.attachment_id WHERE s.root_attachment_id IN (SELECT root_attachment_id FROM office_edit_sessions WHERE source_attachment_id=$1 OR current_attachment_id=$1 UNION SELECT s2.root_attachment_id FROM office_edit_sessions s2 JOIN office_edit_versions v2 ON v2.session_id=s2.id WHERE v2.attachment_id=$1) ORDER BY v.saved_at DESC`,[attachmentId])).rows;}
  async function access(attachment,user) {
    try { await authorize(attachment,user); return {allowed:true,reason:''}; }
    catch(error) { if([403,404,409].includes(error.statusCode))return {allowed:false,reason:error.message}; throw error; }
  }
  return {start,editor,source,callback,history,access};
}
