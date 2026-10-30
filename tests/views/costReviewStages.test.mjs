import test from 'node:test';
import assert from 'node:assert/strict';
import ejs from 'ejs';
test('cost review controls match allowed stage and hide actions for later or archived stages',async()=>{
 const base={language:'zh',currentUser:{id:2,roles:['technical_manager']},opportunity:{id:1,technicalManagerId:2,status:'commercial_quote_pending'},workPackage:{id:44,planKind:'internal_quote',title:'Cost',versionHistory:[],latestVersion:{id:3,files:[{id:415,status:'submitted',originalName:'Cost.xlsx'}]}},canManageCollaborationWorkPackages:true,dateValue:()=>'',formatShortDate:()=>'',packageStatusLabel:s=>s,csrfField:()=>'<input name="_csrf" value="synthetic">',t:s=>s};
 for(const [op,wp,expected] of [
  [base.opportunity,base.workPackage,true],
  [{...base.opportunity,status:'commercial_quote_in_progress'},base.workPackage,true],
  [base.opportunity,{...base.workPackage,planKind:'technical_solution'},false],
  [{...base.opportunity,status:'customer_negotiation'},base.workPackage,false],
  [{...base.opportunity,archivedAt:'2026-10-31'},base.workPackage,false]
 ]){
  const html=await ejs.renderFile('src/views/partials/_collaboration-file-rows.ejs',{...base,opportunity:op,workPackage:wp});
  assert.equal(html.includes('/415/accepted'),expected);
  assert.equal(html.includes('data-file-reject='),expected);
 }
});
