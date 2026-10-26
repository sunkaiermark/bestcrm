import test from 'node:test';import assert from 'node:assert/strict';import request from 'supertest';import JSZip from 'jszip';
import {mkdtemp,rm,readFile,writeFile,mkdir} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {testDatabase,syntheticUser} from './ai-source-fixtures.mjs';import {createApp} from '../../src/server.mjs';import {loadConfig} from '../../src/config.mjs';
import {createAttachmentRepository} from '../../src/repositories/attachmentRepository.mjs';import {storeAttachmentBuffer} from '../../src/services/attachmentFileService.mjs';
test('opportunity spreadsheet preview uses a signed read-only original and retains explicit basic fallback',async()=>{
 const pool=await testDatabase(),uploadDir=await mkdtemp(path.join(os.tmpdir(),'readonly-sheet-route-'));try{
 const password='Synthetic-preview-only!',user=await syntheticUser(pool,'readonly-preview-sales',['salesperson'],password);
 const customer=(await pool.query('INSERT INTO customers(name,owner_user_id) VALUES($1,$2) RETURNING id',['Synthetic customer',user.id])).rows[0];
 const opportunity=(await pool.query("INSERT INTO opportunities(opportunity_no,title,customer_id,requirement,status,salesperson_id) VALUES('PREVIEW-DEMO','设备参数核对（示例）',$1,'Synthetic','technical_solution_in_progress',$2) RETURNING id",[customer.id,user.id])).rows[0];
 const zip=new JSZip();zip.file('[Content_Types].xml','<Types/>');zip.file('xl/workbook.xml','<workbook><sheets><sheet name="参数表"/></sheets></workbook>');zip.file('xl/worksheets/sheet1.xml','<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>Layout sample</t></is></c></row></sheetData></worksheet>');
 const original=await zip.generateAsync({type:'nodebuffer'}),stored=await storeAttachmentBuffer({uploadDir,originalName:'设备参数表（示例）.xlsx',content:original});
 const attachment=await createAttachmentRepository(pool).createAttachment({opportunityId:opportunity.id,category:'technical_solution',originalName:'设备参数表（示例）.xlsx',mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',uploadedBy:user.id,...stored});
 const app=createApp({...loadConfig({}),pool,uploadDir,sessionSecret:password,csrfProtection:true,officeConfig:{enabled:true,secret:'synthetic-viewer-secret-'.repeat(3),baseUrl:'https://crm.example.invalid',documentServerUrl:'https://docs.example.invalid:8443'},aiSourceConfig:{enabled:false,workspaceEnabled:false,keys:[]},startEmailPurgeFileCleanupLoop:()=>null});
 const agent=request.agent(app),login=await agent.get('/login');const csrf=(login.text.match(/name="_csrf"\s+value="([^"]+)"/)||[])[1];await agent.post('/login').type('form').send({username:user.username,password,_csrf:csrf});
 const url='/opportunities/'+opportunity.id+'/attachments/'+attachment.id+'/preview';
 await request(app).get(url).expect(302);
 const page=await agent.get(url).expect(200);assert.match(page.text,/spreadsheet-viewer-editor/);assert.doesNotMatch(page.text,/<table class="spreadsheet-preview-table/);
 const raw=page.text.match(/id="spreadsheet-viewer-config" type="application\/json">([\s\S]*?)<\/script>/)?.[1];assert.ok(raw);const config=JSON.parse(raw);
 assert.equal(config.editorConfig.mode,'view');assert.equal(config.document.permissions.edit,false);assert.equal(config.editorConfig.callbackUrl,undefined);
 assert.ok(page.headers['content-security-policy'].includes('https://docs.example.invalid:8443'));assert.match(page.headers['cache-control'],/no-store/);
 const sourceUrl=new URL(config.document.url);await request(app).get(sourceUrl.pathname).expect(403);
 const source=await request(app).get(sourceUrl.pathname+sourceUrl.search).buffer(true).parse((res,done)=>{const parts=[];res.on('data',part=>parts.push(part));res.on('end',()=>done(null,Buffer.concat(parts)));}).expect(200);
 assert.deepEqual(source.body,original);assert.deepEqual(await readFile(stored.absolutePath),original);
 const basic=await agent.get(url+'?previewMode=basic').expect(200);assert.match(basic.text,/<table class="spreadsheet-preview-table/);assert.match(basic.text,/简化表格预览/);
 await request(app).post('/office-preview-service/'+attachment.id+'/callback').send({status:2}).expect(403);
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM office_edit_sessions')).rows[0].n,0);
 if(process.env.CAPTURE_SPREADSHEET_PREVIEW==='true'){await mkdir('output/excel-readonly-preview',{recursive:true});await writeFile('output/excel-readonly-preview/rendered-page.html',page.text);}
 }finally{await pool.end();await rm(uploadDir,{recursive:true,force:true});}
});
