import { positiveId } from './contracts.mjs';
import { canViewOpportunity } from '../../services/opportunityService.mjs';
import { canViewLeadSubmission } from '../../services/leadSubmissionService.mjs';
import { createOpportunityRepository } from '../../repositories/opportunityRepository.mjs';
import { createInquiryRepository } from '../../repositories/inquiryRepository.mjs';
import ejs from 'ejs';
import { Router } from 'express';
import { requireLogin } from '../../middleware/auth.mjs';
import { createAiSourceService,canUse,isManager } from './service.mjs';
import { AiSourceError,fail,uuid,channels } from './contracts.mjs';
import { refreshCandidates } from './matching.mjs';
import { readEvidence } from './evidence.mjs';
export const channelLabels={ai_project_search:'AI 搜索',website_form:'官网表单',web_chat:'网络聊天',phone_consultation:'电话咨询',email_reference:'邮件引用'};
export const stateLabels={pending:'待处理',all:'全部',archived:'归档保存',linked:'已关联',lead:'转入线索',opportunity:'关联商机',deleted:'已删除'};
export function aiSourceRoutes({enabled,repository,userRepository,evidenceRoot}){
 const router=Router(),service=repository?createAiSourceService(repository):null;
 router.use('/ai-sources',requireLogin,(req,res,next)=>{if(!enabled)return res.status(404).send('AI Source disabled');if(!canUse(req.currentUser))return res.status(403).send('Forbidden');if(!service)return res.status(503).send('Database unavailable');req.app.engine('html',ejs.renderFile);res.set('Cache-Control','no-store');next();});
 const route=fn=>async(req,res,next)=>{try{await fn(req,res);}catch(e){next(e);}};
 router.get('/ai-sources',route(async(req,res)=>{
  const q=String(req.query.q||'').trim();if(q.length>200)fail(422,'query_too_long');
  const channel=req.query.channel===undefined?(q?'':'ai_project_search'):String(req.query.channel);
  const state=req.query.state===undefined?(q?'all':'pending'):String(req.query.state);
  if(channel&&!channels.includes(channel))fail(422,'invalid_channel');if(!Object.hasOwn(stateLabels,state))fail(422,'invalid_state');
  const page=Number(req.query.page||1),pageSize=Number(req.query.page_size||20);
  if(!Number.isInteger(page)||page<1||page>100000||![10,20,50].includes(pageSize))fail(422,'invalid_page');
  const result=await service.list(req.currentUser,{q,channel,state,page,pageSize});
  res.render('ai-sources/index.html',{...result,q,channel,state,channelLabels,stateLabels,manager:isManager(req.currentUser)});
 }));
 router.get('/ai-sources/related/:kind/:targetId',route(async(req,res)=>{
  const target=positiveId(req.params.targetId),kind=req.params.kind;
  if(kind==='lead'){const lead=await createInquiryRepository(repository.pool).findById(target);if(!lead||!canViewLeadSubmission(req.currentUser,lead))fail(404,'not_found');}
  else if(kind==='opportunity'){const opp=await createOpportunityRepository(repository.pool).getOpportunityDetail(target);if(!opp||!canViewOpportunity(req.currentUser,opp))fail(404,'not_found');}
  else fail(404,'not_found');
  const page=Number(req.query.page||1);if(!Number.isInteger(page)||page<1||page>100000)fail(422,'invalid_page');
  const result=await service.list(req.currentUser,{state:'all',page,pageSize:20,...(kind==='lead'?{leadId:target}:{opportunityId:target})});
  res.render('ai-sources/index.html',{...result,q:'',channel:'',state:'all',channelLabels,stateLabels,listBase:'/ai-sources/related/'+kind+'/'+target,manager:isManager(req.currentUser)});
 }));
 router.get('/ai-sources/audit',route(async(req,res)=>{
  if(!req.currentUser.roles.includes('administrator'))fail(403,'forbidden');
  const rows=(await repository.pool.query('SELECT id,action,reason_code,key_id,created_at FROM ai_source_audit ORDER BY id DESC LIMIT 100')).rows;
  res.render('ai-sources/audit.html',{rows});
 }));
 router.get('/ai-sources/:id',route(async(req,res)=>{
  const source=await service.detail(req.currentUser,uuid(req.params.id));
  const users=await userRepository.listUsersWithRoles();
  const candidates=isManager(req.currentUser)?(await repository.pool.query('SELECT * FROM ai_source_match_candidates WHERE source_id=$1 ORDER BY id',[source.id])).rows:[];
  res.render('ai-sources/detail.html',{source,users:users.filter(canUse),candidates,manager:isManager(req.currentUser),channelLabels});
 }));
 router.post('/ai-sources/:id/actions',route(async(req,res)=>{
  if(!req.validateCsrf?.())fail(403,'invalid_csrf');await service.act(req.currentUser,uuid(req.params.id),req.body);res.redirect(303,'/ai-sources/'+req.params.id);
 }));
 router.post('/ai-sources/:id/candidates',route(async(req,res)=>{
  if(!req.validateCsrf?.())fail(403,'invalid_csrf');await service.detail(req.currentUser,uuid(req.params.id));await refreshCandidates(repository,req.currentUser,req.params.id);res.redirect(303,'/ai-sources/'+req.params.id);
 }));
 router.get('/ai-sources/:id/evidence/:evidenceId',route(async(req,res)=>{
  await service.detail(req.currentUser,uuid(req.params.id));const e=await repository.evidence(uuid(req.params.evidenceId));if(!e||e.source_id!==req.params.id||e.scan_status!=='clean')fail(404,'evidence_not_found');
  const bytes=await readEvidence(evidenceRoot,e);await repository.audit(e.source_id,req.currentUser.id,'download_evidence','allowed',{evidence_id:e.id});res.set('X-Content-Type-Options','nosniff');res.set('Content-Security-Policy',"default-src 'none'; sandbox");res.type(e.mime_type).attachment(e.original_name).send(bytes);
 }));
 router.use('/ai-sources',(err,req,res,next)=>{if(err instanceof AiSourceError)return res.status(err.status).send(err.code);if(/required|invalid|Invalid|not found/i.test(err.message))return res.status(422).send('Required information or business selection is invalid');next(err);});return router;
}
