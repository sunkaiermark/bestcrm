import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ejs from 'ejs';
import {JSDOM} from 'jsdom';
import {normalizeProjectContacts} from '../../src/domain/projectContacts.mjs';
import {normalizeLeadAnalysis,LEAD_AI_AUDIT} from '../../src/domain/leadAnalysis.mjs';
import {normalizeResult,demoResult,sampleEmail} from '../../src/services/leadAiProvider.mjs';
const row={name:'Alex',company:'Example',role:'Engineer',emails:['alex@example.invalid','alex2@example.invalid']};
test('multiple emails normalize per person; same name does not merge people',()=>{
 const contacts=normalizeProjectContacts([{...row,emails:'Alex@Example.invalid; alex@example.invalid；alex2@example.invalid'},{...row,company:'Other'}]);assert.equal(contacts.length,2);assert.deepEqual(contacts[0].emails,row.emails);
 assert.throws(()=>normalizeProjectContacts([{...row,emails:['bad']}]),/邮箱/);assert.throws(()=>normalizeProjectContacts(Array(31).fill(row)),/30/);assert.throws(()=>normalizeProjectContacts('bad'),/格式/);
});
test('contact changes retain audited history and cannot forge source mail provenance',()=>{
 const first=normalizeLeadAnalysis({projectContacts:JSON.stringify([{...row,source:'ai_email',sourceThreadId:999,evidence:'forged'}])},{id:2});assert.equal(first.projectContacts[0].source,'manual');assert.equal(first.projectContacts[0].sourceThreadId,undefined);
 const evidence='Alex Example Engineer alex@example.invalid alex2@example.invalid';
 const ai=normalizeLeadAnalysis({projectContacts:[row],[LEAD_AI_AUDIT]:{resultAudit:{analysis:{contacts:[{...row,evidence}],threadId:7}}}},{id:2},first);assert.equal(ai.projectContacts[0].sourceThreadId,7);assert.equal(ai.history.length,2);
 const unchanged=normalizeLeadAnalysis({projectContacts:[row]},{id:3},ai);assert.equal(unchanged.projectContacts[0].evidence,evidence);
 const edited=normalizeLeadAnalysis({projectContacts:[{...row,role:'Purchasing'}]},{id:3},ai);assert.equal(edited.projectContacts[0].source,'manual');assert.equal(edited.history.at(-1).projectContacts[0].role,'Purchasing');assert.equal(edited.history[1].projectContacts[0].role,'Engineer');
 assert.equal(normalizeLeadAnalysis({}, {id:2},ai),ai);assert.deepEqual(normalizeLeadAnalysis({projectContacts:[]},{id:2},ai).projectContacts,[]);
});
test('AI contacts require exact evidence for person, role, company and each email',()=>{
 const email=sampleEmail+'\nAlex Example Engineer alex@example.invalid alex2@example.invalid';const raw=demoResult(sampleEmail);raw.contacts=[{...row,evidence:'Alex Example Engineer alex@example.invalid alex2@example.invalid'},{...row,name:'Invented',evidence:'Alex Example Engineer alex@example.invalid alex2@example.invalid'}];
 const result=normalizeResult(raw,email);assert.equal(result.contacts.length,1);assert.deepEqual(result.contacts[0].emails,row.emails);assert.match(result.warnings.join(''),/依据/);
});
test('editor works without AI, lists emails, adds/removes and preserves manual rows when AI arrives',()=>{
 const html=ejs.render(fs.readFileSync('src/views/lead-submissions/_project-contacts.ejs','utf8'),{submission:{rawPayload:{leadAnalysis:{projectContacts:[row]}}}});
 const dom=new JSDOM('<form><input name="contactName" value="Main"><input name="companyName" value="Example"><input name="contactEmail" value="main@example.invalid">'+html+'</form>',{runScripts:'outside-only'});
 try{const d=dom.window.document;dom.window.eval(fs.readFileSync('src/public/assets/lead-project-contacts.js','utf8'));assert.equal(d.querySelectorAll('tbody tr').length,1);assert.equal(d.querySelector('[aria-label="邮箱，使用分号分隔 1"]').value,row.emails.join('; '));d.getElementById('lead-project-contact-main').click();assert.equal(d.querySelectorAll('tbody tr').length,2);d.getElementById('lead-project-contacts').dispatchEvent(new dom.window.CustomEvent('lead-ai-contacts',{detail:[{...row,name:'New'}]}));assert.equal(d.querySelectorAll('tbody tr').length,3);assert.equal(JSON.parse(d.getElementById('lead-project-contacts-value').value)[1].name,'Main');d.querySelector('[aria-label="移除联系人 3"]').click();assert.equal(d.querySelectorAll('tbody tr').length,2);assert.equal(d.getElementById('lead-project-contact-count').textContent,'2');}finally{dom.window.close();}
});
test('saved contact summary escapes fields and does not create unauthorized email links',()=>{
 const s=ejs.render(fs.readFileSync('src/views/lead-submissions/_project-contacts-summary.ejs','utf8'),{savedAnalysis:{projectContacts:[{...row,name:'<script>bad</script>',sourceThreadId:999,source:'ai_email'}]}});assert.ok(!s.includes('<script>'));assert.ok(s.includes('alex2@example.invalid'));assert.ok(!s.includes('/email-center/'));
});