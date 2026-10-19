import test from 'node:test';
import assert from 'node:assert/strict';
import { loadOpportunitySource } from '../../src/services/opportunitySourceService.mjs';

const user={id:7,isActive:true,roles:['salesperson']};
const lead={id:11,submissionType:'sales_lead',source:'manual',sourceChannel:'other',createdBy:7,createdByDisplayName:'Original Recorder',createdAt:'2026-08-04T10:00:00Z'};
const options=(overrides={})=>({opportunity:{id:55,originInquiryId:11,salespersonId:99},user,inquiryRepository:{async findById(){return lead;}},aiSourceRepository:{async findOriginsByLead(){return [];}},aiSourceEnabled:true,emailCenterEnabled:true,...overrides});

test('manual opportunity source retains original recorder and creation time rather than current owner',async()=>{
 const result=await loadOpportunitySource(options());assert.equal(result.kind,'manual');assert.equal(result.creatorName,'Original Recorder');assert.equal(result.createdAt,lead.createdAt);assert.equal(result.leadUrl,'/lead-submissions/11');assert.deepEqual(result.links,[]);
});
test('AI source requires a persisted lead association and respects source visibility',async()=>{
 let result=await loadOpportunitySource(options({inquiryRepository:{async findById(){return {...lead,rawPayload:{aiSourceId:'untrusted-label'}};}}}));assert.equal(result.kind,'manual');
 const origins={async findOriginsByLead(id){assert.equal(id,11);return [{id:'abc',assigned_user_id:7,retention:'active'}];}};
 result=await loadOpportunitySource(options({aiSourceRepository:origins}));assert.equal(result.kind,'ai');assert.equal(result.links[0].url,'/ai-sources/abc');assert.equal(result.creatorName,'');
 result=await loadOpportunitySource(options({aiSourceRepository:origins,user:{...user,id:99}}));assert.equal(result.kind,'ai');assert.deepEqual(result.links,[]);
});
test('mail source links only a thread bound to the original lead',async()=>{
 const emailArchiveRepository={async findLatestThreadByInquiry(id){return {id:24,inquiryId:id};}};
 const result=await loadOpportunitySource(options({emailArchiveRepository,inquiryRepository:{async findById(){return {...lead,sourceChannel:'email'};}}}));assert.equal(result.kind,'email');assert.equal(result.links[0].url,'/email-center/threads/24');
 const laterMail=await loadOpportunitySource(options({emailArchiveRepository}));assert.equal(laterMail.kind,'manual');assert.deepEqual(laterMail.links,[]);
 const mismatch=await loadOpportunitySource(options({inquiryRepository:{async findById(){return {...lead,source:'email'};}},emailArchiveRepository:{async findLatestThreadByInquiry(){return {id:24,inquiryId:12};}}}));assert.deepEqual(mismatch.links,[]);
});
test('missing lead and missing recorder are not fabricated and website origin is retained',async()=>{
 assert.equal(await loadOpportunitySource(options({opportunity:{id:55}})),null);
 let result=await loadOpportunitySource(options({inquiryRepository:{async findById(){return {...lead,createdByDisplayName:'',createdAt:null};}}}));assert.equal(result.creatorName,'');assert.equal(result.createdAt,null);
 result=await loadOpportunitySource(options({inquiryRepository:{async findById(){return {...lead,source:'website'};}}}));assert.equal(result.kind,'website');assert.deepEqual(result.links,[]);
});
test('legacy mail sources retain their original inquiry link for authorized managers',async()=>{
 const result=await loadOpportunitySource(options({user:{...user,roles:['sales_manager']},inquiryRepository:{async findById(){return {...lead,submissionType:'standard',source:'email'};}},emailArchiveRepository:{async findLatestThreadByInquiry(){return {id:24,inquiryId:11};}}}));
 assert.equal(result.leadUrl,'/inquiries/11');assert.equal(result.links[0].url,'/email-center/threads/24');
});
