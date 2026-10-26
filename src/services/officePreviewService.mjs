import path from 'node:path';
import {officeError,signOfficeToken,verifyOfficeToken} from './officeEditingService.mjs';
import {inspectStoredAttachmentFile} from './attachmentFileService.mjs';
import {canViewOpportunity} from './opportunityService.mjs';

// A viewer has no editing session, callback, persistence or approval mutation path.
export function createOfficePreviewService({config,attachmentRepository,opportunityRepository,opportunityResponsibilityRepository,contractApprovalRepository,userRepository,uploadDir}) {
 async function authorize(attachment,user){
  if(!attachment||!user||user.isActive===false||!Number.isSafeInteger(Number(user.id))||Number(user.id)<=0)throw officeError('Not found',404);
  if(path.extname(attachment.originalName).toLowerCase()!=='.xlsx')throw officeError('当前原样预览支持 XLSX，请下载其他格式的原文件查看。',400);
  const opportunity=await opportunityRepository.getOpportunityDetail(attachment.opportunityId);
  if(!opportunity)throw officeError('Not found',404);
  const teamMembers=await opportunityResponsibilityRepository?.listTeamMembersByOpportunity?.(opportunity.id)||[];
  let allowed=canViewOpportunity(user,{...opportunity,teamMembers});
  if(!allowed&&contractApprovalRepository?.listByOpportunity){const approvals=await contractApprovalRepository.listByOpportunity(opportunity.id);allowed=approvals.some(row=>Number(row.reviewerUserId)===Number(user.id));}
  if(!allowed)throw officeError('Not found',404);
  return opportunity;
 }
 async function checkedFile(attachment){
  const file=await inspectStoredAttachmentFile({uploadDir,storedPath:attachment.storedPath});
  if(attachment.sha256&&attachment.sha256!==file.sha256)throw officeError('原文件校验失败，请联系管理员核查附件。',409);
  return file;
 }
 async function viewer(attachment,user,{mobile=false}={}){
  const opportunity=await authorize(attachment,user),file=await checkedFile(attachment);
  const token=signOfficeToken({purpose:'attachment-preview',attachmentId:Number(attachment.id),opportunityId:Number(opportunity.id),actorId:Number(user.id),sha256:file.sha256,exp:Math.floor(Date.now()/1000)+3600},config.secret);
  const settings={type:mobile?'mobile':'desktop',documentType:'cell',width:'100%',height:'100%',document:{key:'readonly-'+attachment.id+'-'+file.sha256,fileType:'xlsx',title:attachment.originalName,url:config.baseUrl+'/office-preview-service/'+attachment.id+'/file?token='+encodeURIComponent(token),permissions:{edit:false,comment:false,review:false,fillForms:false,download:false,print:true,copy:true,modifyFilter:false}},editorConfig:{mode:'view',lang:'zh-CN',customization:{autosave:false,forcesave:false,help:false,compactHeader:true}}};
  return {settings:{...settings,token:signOfficeToken(settings,config.secret)},scriptUrl:config.documentServerUrl+'/web-apps/apps/api/documents/api.js'};
 }
 async function source(attachmentId,token){
  const signed=verifyOfficeToken(token,config.secret);
  if(signed.purpose!=='attachment-preview'||signed.attachmentId!==Number(attachmentId)||!Number.isSafeInteger(signed.actorId)||!Number.isFinite(signed.exp))throw officeError('Forbidden',403);
  const attachment=await attachmentRepository.findById(attachmentId);
  if(!attachment||Number(attachment.opportunityId)!==signed.opportunityId)throw officeError('Not found',404);
  await authorize(attachment,await userRepository.findByIdWithRoles(signed.actorId));
  const file=await checkedFile(attachment);if(file.sha256!==signed.sha256)throw officeError('文件已变化，请重新打开预览。',409);
  return {...attachment,absolutePath:file.absolutePath};
 }
 return {viewer,source};
}
