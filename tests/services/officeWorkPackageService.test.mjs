import test from 'node:test';
import assert from 'node:assert/strict';
import {assertOfficeWorkPackageEditable} from '../../src/services/officeWorkPackageService.mjs';
const input=()=>({context:{workPackageId:7,opportunityId:169,versionId:1,latestVersionId:1,versionStatus:'uploaded',planKind:'technical_solution',assigneeUserId:3},attachment:{id:376,opportunityId:169,category:'technical_solution'},opportunity:{id:169,status:'technical_solution_in_progress'},user:{id:3,roles:['administrator'],isActive:true},canUpload:true});
test('all work package document modifications use the offline resubmission workflow',()=>{
 for(const status of ['uploaded','submitted','accepted','returned','withdrawn']){const value=input();value.context.versionStatus=status;assert.throws(()=>assertOfficeWorkPackageEditable(value),error=>error.statusCode===403&&/线下修改/.test(error.message));}
});
