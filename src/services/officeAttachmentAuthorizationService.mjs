import {createUserRepository} from '../repositories/userRepository.mjs';
import {officeError} from './officeEditingService.mjs';
import {canViewOpportunity} from './opportunityService.mjs';
import {createOpportunityRepository} from '../repositories/opportunityRepository.mjs';
import {createOpportunityCollaborationRepository} from '../repositories/opportunityCollaborationRepository.mjs';
import {createOpportunityTechnicalDraftRepository} from '../repositories/opportunityTechnicalDraftRepository.mjs';
import {loadOfficeWorkPackageContext,assertOfficeWorkPackageEditable} from './officeWorkPackageService.mjs';

export function createOfficeAttachmentAuthorization({pool,userRepository,canDeleteAttachment,canUploadAttachment}) {
  return async(attachment,user,fromCallback=false,client=null)=>{
    if(fromCallback)user=await (client?createUserRepository(client):userRepository).findByIdWithRoles(user.id);
    if(!attachment||attachment.retiredAt||attachment.opportunityMaterialVersionId||attachment.sourceInquiryAttachmentId||!user||user.isActive===false)throw officeError('该文件只读，请使用未提交审批的工作文件。',403);
    const target=client||pool;
    // Same lock order as review/withdraw, preventing a save racing approval.
    if(client)await client.query('SELECT id FROM opportunities WHERE id=$1 FOR UPDATE',[attachment.opportunityId]);
    const opportunity=await createOpportunityRepository(target).findById(attachment.opportunityId);
    if(!opportunity||opportunity.archivedAt)throw officeError('商机不存在或已归档。',403);
    const collaboration=createOpportunityCollaborationRepository(target);
    const team=await collaboration.listTechnicalTeam(opportunity.id);
    opportunity.teamMembers=team.map(row=>({userId:Number(row.user_id),roleCode:'quotation_engineer',isActive:true}));
    if(!canViewOpportunity(user,opportunity))throw officeError('无权查看此商机。',403);
    const context=await loadOfficeWorkPackageContext(target,attachment.id,{lock:Boolean(client)});
    if(context){
      assertOfficeWorkPackageEditable({context,attachment,opportunity,user,canUpload:canUploadAttachment(user,opportunity,attachment.category)});
      return {workPackage:context};
    }
    if(await createOpportunityTechnicalDraftRepository(target).isAttachmentLinked(attachment.id))throw officeError('技术草案文件请从原草案修订流程处理。',403);
    if(!canDeleteAttachment(user,opportunity,attachment))throw officeError('当前阶段无权编辑该附件。',403);
    return {};
  };
}
