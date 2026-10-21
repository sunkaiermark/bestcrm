import test from 'node:test';
import assert from 'node:assert/strict';
import {createEmailAiDraftService} from '../../src/experiments/emailAiDraftService.mjs';
function setup(){
 const records=new Map(); const thread={id:1,triageStatus:'pending',messages:[{id:1,direction:'inbound',textBody:'Need a mixer'}]}; let calls=0;
 const repository={save:async d=>records.set(d.id,structuredClone(d)),get:async id=>records.get(id),latest:async(a,t)=>[...records.values()].reverse().find(d=>d.actorId===a&&d.threadId===t)};
 const service=createEmailAiDraftService({repository,loadVisibleThread:async a=>a.id===1?thread:null,analyze:async()=>{calls++;return {qualification:'qualified',requirement:'Need a mixer'}}});
 return {service,thread,records,calls:()=>calls};
}
test('analysis is independent of email state and reuses unchanged ready draft',async()=>{const s=setup(),before=structuredClone(s.thread);const a=await s.service.prepare({id:1},1),b=await s.service.prepare({id:1},1);assert.equal(a.id,b.id);assert.equal(s.calls(),1);assert.equal(a.suggestion,'new_lead');assert.deepEqual(s.thread,before)});
test('existing link routes to supplement without overwriting requirement',async()=>{const s=setup();s.thread.opportunityId=22;assert.equal((await s.service.prepare({id:1},1)).suggestion,'supplement_existing');assert.equal(s.thread.opportunityId,22)});
test('hidden email cannot be analyzed',async()=>{const s=setup();await assert.rejects(s.service.prepare({id:2},1));assert.equal(s.calls(),0)});
test('review requires human confirmation, current source and same actor',async()=>{const s=setup(),a=await s.service.prepare({id:1},1);await assert.rejects(s.service.review({id:1},1,a.id,{confirmed:false}));await assert.rejects(s.service.review({id:2},1,a.id,{confirmed:true}));const b=await s.service.review({id:1},1,a.id,{confirmed:true,fields:{requirementText:'Human correction',status:'approved'},customerReport:'Reviewed report'});assert.equal(b.reviewedFields.requirementText,'Human correction');assert.equal(b.reviewedFields.status,undefined);assert.equal(b.result.requirement,'Need a mixer');s.thread.messages.push({id:2,direction:'inbound',textBody:'Updated quantity'});await assert.rejects(s.service.review({id:1},1,a.id,{confirmed:true}))});