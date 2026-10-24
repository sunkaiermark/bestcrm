import test from 'node:test';
import assert from 'node:assert/strict';
import {customerResearchTimeoutMs,researchCustomer} from '../../src/services/leadAiProvider.mjs';
const env={LAB_ARK_API_KEY:'synthetic-test-key',LAB_SEARCH_ENABLED:'true'};
test('customer research has a bounded configurable budget independent of other AI calls',()=>{
 assert.equal(customerResearchTimeoutMs({}),180000);
 assert.equal(customerResearchTimeoutMs({...env,LAB_ARK_RESEARCH_TIMEOUT_MS:'240000'}),240000);
 for(const value of ['', '0','-1','89999','240001','Infinity','120000.5','bad'])assert.equal(customerResearchTimeoutMs({LAB_ARK_RESEARCH_TIMEOUT_MS:value}),180000);
});
for(const phase of ['connect','body'])test('research translates '+phase+' timeout without retrying or exposing request data',async()=>{
 let calls=0;const failure=()=>{throw Object.assign(Error('The operation was aborted due to timeout'),{name:'TimeoutError'});};
 await assert.rejects(researchCustomer({company:{value:'Example'}},{env,fetchImpl:async()=>{calls++;if(phase==='connect')failure();return {ok:true,json:failure};}}),error=>error.code==='LEAD_RESEARCH_TIMEOUT'&&/180秒/.test(error.message)&&/原有内容未替换/.test(error.message)&&!error.message.includes(env.LAB_ARK_API_KEY));
 assert.equal(calls,1);
});
test('non-timeout errors keep their original meaning',async()=>{
 const failure=Error('Synthetic network failure');await assert.rejects(researchCustomer({company:{value:'Example'}},{env,fetchImpl:async()=>{throw failure;}}),error=>error===failure);
});
