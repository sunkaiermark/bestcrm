import { normalizeProjectContacts, projectContactKey } from './projectContacts.mjs';
import { createHash } from 'node:crypto';
export const LEAD_AI_AUDIT = Symbol('serverLeadAiAudit');
export const TRANSACTION_ROLES = Object.freeze({unknown:'待确认',end_user:'最终用户',agent:'代理商／经销商',epc:'工程公司／EPC',procurement:'采购服务商'});
const names=['transactionRole','endUserName','endUserWebsite','projectLocation','customerAnalysisReport'];
const text=(value,max)=>String(value||'').trim().slice(0,max);
export function customerAnalysisContext(input={}) {
  return Object.fromEntries(['companyName','companyWebsite','transactionRole','endUserName','endUserWebsite','projectLocation'].map(name=>[name,text(input[name],name.includes('Website')?300:200)]));
}
export function analysisContextHash(input) { return createHash('sha256').update(JSON.stringify(customerAnalysisContext(input))).digest('hex'); }
export function normalizeLeadAnalysis(input,actor,previous={}) {
  const changes=names.some(name=>Object.hasOwn(input,name))||Object.hasOwn(input,'projectContacts');
  if(!changes&&!input[LEAD_AI_AUDIT]?.resultAudit)return previous;
  const result={...previous};
  for(const name of names)if(Object.hasOwn(input,name))result[name]=text(input[name],name==='customerAnalysisReport'?30000:name.includes('Website')?300:200);
  if(Object.hasOwn(input,'projectContacts')){
    const audit=input[LEAD_AI_AUDIT]?.resultAudit?.analysis;
    result.projectContacts=normalizeProjectContacts(input.projectContacts).map(row=>{
      const key=projectContactKey(row);
      const original=(previous.projectContacts||[]).find(item=>projectContactKey(item)===key);
      const extracted=(audit?.contacts||[]).find(item=>projectContactKey(item)===key);
      return {...row,...(extracted?{source:'ai_email',sourceThreadId:Number(audit.threadId)||null,evidence:extracted.evidence||''}:original?{source:original.source||'manual',sourceThreadId:original.sourceThreadId||null,evidence:original.evidence||''}:{source:'manual'})};
    });
  }
  result.transactionRole ||= 'unknown';
  if(!Object.hasOwn(TRANSACTION_ROLES,result.transactionRole))throw Error('Invalid transaction role');
  if(result.transactionRole==='end_user'){
    result.endUserName=text(input.companyName,200);
    result.endUserWebsite=text(input.companyWebsite,300);
  }
  const previousContent={...Object.fromEntries(names.map(name=>[name,previous[name]||''])),projectContacts:previous.projectContacts||[]};
  const nextContent={...Object.fromEntries(names.map(name=>[name,result[name]||''])),projectContacts:result.projectContacts||[]};
  if(JSON.stringify(previousContent)!==JSON.stringify(nextContent)||input[LEAD_AI_AUDIT]?.resultAudit){
    result.reviewedBy=Number(actor.id);result.reviewedAt=new Date().toISOString();
    result.history=[...(previous.history||[]),{...nextContent,reviewedBy:result.reviewedBy,reviewedAt:result.reviewedAt,...(input[LEAD_AI_AUDIT]?.resultAudit?{ai:input[LEAD_AI_AUDIT].resultAudit}:{})}].slice(-20);
  }
  return result;
}