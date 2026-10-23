import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import {createApp} from '../../src/server.mjs';
test('Enabling Office editing keeps the real application health route public',async()=>{
 const application=createApp({databaseUrl:'',sessionSecret:'test-secret',sessionStore:undefined,pool:{query:async()=>{throw new Error('Unexpected database query');}},officeConfig:{enabled:true,baseUrl:'https://crm.example.test',documentServerUrl:'https://docs.example.test',secret:'test-secret-'.repeat(5)}});
 const response=await request(application).get('/health');assert.equal(response.status,200);assert.deepEqual(response.body,{ok:true,app:'BESTCRM'});
 await request(application).get('/office-editor/private').expect(302).expect('Location',/login/);
});
