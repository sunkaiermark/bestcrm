import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import ejs from 'ejs';
import {createOpportunityCollaborationRepository} from '../../src/repositories/opportunityCollaborationRepository.mjs';
test('empty work package removal is available only to managers in editable stages without history',async()=>{
 const base={language:'zh',workPackage:{id:7,title:'Mixer',assigneeDisplayName:'Engineer',versionHistory:[],latestVersion:null},currentUser:{id:2,roles:['technical_manager']},opportunity:{id:5,technicalManagerId:2,status:'technical_solution_in_progress'},canManageCollaborationWorkPackages:true,dateValue:()=>'',formatShortDate:()=>'',packageStatusLabel:s=>s,csrfField:()=>'<input name="_csrf" value="synthetic">',t:s=>s};
 for(const [change,expected] of [[{},true],[{canManageCollaborationWorkPackages:false},false],[{opportunity:{...base.opportunity,archivedAt:'2026-10-30'}},false],[{opportunity:{...base.opportunity,status:'technical_solution_pending'}},false],[{workPackage:{...base.workPackage,versionHistory:[{id:1,files:[]}]}},false]]){
  const html=await ejs.renderFile('src/views/partials/_collaboration-file-rows.ejs',{...base,...change});
  const dom=new JSDOM('<table><tbody>'+html+'</tbody></table>'),form=dom.window.document.querySelector('form[action$="/delete"]');
  assert.equal(!!form,expected);
  if(form){assert.equal(form.method,'post');assert.equal(form.action,'/opportunities/5/technical-work-packages/7/delete');assert.equal(form.querySelector('[name=_csrf]').value,'synthetic');assert.equal(form.querySelector('[name=emptyOnly]').value,'yes');assert.match(form.getAttribute('onsubmit'),/confirm/);}
  dom.window.close();
 }
});
test('empty-only removal rejects newly uploaded history before any mutation',async()=>{
 const queries=[];
 const repo=createOpportunityCollaborationRepository({async query(sql){queries.push(sql);if(sql.includes('SELECT * FROM opportunity_collaboration_work_packages'))return {rows:[{id:7,opportunity_id:5,plan_kind:'technical_solution'}]};if(sql.includes('SELECT * FROM opportunity_collaboration_work_package_versions'))return {rows:[{id:8,status:'uploaded'}]};throw Error('Unexpected query');}});
 await assert.rejects(()=>repo.applyTechnicalLifecycle({action:'delete_package',workPackageId:7,opportunityId:5,actorUserId:2,isManager:true,emptyOnly:true}),/now contains file history/);
 assert.ok(queries.every(sql=>!/^\s*(UPDATE|DELETE|INSERT)/.test(sql)));
});
