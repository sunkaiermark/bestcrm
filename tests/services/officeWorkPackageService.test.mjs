import test from 'node:test';
import assert from 'node:assert/strict';
import {assertOfficeWorkPackageEditable} from '../../src/services/officeWorkPackageService.mjs';
const input=()=>({context:{workPackageId:7,opportunityId:169,versionId:1,latestVersionId:1,versionStatus:'uploaded',planKind:'technical_solution',assigneeUserId:3},attachment:{id:376,opportunityId:169,category:'technical_solution'},opportunity:{id:169,status:'technical_solution_in_progress'},user:{id:3,roles:['administrator'],isActive:true},canUpload:true});
test('submitted, approved and historical work package files stay locked',()=>{
 for(const status of ['submitted','accepted','unknown']){const value=input();value.context.versionStatus=status;assert.throws(()=>assertOfficeWorkPackageEditable(value));}
 const old=input();old.context.latestVersionId=2;assert.throws(()=>assertOfficeWorkPackageEditable(old),/历史/);
 for(const status of ['uploaded','returned','withdrawn']){const value=input();value.context.versionStatus=status;assert.equal(assertOfficeWorkPackageEditable(value),value.context);}
 for(const change of [v=>v.canUpload=false,v=>v.opportunity.archivedAt=new Date(),v=>v.opportunity.status='won',v=>v.context.deleted=true,v=>v.user={id:90,roles:[]}]){const value=input();change(value);assert.throws(()=>assertOfficeWorkPackageEditable(value));}
});
