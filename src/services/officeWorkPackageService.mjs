import {officeError} from './officeEditingService.mjs';
import {canManageOpportunityEngineeringTeam,canContributeOpportunityEngineering} from './opportunityService.mjs';
import {createAttachmentRepository} from '../repositories/attachmentRepository.mjs';
import {createOpportunityCollaborationRepository} from '../repositories/opportunityCollaborationRepository.mjs';

export async function loadOfficeWorkPackageContext(target,attachmentId,{lock=false}={}) {
  const result=await target.query(`
    SELECT wp.id AS work_package_id,wp.opportunity_id,wp.plan_kind,wp.assignee_user_id,wp.deleted_at,
      v.id AS version_id,v.status AS version_status,
      latest.id AS latest_version_id,latest.status AS latest_version_status
    FROM opportunity_collaboration_work_package_files f
    JOIN opportunity_collaboration_work_package_versions v ON v.id=f.work_package_version_id
    JOIN opportunity_collaboration_work_packages wp ON wp.id=v.work_package_id
    JOIN LATERAL (SELECT id,status FROM opportunity_collaboration_work_package_versions WHERE work_package_id=wp.id ORDER BY version_no DESC,id DESC LIMIT 1) latest ON true
    WHERE f.attachment_id=$1
  `,[attachmentId]);
  const row=result.rows[0];if(!row)return null;
  if(lock){await target.query('SELECT id FROM opportunity_collaboration_work_packages WHERE id=$1 FOR UPDATE',[row.work_package_id]);return loadOfficeWorkPackageContext(target,attachmentId);}
  return {workPackageId:Number(row.work_package_id),opportunityId:Number(row.opportunity_id),planKind:row.plan_kind,assigneeUserId:Number(row.assignee_user_id),deleted:Boolean(row.deleted_at),versionId:Number(row.version_id),versionStatus:row.version_status,latestVersionId:Number(row.latest_version_id),latestVersionStatus:row.latest_version_status};
}
export function assertOfficeWorkPackageEditable({context,attachment,opportunity,user,canUpload}) {
  throw officeError('工作包文件请下载后线下修改，再上传并提交。',403);
}

export async function saveOfficeWorkPackageRevision({client,context,attachment,stored,actorUserId}) {
  // Caller holds the opportunity and work package locks and has rechecked access.
  const repository=createAttachmentRepository(client);
  const saved=await repository.createAttachment({opportunityId:attachment.opportunityId,category:attachment.category,originalName:attachment.originalName,mimeType:attachment.mimeType,uploadedBy:actorUserId,...stored});
  const prior=await client.query(`SELECT a.* FROM opportunity_collaboration_work_package_files f JOIN attachments a ON a.id=f.attachment_id WHERE f.work_package_version_id=$1 AND a.retired_at IS NULL ORDER BY f.sort_order,f.id`,[context.versionId]);
  const ids=[];let replaced=false;
  for(const file of prior.rows){
    if(Number(file.id)===Number(attachment.id)){ids.push(saved.id);replaced=true;continue;}
    if(!file.sha256)throw officeError('工作包存在缺少校验信息的文件，请先核验附件。',409);
    // Preserve all other files in a new version without altering their bytes or old links.
    const copy=await repository.createAttachment({opportunityId:attachment.opportunityId,category:file.category,originalName:file.original_name,storedPath:file.stored_path,mimeType:file.mime_type,fileSize:Number(file.file_size),sha256:file.sha256,uploadedBy:actorUserId});ids.push(copy.id);
  }
  if(!replaced)throw officeError('工作包文件已变更，请刷新后重试。',409);
  const version=await createOpportunityCollaborationRepository(client,{inTransaction:true}).submitVersion({workPackageId:context.workPackageId,submittedByUserId:actorUserId,attachmentIds:ids,staged:true});
  if(!version)throw officeError('工作包新草稿保存失败。',409);
  return saved;
}
