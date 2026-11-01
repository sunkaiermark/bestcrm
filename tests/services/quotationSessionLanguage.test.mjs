import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import {createApp} from '../../src/server.mjs';
import {hashPassword} from '../../src/services/authService.mjs';
import {QUOTATION_UNIT_OPTIONS,quotationUnitLabel} from '../../src/domain/quotationUnits.mjs';
import {withBuiltInQuotationTypicalTerms} from '../../src/domain/quotationTypicalTermTemplates.mjs';

test('each unit displays exactly one localized label without changing its canonical value',()=>{
 for(const option of QUOTATION_UNIT_OPTIONS){
  assert.equal(quotationUnitLabel(option.value,'en'),option.en);
  assert.equal(quotationUnitLabel(option.value,'zh'),option.zh);
  assert.equal(quotationUnitLabel(option.zh,'en'),option.en);
 }
 assert.equal(quotationUnitLabel('set','zh'),'套');
 assert.equal(quotationUnitLabel('pc','zh'),'件');
 assert.equal(quotationUnitLabel('custom user unit','en'),'custom user unit');
});

test('catalog merge rejects opposite-language records even when a repository returns both',()=>{
 const terms=[{id:1,language:'zh',key:'payment',body:'中文付款'},{id:2,language:'en',key:'payment',body:'English payment'}];
 for(const language of ['en','zh']){
  const options=withBuiltInQuotationTypicalTerms(terms,language);
  assert.ok(options.length>1);assert.ok(options.every(t=>t.language===language));
 }
});

test('login fixes the selected language for the session regardless of browser headers and later language links',async()=>{
 const user={id:7,username:'test-language',displayName:'Test',passwordHash:await hashPassword('ChangeMe123!'),isActive:true,roles:['salesperson']};
 const app=createApp({databaseUrl:'',sessionSecret:'language-test',csrfProtection:false,userRepository:{async findByIdWithRoles(){return user;},async findByUsernameWithRoles(){return user;}}});
 for(const language of ['en','zh']){
  const agent=request.agent(app);
  await agent.get('/language?lang='+language+'&returnTo=/login');
  await agent.post('/login').set('Accept-Language',language==='en'?'zh-CN':'en-US').type('form').send({username:user.username,password:'ChangeMe123!'}).expect(302);
  await agent.get('/language?lang='+(language==='en'?'zh':'en')+'&returnTo=/login');
  const page=await agent.get('/login').set('Accept-Language',language==='en'?'zh-CN':'en-US');
  assert.match(page.text,new RegExp('<html lang="'+language+'">'));
 }
});
