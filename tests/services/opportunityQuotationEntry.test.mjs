import test from 'node:test';
import assert from 'node:assert/strict';
import ejs from 'ejs';
import { opportunityQuotationEntry } from '../../src/services/opportunityQuotationEntry.mjs';

test('quotation entry matches assigned sales and engineer editors, and designated reviewer', async () => {
  const opportunity={id:55,salespersonId:2,quotationEngineerId:11,commercialManagerId:1};
  const render=(entry,historical=false)=>ejs.renderFile('src/views/partials/_opportunity-quotation-entry.ejs',{entry,historical,opportunity,language:'zh'});
  for(const user of [{id:2,roles:['salesperson']},{id:11,roles:['quotation_engineer']}]){
    const entry=opportunityQuotationEntry(user,opportunity);
    assert.deepEqual(entry,{canEdit:true,canView:true});
    assert.match(await render(entry),/编制商务报价/);
    assert.match(await render(entry),/opportunities\/55\/commercial-quotation-draft/);
    assert.doesNotMatch(await render(entry,true),/href=/);
  }
  const reviewer=opportunityQuotationEntry({id:1,isActive:true,roles:['commercial_manager']},opportunity);
  assert.deepEqual(reviewer,{canEdit:false,canView:true});
  assert.match(await render(reviewer),/查看商务报价／审批/);
  for(const user of [{id:3,roles:['quotation_engineer']},{id:1,isActive:false,roles:['commercial_manager']},{id:11,roles:[]}]){
    assert.deepEqual(opportunityQuotationEntry(user,opportunity),{canEdit:false,canView:false});
  }
  assert.deepEqual(opportunityQuotationEntry({id:11,roles:['quotation_engineer']},{...opportunity,archivedAt:'2026-11-01'}),{canEdit:false,canView:false});
});
