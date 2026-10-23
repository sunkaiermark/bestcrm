import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyCrmHealth} from '../../src/services/officeHealthCheck.mjs';
test('Office activation accepts only HTTP 200 with the CRM health JSON',async()=>{
 const result=await verifyCrmHealth('https://crm.test/health',async(url,options)=>{assert.equal(options.redirect,'manual');return Response.json({ok:true,app:'BESTCRM'});});assert.equal(result.ok,true);
 for(const response of [new Response('Found. Redirecting to /login',{status:302}),Response.json({ok:false,app:'BESTCRM'}),Response.json({ok:true,app:'other'}),new Response('ok')])await assert.rejects(()=>verifyCrmHealth('https://crm.test/health',async()=>response));
});
