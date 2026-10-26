import test from 'node:test';import assert from 'node:assert/strict';import express from 'express';import request from 'supertest';
import {officePreviewServiceRoutes} from '../../src/routes/officePreviewRoutes.mjs';
test('preview file service rejects unsigned requests, has no write routes and does not intercept health',async()=>{
 const app=express();app.use(officePreviewServiceRoutes({service:{source:async()=>{throw Object.assign(Error('Forbidden'),{statusCode:403});}}}));app.get('/health',(req,res)=>res.json({ok:true}));
 await request(app).get('/office-preview-service/7/file').expect(403);
 await request(app).post('/office-preview-service/7/callback').send({status:2}).expect(404);
 await request(app).get('/health').expect(200,{ok:true});
});
