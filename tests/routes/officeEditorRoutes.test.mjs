import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import request from 'supertest';
import {officeServiceRoutes,officeEditorRoutes} from '../../src/routes/officeEditorRoutes.mjs';
import {csrfProtection} from '../../src/middleware/csrf.mjs';
function app(service,user={id:3}){const a=express();a.use(express.json());a.use((req,res,next)=>{req.currentUser=user;req.session={csrfToken:'test-csrf'};next();});a.use(officeServiceRoutes({service,uploadDir:'.'}));a.use(csrfProtection());a.use(officeEditorRoutes({service,attachmentRepository:{findById:async()=>({id:1,opportunityId:9})}}));return a;}
test('Office callbacks require a validated service token and are independent of browser CSRF',async()=>{
 let calls=0;const a=app({callback:async(id,token)=>{if(token!=='trusted')throw Object.assign(Error(),{statusCode:403});calls++;}});
 await request(a).post('/office-service/key/callback').send({}).expect(403);
 await request(a).post('/office-service/key/callback').set('Authorization','Bearer trusted').send({}).expect(200,{error:0});assert.equal(calls,1);
});
test('Starting an editor requires login and CSRF and checks attachment opportunity',async()=>{
 let calls=0;const service={start:async()=>{calls++;return 'key';}};
 await request(app(service)).post('/opportunities/9/attachments/1/edit').send({}).expect(403);
 await request(app(service)).post('/opportunities/10/attachments/1/edit').set('x-csrf-token','test-csrf').send({}).expect(404);
 await request(app(service)).post('/opportunities/9/attachments/1/edit').set('x-csrf-token','test-csrf').send({}).expect(302).expect('Location','/office-editor/key');assert.equal(calls,1);
 await request(app(service,null)).post('/opportunities/9/attachments/1/edit').set('x-csrf-token','test-csrf').send({}).expect(302).expect('Location',/login/);
});

test('Office editor auth does not intercept health or unrelated application routes',async()=>{
 const application=app({},null);application.get('/health',(req,res)=>res.json({ok:true,app:'BESTCRM'}));application.get('/unrelated',(req,res)=>res.send('pass'));
 await request(application).get('/health').expect(200,{ok:true,app:'BESTCRM'});
 await request(application).get('/unrelated').expect(200,'pass');
 await request(application).get('/office-editor/private').expect(302).expect('Location',/login/);
});

test('Office editor returns the exact read-only reason instead of a generic production Forbidden page',async()=>{
 const application=app({start:async()=>{throw Object.assign(new Error('工作包和已提交草案附件只读。'),{statusCode:403});}});
 const response=await request(application).post('/opportunities/9/attachments/1/edit').set('x-csrf-token','test-csrf').send({}).expect(403);
 assert.equal(response.text,'工作包和已提交草案附件只读。');assert.match(response.headers['content-type'],/text\/plain/);
});
