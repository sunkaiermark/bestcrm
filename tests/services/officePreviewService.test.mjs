import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {createOfficePreviewService} from '../../src/services/officePreviewService.mjs';
import {verifyOfficeToken,signOfficeToken} from '../../src/services/officeEditingService.mjs';
const config={baseUrl:'https://crm.example.invalid',documentServerUrl:'https://docs.example.invalid:8443',secret:'synthetic-preview-secret-'.repeat(3)};
test('read-only preview signs the exact original file, creates no edit session and rechecks access for source downloads',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'crm-readonly-preview-'));try{
 const original=Buffer.from('Synthetic workbook bytes for immutable-source test');await writeFile(path.join(dir,'book.xlsx'),original);
 const attachment={id:7,opportunityId:9,originalName:'设备参数.xlsx',storedPath:'book.xlsx',sha256:createHash('sha256').update(original).digest('hex')};
 let active=true,visible=true;const user={id:3,roles:['salesperson'],isActive:true};
 const service=createOfficePreviewService({config,uploadDir:dir,attachmentRepository:{findById:async id=>Number(id)===7?attachment:null},opportunityRepository:{getOpportunityDetail:async()=>({id:9,salespersonId:visible?3:99})},opportunityResponsibilityRepository:{listTeamMembersByOpportunity:async()=>[]},userRepository:{findByIdWithRoles:async()=>({...user,isActive:active})}});
 const data=await service.viewer(attachment,user);assert.equal(data.settings.editorConfig.mode,'view');
 for(const name of ['edit','comment','review','fillForms','download','modifyFilter'])assert.equal(data.settings.document.permissions[name],false);
 assert.equal(data.settings.editorConfig.callbackUrl,undefined);assert.equal(data.settings.editorConfig.customization.autosave,false);assert.equal(data.settings.editorConfig.customization.forcesave,false);
 assert.equal(verifyOfficeToken(data.settings.token,config.secret).document.key,data.settings.document.key);
 const token=new URL(data.settings.document.url).searchParams.get('token');
 const file=await service.source(7,token);assert.deepEqual(await readFile(file.absolutePath),original);
 await assert.rejects(service.source(8,token),e=>e.statusCode===403);
 await assert.rejects(service.source(7,token+'tampered'),e=>e.statusCode===403);
 const signed=verifyOfficeToken(token,config.secret);
 await assert.rejects(service.source(7,signOfficeToken({...signed,exp:1},config.secret)),e=>e.statusCode===403);
 active=false;await assert.rejects(service.source(7,token),e=>e.statusCode===404);active=true;
 visible=false;await assert.rejects(service.source(7,token),e=>e.statusCode===404);visible=true;
 await writeFile(path.join(dir,'book.xlsx'),'changed');await assert.rejects(service.source(7,token),e=>e.statusCode===409);
 }finally{await rm(dir,{recursive:true,force:true});}
});
