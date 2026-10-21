import test from 'node:test';
import assert from 'node:assert/strict';
import {researchCustomer} from '../../src/experiments/leadAiLab.mjs';
for(const role of ['agent','end_user','unknown'])test('research separates end user from enquirer: '+role,async()=>{
 let sent;const fields={company:{value:'Example Agent'},website:{value:'https://agent.invalid'},transactionRole:{value:role},endUserName:{value:'Example Mine'},endUserWebsite:{value:'https://mine.invalid'},projectLocation:{value:'Example site'},email:{value:'private@example.invalid'}};
 await researchCustomer(fields,{env:{LAB_ARK_API_KEY:'test',LAB_SEARCH_ENABLED:'true'},fetchImpl:async(url,options)=>{sent=JSON.parse(options.body);return {ok:true,json:async()=>({output:[{content:[{type:'output_text',text:'Report'}]}]})}}});
 const prompt=sent.input[0].content;assert.ok(prompt.includes('最终用户分析'));assert.ok(prompt.includes('不得以代理商背景代替'));assert.ok(prompt.includes(role));assert.ok(prompt.includes(role==='end_user'?'Example Agent':'Example Mine'));assert.ok(!prompt.includes('private@example.invalid'));
});