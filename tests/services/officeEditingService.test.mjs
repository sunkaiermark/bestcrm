import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { mkdtemp,rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {officeContentHash,signOfficeToken,verifyOfficeToken,downloadOfficeResult,loadOfficeConfig,createOfficeEditingService} from '../../src/services/officeEditingService.mjs';
const config={enabled:true,documentServerUrl:'https://docs.example.test',baseUrl:'https://crm.example.test',secret:'test-secret-'.repeat(5)};
async function doc(text='原文',date=new Date('2025-01-01')){const z=new JSZip();z.file('[Content_Types].xml','<Types/>',{date});z.file('word/document.xml',`<document>${text}</document>`,{date});return z.generateAsync({type:'nodebuffer'});}
test('Office content hash ignores ZIP timestamp/compression changes and detects actual edits',async()=>{
 assert.equal(await officeContentHash(await doc(),' .docx'.trim()),await officeContentHash(await doc('原文',new Date('2026-01-01')),'.docx'));
 assert.notEqual(await officeContentHash(await doc(),'.docx'),await officeContentHash(await doc('修改'),'.docx'));
 await assert.rejects(()=>officeContentHash(Buffer.from('bad'),'.docx'));
 await assert.rejects(()=>officeContentHash(awaitableBuffer(),'.xlsm'));
});
function awaitableBuffer(){return Buffer.alloc(0);}
test('Office JWT rejects tampering, expiry and wrong secrets',()=>{
 const token=signOfficeToken({key:'abc',exp:Math.floor(Date.now()/1000)+60},config.secret);
 assert.equal(verifyOfficeToken(token,config.secret).key,'abc');
 assert.throws(()=>verifyOfficeToken(token,'wrong'));
 assert.throws(()=>verifyOfficeToken(signOfficeToken({exp:1},config.secret),config.secret));
 assert.throws(()=>verifyOfficeToken(token+'x',config.secret));
});
test('Office save download rejects foreign origins before issuing requests',async()=>{
 let called=false;await assert.rejects(()=>downloadOfficeResult('http://127.0.0.1/secrets',config,async()=>{called=true;}));assert.equal(called,false);
 await assert.rejects(()=>downloadOfficeResult('https://docs.example.test/file',config,async()=>new Response('bad',{status:500})));
});
test('Office editing is disabled by default and validates enabled service settings',()=>{
 assert.deepEqual(loadOfficeConfig({}),{enabled:false});
 assert.throws(()=>loadOfficeConfig({OFFICE_EDIT_ENABLED:'true',OFFICE_DOCUMENT_SERVER_URL:'https://docs.example.test',OFFICE_CRM_BASE_URL:'https://crm.example.test',OFFICE_JWT_SECRET:'short'}));
});
test('Save creates only changed versions and duplicate callbacks do not increment version',async()=>{
 const uploadDir=await mkdtemp(path.join(os.tmpdir(),'bestcrm-office-'));let buffer=await doc();
 const s={id:'session-a',source_attachment_id:1,current_attachment_id:1,opportunity_id:9,actor_user_id:3,content_hash:await officeContentHash(buffer,'.docx'),version_no:0,state:'editing',expires_at:new Date(Date.now()+60000)};
 const records=new Map([[1,{id:1,opportunity_id:9,category:'technical_solution',original_name:'技术协议.docx',stored_path:'original.docx',mime_type:'application/vnd.openxmlformats-officedocument.wordprocessingml.document',file_size:buffer.length,uploaded_by:3}]]);
 let writes=0,allowed=true;
 const query=async(sql,args=[])=>{
  if(sql.includes('SELECT * FROM office_edit_sessions'))return {rows:[{...s}]};
  if(sql.includes('FROM attachments a'))return {rows:[records.get(Number(args[0]))].filter(Boolean)};
  if(sql.includes('WITH original AS MATERIALIZED')){const id=records.size+1;const row={id,opportunity_id:args[3],category:args[4],original_name:args[5],stored_path:args[6],mime_type:args[7],file_size:args[8],uploaded_by:args[9],sha256:args[11]};records.set(id,row);return {rows:[row]};}
  if(sql.startsWith('INSERT INTO office_edit_versions')){writes++;return {rows:[]};}
  if(sql.includes('SET current_attachment_id')){s.current_attachment_id=args[1];s.content_hash=args[2];s.version_no++;}
  if(sql.includes("SET state='closed'"))s.state='closed';
  return {rows:[]};
 };
 const pool={query,connect:async()=>({query,release(){}})};
 const service=createOfficeEditingService({config,pool,uploadDir,authorize:async()=>{if(!allowed)throw Error('forbidden');},fetchImpl:async()=>new Response(buffer)});
 const save=status=>service.callback(s.id,signOfficeToken({key:s.id,status,url:'https://docs.example.test/cache/document.docx'},config.secret));
 try{
  await save(6);assert.equal(writes,0);assert.equal(s.version_no,0);
  buffer=await doc('修改正文');await save(6);assert.equal(writes,1);assert.equal(s.version_no,1);
  const latest=await service.source(s.id,signOfficeToken({session:s.id,purpose:'download',exp:Math.floor(Date.now()/1000)+60},config.secret));assert.equal(latest.id,s.current_attachment_id);
  await save(6);assert.equal(writes,1);
  allowed=false;await assert.rejects(()=>save(6));assert.equal(writes,1);allowed=true;
  await save(2);assert.equal(writes,1);assert.equal(s.state,'closed');
  await save(2);assert.equal(writes,1);
 }finally{await rm(uploadDir,{recursive:true,force:true});}
});
