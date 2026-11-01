import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import {mkdir,writeFile} from 'node:fs/promises';
import {createApp} from '../../src/server.mjs';
import {hashPassword} from '../../src/services/authService.mjs';
test('CAD preview and data require opportunity access, matching active attachment and remain read-only',async()=>{
 const user={id:7,username:'cad-sales',displayName:'预览测试',roles:['salesperson'],isActive:true,passwordHash:await hashPassword('CadPreviewTest123!')};
 let visible=true,owned=true,retired=false,mismatch=false,calls=0;
 const app=createApp({sessionSecret:'cad-test-only',csrfProtection:true,officeConfig:{enabled:false},aiSourceConfig:{enabled:false,workspaceEnabled:false,keys:[]},
  userRepository:{findByIdWithRoles:async()=>user,findByUsernameWithRoles:async()=>user},
  opportunityRepository:{getOpportunityDetail:async()=>visible?{id:30,opportunityNo:'CAD-DEMO',title:'CAD图纸预览',salespersonId:owned?7:99,status:'draft'}:null},
  opportunityResponsibilityRepository:{listTeamMembersByOpportunity:async()=>[]},
  attachmentRepository:{findById:async()=>({id:55,opportunityId:mismatch?31:30,originalName:'工艺流程图.dwg',storedPath:'demo.dwg',retiredAt:retired?new Date():null})},
  cadPreviewService:{preview:async(_a,layout)=>{calls++;return {buffer:Buffer.from('0\nEOF\n'),layout:layout||'Model',layouts:['Model'],warnings:[],entityCount:1,measurement:{enabled:true,unitCode:4,unitLabel:'mm',anchors:[]}};}}
 });
 const url='/opportunities/30/attachments/55',agent=request.agent(app);
 await request(app).get(url+'/preview').expect(302);await request(app).get(url+'/cad-data').expect(302);assert.equal(calls,0);
 const login=await agent.get('/login');const csrf=login.text.match(/name="_csrf"\s+value="([^"]+)"/)?.[1];await agent.post('/login').type('form').send({username:user.username,password:'CadPreviewTest123!',_csrf:csrf}).expect(302);
 const page=await agent.get(url+'/preview').expect(200);assert.match(page.text,/cad-workspace/);assert.match(page.text,/返回商机/);assert.match(page.text,/只读/);assert.doesNotMatch(page.text,/<input[^>]*type="file"|>保存新版本</);assert.match(page.headers['cache-control'],/no-store/);
 const data=await agent.get(url+'/cad-data').expect(200);assert.equal(data.body.layout,'Model');assert.equal(data.body.measurement.unitCode,4);assert.equal(data.body.measurement.enabled,true);assert.match(data.headers['cache-control'],/no-store/);
 await agent.get(url+'/cad-data?layout[x]=1').expect(400);assert.equal(calls,1);
 mismatch=true;await agent.get(url+'/cad-data').expect(404);mismatch=false;retired=true;await agent.get(url+'/preview').expect(404);await agent.get(url+'/cad-data').expect(404);retired=false;owned=false;await agent.get(url+"/cad-data").expect(404);owned=true;visible=false;await agent.get(url+'/cad-data').expect(404);assert.equal(calls,1);
 await agent.post(url+'/cad-data').send({dxf:'modified'}).expect(403);
 const worker=await agent.get('/assets/cad-preview-worker.js').expect(200);assert.match(worker.headers['content-security-policy'],/connect-src 'self' blob:/);assert.doesNotMatch(page.headers['content-security-policy'],/connect-src 'self' blob:/);
 if(process.env.CAPTURE_CAD_PREVIEW==='1'){await mkdir('output/cad-preview',{recursive:true});await writeFile('output/cad-preview/page.html',page.text);}
});
