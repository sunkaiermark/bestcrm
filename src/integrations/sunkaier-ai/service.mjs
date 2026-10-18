import { randomUUID } from 'node:crypto';
import { fail, positiveId } from './contracts.mjs';
import { canViewOpportunity } from '../../services/opportunityService.mjs';
import { canViewLeadSubmission, submitSalesLead } from '../../services/leadSubmissionService.mjs';
import { createInquiryRepository } from '../../repositories/inquiryRepository.mjs';
import { createUserRepository } from '../../repositories/userRepository.mjs';
import { createOpportunityRepository } from '../../repositories/opportunityRepository.mjs';
export const isManager=u=>!!u?.isActive&&u.roles?.some(r=>['administrator','sales_manager'].includes(r));
export const canUse=u=>!!u?.isActive&&u.roles?.some(r=>['administrator','sales_manager','salesperson'].includes(r));
export function assertVisible(user,s){if(!canUse(user))fail(403,'forbidden');if(!s||(!isManager(user)&&Number(s.assigned_user_id)!==Number(user.id)))fail(404,'source_not_found');return s;}
export function publicStatus(s){return s.retention==='deleted'?'deleted':s.opportunity_id?'linked_to_opportunity':s.lead_id?'lead_created':s.retention==='archived'?'archived':'pending_review';}
export function createAiSourceService(repo){return{
 async list(user,query){if(!canUse(user))fail(403,'forbidden');return repo.list(user,query);},
 async detail(user,id){assertVisible(user,await repo.source(id));return repo.detail(id);},
 async act(user,id,input){
  if(!canUse(user))fail(403,'forbidden');
  return repo.transaction(async c=>{
   const s=assertVisible(user,await repo.source(id,c,true));
   const note=String(input.note||'').trim();if(!note||note.length>1000)fail(422,'reason_required');
   const a=input.action;if(!['archive','delete','restore','create_lead','link_opportunity','assign','confirm_candidate','dismiss_candidate'].includes(a))fail(422,'invalid_action');
   if(s.retention==='deleted'&&a!=='restore')fail(409,'source_deleted');
   if(a==='restore'&&!isManager(user))fail(403,'forbidden');
   if(['create_lead','link_opportunity'].includes(a)&&(s.lead_id||s.opportunity_id))fail(409,'already_linked');
   const details={};
   if(a==='create_lead'){
    const p=s.payload;
    const raw={...p,...input};
    const lead=await submitSalesLead({inquiryRepository:{async createInquiry(v){return createInquiryRepository(c).createInquiry({...v,sourceAttributionNote:'AI Source '+s.id,rawPayload:{...v.rawPayload,aiSourceId:s.id,aiSourceChannel:s.channel}});}},userRepository:createUserRepository(c)},user,{
     submissionToken:randomUUID(),subject:raw.title||s.title,companyName:raw.company_name,contactName:raw.contact_name,contactEmail:raw.email,contactPhone:raw.phone,country:raw.country_or_region,requirementText:raw.requirement_summary,sourceChannel:s.channel==='phone_consultation'?'phone':'other',sourceAttributionNote:'AI Source '+s.id,assignedUserId:input.manager_id,recommendedSalespersonId:input.salesperson_id,productInterest:(p.interested_products||[]).join(', ')
    });
    await c.query('UPDATE ai_sources SET lead_id=$2 WHERE id=$1',[id,lead.id]);
    await c.query('INSERT INTO ai_source_business_links(source_id,lead_id,actor_user_id) VALUES($1,$2,$3)',[id,lead.id,user.id]);details.lead_id=lead.id;
   }
   if(a==='link_opportunity'){
    const target=positiveId(input.opportunity_id);const opp=await createOpportunityRepository(c).getOpportunityDetail(target);
    if(!opp||!canViewOpportunity(user,opp))fail(404,'opportunity_not_found');
    if(!isManager(user)&&Number(opp.salespersonId)!==Number(user.id))fail(403,'forbidden');
    await c.query('UPDATE ai_sources SET opportunity_id=$2 WHERE id=$1',[id,target]);
    await c.query('INSERT INTO ai_source_business_links(source_id,opportunity_id,actor_user_id) VALUES($1,$2,$3)',[id,target,user.id]);details.opportunity_id=target;
   }
   if(['archive','delete','restore'].includes(a)){
    const state={archive:'archived',delete:'deleted',restore:'active'}[a];
    await c.query('UPDATE ai_sources SET retention=$2 WHERE id=$1',[id,state]);
   }
   if(a==='assign'){
    if(!isManager(user))fail(403,'forbidden');const target=positiveId(input.assigned_user_id);const assignee=await createUserRepository(c).findByIdWithRoles(target);
    if(!canUse(assignee))fail(422,'invalid_assignee');await c.query('UPDATE ai_sources SET assigned_user_id=$2 WHERE id=$1',[id,target]);details.assigned_user_id=target;
   }
   if(a.endsWith('_candidate')){
    if(!isManager(user))fail(403,'forbidden');const candidate=positiveId(input.candidate_id);
    const r=await c.query("UPDATE ai_source_match_candidates SET conclusion=$3,reviewed_by=$4,reviewed_at=now() WHERE id=$1 AND source_id=$2 AND conclusion='pending' RETURNING id",[candidate,id,a==='confirm_candidate'?'confirmed':'dismissed',user.id]);if(!r.rows.length)fail(409,'candidate_not_pending');details.candidate_id=candidate;
   }
   await c.query('UPDATE ai_sources SET version=version+1,updated_at=now() WHERE id=$1',[id]);
   await repo.audit(id,user.id,a,'human_decision',{...details,note},c);return repo.source(id,c);
  });
 }
};}

