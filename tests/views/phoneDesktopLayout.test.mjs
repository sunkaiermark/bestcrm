import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
const script=await readFile('src/public/assets/phone-desktop-layout.js','utf8');
const legacy=await readFile('src/public/assets/mobile-layout.js','utf8');
const html='<html lang="zh"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div class="app-shell"><main class="app-main"><form action="/example" method="post"><input name="_csrf" value="token"><input name="subject" value="unsaved"></form><table class="list-table"><tr><td>file</td></tr></table></main></div></body></html>';
test('Android uses the desktop viewport and rotation preserves the same unsaved form',()=>{
 const dom=new JSDOM(html,{runScripts:'outside-only'}),w=dom.window,d=w.document;
 Object.defineProperty(w.navigator,'userAgent',{value:'Mozilla/5.0 (Linux; Android 15) Chrome/130 Mobile Safari/537.36'});
 const orientation=new w.EventTarget();orientation.type='portrait-primary';Object.defineProperty(w.screen,'orientation',{value:orientation});
 w.eval(script);d.dispatchEvent(new w.Event('DOMContentLoaded'));
 assert.equal(w.bestcrmPhoneDesktopLayout,true);assert.equal(d.querySelector('meta').content,'width=1280');assert.equal(d.querySelector('.phone-landscape-guide').hidden,false);
 const form=d.querySelector('form');form.elements.subject.value='still unsaved';assert.equal(d.querySelector('.app-shell').inert,true);
 orientation.type='landscape-primary';orientation.dispatchEvent(new w.Event('change'));assert.equal(d.querySelector('.phone-landscape-guide').hidden,true);assert.equal(d.querySelector('.app-shell').inert,false);assert.equal(d.querySelector('form'),form);assert.equal(form.elements.subject.value,'still unsaved');assert.equal(form.elements._csrf.value,'token');
 w.eval(legacy);assert.equal(d.querySelectorAll('.mobile-cards,[data-mobile-wrapper],.mobile-nav-backdrop').length,0);
 dom.window.close();
});
test('desktop browser does not change viewport, DOM or inert state',()=>{
 const dom=new JSDOM(html,{runScripts:'outside-only'}),w=dom.window,d=w.document;Object.defineProperty(w.navigator,'userAgent',{value:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130'});const before=d.body.innerHTML;w.eval(script);d.dispatchEvent(new w.Event('DOMContentLoaded'));assert.equal(d.body.innerHTML,before);assert.equal(d.querySelector('meta').content,'width=device-width, initial-scale=1');assert.equal(w.bestcrmPhoneDesktopLayout,undefined);dom.window.close();
});
test('all shared and authentication pages initialize phone layout before CSS',async()=>{
 for(const name of ['partials/app-start','auth/login','auth/verify-sms','auth/verify-totp','auth/enroll-totp','auth/recovery-codes']){const s=await readFile('src/views/'+name+'.ejs','utf8');assert.ok(s.indexOf('/assets/phone-desktop-layout.js')>s.indexOf('name="viewport"'));assert.ok(s.indexOf('/assets/phone-desktop-layout.js')<s.indexOf('<style>'));}
 const css=await readFile('src/public/assets/phone-desktop-layout.css','utf8');assert.ok(css.includes('overscroll-behavior-y:auto'));assert.ok(css.includes('max-height:none'));assert.ok(!script.includes('maximum-scale'));assert.ok(!script.includes('user-scalable=no'));
});
