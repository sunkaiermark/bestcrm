import { Router } from 'express';
import { createHash } from 'node:crypto';
import { callAnalysis, researchCustomer } from './leadAiProvider.mjs';
import { LEAD_AI_AUDIT, analysisContextHash } from '../domain/leadAnalysis.mjs';
const fingerprint=text=>createHash('sha256').update(text).digest('hex');
const save=req=>new Promise((resolve,reject)=>req.session.save(error=>error?reject(error):resolve()));
export function createLeadAiIntegration({env=process.env,loadEmail,loadLead,validateForm,analyze=callAnalysis,research=researchCustomer}) {
 const router=Router(),counts=new Map();let busy=false;
 const enabled=()=>Boolean(env.LAB_ARK_API_KEY);
 const state=req=>req.session.leadAiDrafts ||= {};
 const token=req=>String(req.body.attachmentDraftToken||'');
 async function source(req){
  if(!validateForm(req,token(req)))throw Error('表单已过期，请重新打开线索页面。');
  const leadId=Number(req.body.leadId||0),threadId=Number(req.body.aiEmailThreadId||req.body.emailThreadId||0);
  if(leadId){const lead=await loadLead(req,leadId);if(!lead)throw Error('无权编辑这条线索。');if(threadId&&Number(lead.rawPayload?.emailThreadId)!==threadId)throw Error('来源邮件不匹配。');}
  let email=String(req.body.email||'');
  if(threadId){const context=await loadEmail(req,threadId);const message=[...(context.thread.messages||[])].reverse().find(message=>message.direction==='inbound');email=String(message?.textBody||'');}
  if(!email.trim()||email.length>20000)throw Error('来源邮件正文必填，最多20000字符。');
  return {email,threadId,leadId,hash:fingerprint(email)};
 }
 async function paid(req,run){
  if(!enabled())throw Error('尚未配置豆包服务，请联系管理员。');
  if(busy)throw Error('AI正在处理其他请求，请稍后重试。');
  const date=new Date().toISOString().slice(0,10),key=date+':'+req.currentUser.id;
  for(const old of counts.keys())if(!old.startsWith(date+':'))counts.delete(old);
  const limit=Math.max(1,Math.min(100,Number(env.LAB_CALL_LIMIT)||20));
  if((counts.get(key)||0)>=limit)throw Error('已达到本次服务运行的今日AI调用上限，请联系管理员。');
  counts.set(key,(counts.get(key)||0)+1);busy=true;
  try{return await run();}finally{busy=false;}
 }
 function put(req,value){const all=state(req);all[token(req)]={...all[token(req)],...value,actorId:req.currentUser.id};const keys=Object.keys(all);for(const key of keys.slice(0,Math.max(0,keys.length-8)))delete all[key];}
 const handle=run=>async(req,res)=>{try{if(req.csrfProtectionEnabled!==false&&!req.validateCsrf?.())return res.status(403).json({error:'页面已过期，请刷新后重试。'});await run(req,res);}catch(error){res.status(400).json({error:error.message?.slice(0,250)||'AI处理失败，请人工填写。'});}};
 router.post('/lead-submissions/ai/analyze',handle(async(req,res)=>{
  if(req.body.consent!==true)throw Error('请先确认允许将邮件提交至豆包。');
  const input=await source(req);
  const result=await paid(req,()=>analyze(input.email,{provider:'doubao',env}));
  const current=await source(req);if(current.hash!==input.hash)throw Error('来源邮件已有更新，请重新整理。');
  put(req,{analysis:{...result,sourceHash:input.hash,threadId:input.threadId,leadId:input.leadId},report:null});await save(req);
  res.json(result);
 }));
 router.post('/lead-submissions/ai/research',handle(async(req,res)=>{
  if(req.body.consent!==true)throw Error('请先确认允许使用询价方和最终用户公开信息进行联网调查。');
  if(!validateForm(req,token(req)))throw Error('表单已过期，请重新打开。');
  const leadId=Number(req.body.leadId||0);if(leadId&&!await loadLead(req,leadId))throw Error('无权编辑这条线索。');
  const input=req.body.context||{},fields={company:{value:input.companyName},website:{value:input.companyWebsite},transactionRole:{value:input.transactionRole},endUserName:{value:input.endUserName},endUserWebsite:{value:input.endUserWebsite},projectLocation:{value:input.projectLocation}};
  const report=await paid(req,()=>research(fields,{env}));
  put(req,{report:{...report,contextHash:analysisContextHash(input),leadId}});await save(req);res.json(report);
 }));
 return {router,enabled,async prepareSubmission(req,input){
  const draft=state(req)[String(input.attachmentDraftToken||'')];if(!draft)return input;
  if(Number(draft.actorId)!==Number(req.currentUser.id)||String(input.aiReviewed)!=='1')throw Error('请人工审阅AI整理内容及客户报告后再提交。');
  const leadId=Number(req.params.id||0);
  if(draft.analysis){
   if(draft.analysis.leadId!==leadId)throw Error('AI草稿不属于当前线索。');
   if(draft.analysis.threadId){
    if(!leadId&&Number(input.emailThreadId)!==draft.analysis.threadId)throw Error('来源邮件不匹配。');
    const context=await loadEmail(req,draft.analysis.threadId);const message=[...(context.thread.messages||[])].reverse().find(item=>item.direction==='inbound');
    if(fingerprint(String(message?.textBody||''))!==draft.analysis.sourceHash)throw Error('来源邮件已有更新，请重新整理并审阅。');
   }
  }
  if(draft.report){if(draft.report.leadId!==leadId)throw Error('报告不属于当前线索。');if(input.customerAnalysisReport&&draft.report.contextHash!==analysisContextHash(input))throw Error('客户或交易角色已变化，请重新生成报告或清空旧报告。');}
  return {...input,[LEAD_AI_AUDIT]:{resultAudit:{analysis:draft.analysis||null,report:input.customerAnalysisReport?draft.report||null:null}}};
 }};
}