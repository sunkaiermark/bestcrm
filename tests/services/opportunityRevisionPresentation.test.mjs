import test from 'node:test';
import assert from 'node:assert/strict';
import {buildOpportunityRevisionPresentation as build} from '../../src/services/opportunityRevisionPresentation.mjs';

function fixture(){
 const file={attachmentId:11,name:'original.pdf',status:'accepted',reviewNote:'',submittedAt:'2026-10-12'};
 const oldBasis={technical:[{packageId:1,versionId:1,status:'accepted',files:[file],cost:{packageId:2,versionId:2,status:'accepted',files:[]}}]};
 const currentBasis={technical:[{packageId:1,versionId:3,status:'uploaded',files:[],cost:{packageId:2,versionId:2,status:'accepted',files:[]}}]};
 return {opportunity:{requirement:'Initial requirement'},workspace:{rounds:[{id:2,round_no:2,revision_kind:'technical',feedback:'Change motor',closed_at:null},{id:1,round_no:1,revision_kind:'initial',closed_at:'2026-10-16',closed_basis:oldBasis}],quotes:[],basis:currentBasis,linkedAttachments:[{id:10,revision_round_id:1,category:'requirement',original_name:'customer.pdf'}]},workPackages:[{id:1,planKind:'technical_solution',latestVersion:{id:3,versionNo:2,revisionRoundId:2,status:'uploaded',files:[]},versionHistory:[{id:3,versionNo:2,revisionRoundId:2,status:'uploaded',files:[]},{id:1,versionNo:1,status:'accepted',files:[{id:11,originalName:'changed after close',status:'returned',reviewNote:'new note'}]}]}],attachments:[{id:10,category:'requirement'},{id:99,category:'requirement',originalName:'legacy.pdf'}]};
}
test('historical requirements show frozen file names/status and cannot mutate live work-package objects',()=>{
 const input=fixture(),before=structuredClone(input);const view=build({...input,requestedRoundId:'1'});
 assert.equal(view.historical,true);assert.equal(view.label,'R0');assert.equal(view.text,'Initial requirement');
 assert.equal(view.workPackages[0].latestVersion.files[0].originalName,'original.pdf');
 assert.equal(view.workPackages[0].latestVersion.files[0].status,'accepted');
 assert.equal(view.workPackages[0].latestVersion.files[0].reviewNote,'');
 assert.equal(view.linkedAttachments[0].id,10);assert.equal(view.unassignedAttachments[0].id,99);
 assert.deepEqual(input,before);
});
test('current selection follows the live requirement and rejects a foreign round id',()=>{
 const input=fixture(),view=build(input);assert.equal(view.historical,false);assert.equal(view.label,'R1');
 assert.equal(view.workPackages[0].latestVersion.id,3);assert.equal(view.workPackages[0].requirementRef.description,'本轮修订');
 assert.throws(()=>build({...input,requestedRoundId:'999'}),e=>e.statusCode===404);
});
test('commercial-only revision explicitly identifies reused technical versions',()=>{
 const input=fixture();input.workspace.rounds[0].revision_kind='commercial';input.workPackages[0].latestVersion=input.workPackages[0].versionHistory[1];
 const view=build(input);assert.equal(view.workPackages[0].requirementRef.sourceLabel,'R0');assert.equal(view.workPackages[0].requirementRef.description,'沿用R0已批版');
});
test('an unchanged approved file inside a new technical version keeps its original requirement source',()=>{
 const input=fixture();
 input.workPackages[0].latestVersion.files=[{id:12,originalName:'unchanged.pdf',status:'accepted',carriedFromAttachmentId:11}];
 const view=build(input);
 assert.equal(view.workPackages[0].latestVersion.files[0].requirementRef.description,'沿用R0已批版');
 assert.equal(view.workPackages[0].requirementRef.description,'本轮修订');
});
