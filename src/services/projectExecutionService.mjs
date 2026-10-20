import path from 'node:path';
import {rm} from 'node:fs/promises';
import {persistUploadedOpportunityAttachment} from './attachmentIntegrityService.mjs';
import { createOpportunityRepository } from '../repositories/opportunityRepository.mjs';
import { createAttachmentRepository } from '../repositories/attachmentRepository.mjs';
import { createUserRepository } from '../repositories/userRepository.mjs';
import { hasRole } from '../domain/roles.mjs';
import { STATUSES } from '../domain/statuses.mjs';
import { canViewOpportunity } from './opportunityService.mjs';

export const PROJECT_EXECUTION_CREATION_SETTING = 'project_execution_creation'; // Legacy key, no longer grants start permission.
function transactionRepositories(repositories, projectExecutionRepository, client) {
 return {...repositories,projectExecutionRepository,inProjectTransaction:true,
   ...(client ? {opportunityRepository:createOpportunityRepository(client),attachmentRepository:createAttachmentRepository(client),userRepository:createUserRepository(client)} : {})};
}

const RELEASE_WORKFLOW_ACTIONS = Object.freeze({
  submit_technical_solution: {
    from: 'technical_solution_pending', to: 'manufacturing_process_pending',
    actor: 'projectEngineerUserId', version: 'technicalSolutionVersion', event: 'technical_solution_submitted'
  },
  submit_manufacturing_process: {
    from: 'manufacturing_process_pending', to: 'technical_review_pending',
    actor: 'processEngineerUserId', version: 'manufacturingProcessVersion', event: 'manufacturing_process_submitted'
  },
  complete_technical_review: {
    from: 'technical_review_pending', to: 'approval_pending',
    actor: 'technicalManagerUserId', event: 'technical_review_completed'
  },
  approve_release: {
    from: 'approval_pending', to: 'release_pending',
    actor: 'approverUserId', event: 'release_approved'
  },
  publish_release: {
    from: 'release_pending', to: 'released',
    actor: 'publisherUserId', event: 'release_published'
  }
});

function todayInShanghai() { return new Date().toLocaleDateString('sv-SE',{timeZone:'Asia/Shanghai'}); }

function forbidden() {
  throw new Error('Forbidden');
}

function validDateOnly(value) {
  const normalized = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    return null;
  }
  const date = new Date(`${normalized}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== normalized
    ? null
    : normalized;
}

function validUserId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function validReleaseVersion(value) {
  return text(value, 100);
}

export function canConfirmProjectExecution(actor, opportunity) {
  return Boolean(actor && actor.isActive !== false && hasRole(actor, 'salesperson')
    && Number(actor.id) === Number(opportunity?.salespersonId));
}

export function canViewProjectExecution(actor, projectExecution) {
  return hasRole(actor,'general_manager') || Number(projectExecution?.confirmedByUserId) === Number(actor?.id)
    || Number(projectExecution?.projectOwnerUserId) === Number(actor?.id)
    || canViewOpportunity(actor, projectExecution);
}

export function canManageProjectExecution(actor, projectExecution) {
  return actor?.isActive !== false && hasRole(actor, 'general_manager');
}

async function requireActiveWorkflowParticipants(userRepository, input) {
  const participantIds = {
    projectOwnerUserId: validUserId(input.projectOwnerUserId),
    projectEngineerUserId: validUserId(input.projectEngineerUserId),
    processEngineerUserId: validUserId(input.processEngineerUserId),
    technicalManagerUserId: validUserId(input.technicalManagerUserId),
    approverUserId: validUserId(input.approverUserId),
    publisherUserId: validUserId(input.publisherUserId)
  };
  if (Object.values(participantIds).some((id) => !id)) {
    throw new Error('Project execution roles are required');
  }
  const participants = await Promise.all(Object.entries(participantIds).map(async ([key, id]) => {
    const user = await userRepository.findByIdWithRoles(id);
    return [key, user];
  }));
  const users = Object.fromEntries(participants);
  if (Object.values(users).some((user) => !user || user.isActive === false)) {
    throw new Error('Project execution roles must be active users');
  }
  if (!hasRole(users.technicalManagerUserId, 'technical_manager')) {
    throw new Error('A technical manager is required for technical review');
  }
  const submitterIds = new Set([participantIds.projectEngineerUserId, participantIds.processEngineerUserId]);
  if (submitterIds.has(participantIds.technicalManagerUserId) || submitterIds.has(participantIds.approverUserId)) {
    throw new Error('Submitters cannot review or approve their own release workflow');
  }
  return participantIds;
}

export async function loadProjectExecutionConfirmationContext(repositories, actor, opportunityId) {
  const opportunity = await repositories.opportunityRepository.getOpportunityDetail(opportunityId);
  if (!opportunity) throw new Error('Opportunity not found');
  if (!canConfirmProjectExecution(actor, opportunity)) forbidden();
  if (opportunity.status !== STATUSES.CONTRACT_ARCHIVED) {
    throw new Error('Project Execution can only be created after contract approval');
  }
  const [projectExecution, users, attachments] = await Promise.all([
    repositories.projectExecutionRepository.findByOpportunity(opportunityId),
    repositories.userRepository.listUsersWithRoles(),
    repositories.attachmentRepository.listByOpportunity(opportunityId)
  ]);
  return { opportunity, projectExecution, latestSigningDate:todayInShanghai(), users: users.filter(user => user.isActive !== false),
    signedContracts: attachments.filter(file => file.category === 'signed_contract' && !file.retiredAt) };
}

export async function confirmProjectExecution(repositories, actor, opportunityId, input) {
  if (repositories.projectExecutionRepository.withTransaction && !repositories.inProjectTransaction) {
    return repositories.projectExecutionRepository.withTransaction((projectExecutionRepository,client) =>
      confirmProjectExecution(transactionRepositories(repositories,projectExecutionRepository,client), actor, opportunityId, input));
  }
  await repositories.projectExecutionRepository.lockOpportunity?.(opportunityId);
  const context = await loadProjectExecutionConfirmationContext(repositories, actor, opportunityId);
  if (context.projectExecution) return {projectExecution:context.projectExecution,created:false};
  // Sales only supplies the signed file. Do not invent a signing date or accept execution assignments here.
  const contractSignedOn = null;
  const ownerId = null;
  const eligibleContracts=input.useExistingContract
    ? (await repositories.attachmentRepository.listByOpportunity(opportunityId)).filter(file=>['contract','signed_contract'].includes(file.category)&&!file.retiredAt)
    : context.signedContracts;
  const signedContract=input.useExistingContract ? eligibleContracts.sort((a,b)=>Number(b.id)-Number(a.id))[0] : eligibleContracts.find(file => Number(file.id)===Number(input.signedContractAttachmentId));
  if (!signedContract || !/^[a-f0-9]{64}$/.test(signedContract.sha256||'') || !(signedContract.fileSize>0)) {
    throw new Error('Valid signed contract attachment is required');
  }
  await repositories.projectExecutionRepository.lockSignedContract?.(signedContract.id, opportunityId);
  const result=await repositories.projectExecutionRepository.createForOpportunity({
    opportunityId:context.opportunity.id,contractSignedOn,confirmedByUserId:actor.id,
    projectOwnerUserId:ownerId,signedContractAttachmentId:signedContract.id
  });
  if(result.created) await repositories.projectExecutionRepository.appendAuditEvent({
    projectExecutionId:result.projectExecution.id,eventType:'sales_project_started',actorUserId:actor.id,
    note:'销售从合同栏推送项目执行，待总经理制定计划；合同附件 #'+signedContract.id+'；SHA256 '+signedContract.sha256
  });
  return result;
}

export async function receiveSignedContract(repositories, actor, opportunityId, file, uploadDir) {
 if(repositories.projectExecutionRepository.withTransaction && !repositories.inProjectTransaction){
  try {
   return await repositories.projectExecutionRepository.withTransaction((projectExecutionRepository,client)=>
    receiveSignedContract(transactionRepositories(repositories,projectExecutionRepository,client),actor,opportunityId,file,uploadDir));
  } catch(error) {
   const target=file?.path && path.resolve(file.path),root=path.resolve(uploadDir)+path.sep;
   if(target?.startsWith(root)) await rm(target,{force:true});
   throw error;
  }
 }
 await repositories.projectExecutionRepository.lockOpportunity?.(opportunityId);
 await loadProjectExecutionConfirmationContext(repositories,actor,opportunityId);
 const attachment=await persistUploadedOpportunityAttachment({attachmentRepository:repositories.attachmentRepository,uploadDir,file,
  opportunityId:Number(opportunityId),category:'signed_contract',actorUserId:actor.id});
 const result=await confirmProjectExecution(repositories,actor,opportunityId,{signedContractAttachmentId:attachment.id});
 if(!result.created) await repositories.projectExecutionRepository.appendAuditEvent({projectExecutionId:result.projectExecution.id,
  eventType:'signed_contract_received',actorUserId:actor.id,note:'销售补传双方签署合同，保留版本；合同附件 #'+attachment.id});
 return {...result,attachment};
}

export const PROJECT_DEPARTMENTS = Object.freeze([
 ['project','项目部执行','Project Department'],['technical','技术','Technical'],
 ['supply_chain','供应链','Supply chain'],['quality_control','质量控制','Quality control']
]);

export async function saveGeneralManagerPlan(repositories,actor,projectExecutionId,input){
 if(!canManageProjectExecution(actor)) forbidden();
 if(repositories.projectExecutionRepository.withTransaction && !repositories.inProjectTransaction)
  return repositories.projectExecutionRepository.withTransaction((projectExecutionRepository,client)=>
   saveGeneralManagerPlan(transactionRepositories(repositories,projectExecutionRepository,client),actor,projectExecutionId,input));
 await repositories.projectExecutionRepository.lockProject?.(projectExecutionId);
 const project=await getProjectExecutionDetail(repositories,actor,projectExecutionId);
 const start=validDateOnly(input.plannedStartOn),end=validDateOnly(input.plannedCompletionOn);
 if(!start||!end||end<start)throw new Error('Valid project plan dates are required; completion cannot be before start');
 const departments=[];
 for(const [code,title] of PROJECT_DEPARTMENTS){
  const responsibleUserId=validUserId(input[code+'UserId']);
  const user=responsibleUserId && await repositories.userRepository.findByIdWithRoles(responsibleUserId);
  if(!user||user.isActive===false)throw new Error('Active department owner is required: '+code);
  const plannedStartOn=validDateOnly(input[code+'StartOn']||start),dueOn=validDateOnly(input[code+'DueOn']||end);
  if(!plannedStartOn||!dueOn||dueOn<plannedStartOn||plannedStartOn<start||dueOn>end)
   throw new Error('Department dates must be within the project plan: '+code);
  departments.push({departmentCode:code,title,responsibleUserId,plannedStartOn,dueOn,
   instruction:text(input[code+'Instruction'])||title+'负责本部门执行、进度反馈与成果提交。'});
 }
 await repositories.projectExecutionRepository.updateProject(project.id,{
  projectOwnerUserId:departments[0].responsibleUserId,status:project.status,
  plannedStartOn:start,plannedCompletionOn:end,actualDeliveryOn:project.actualDeliveryOn,
  actualAcceptanceOn:project.actualAcceptanceOn,riskSummary:text(input.riskSummary)
 });
 for(const department of departments){
  const workPackageId=await repositories.projectExecutionRepository.saveDepartmentPlan({projectExecutionId:project.id,...department,actorUserId:actor.id});
  await repositories.projectExecutionRepository.appendAuditEvent({projectExecutionId:project.id,workPackageId,
   eventType:'department_plan_assigned',actorUserId:actor.id,
   note:'总经理分配'+department.title+'；执行人 #'+department.responsibleUserId+'；计划 '+department.plannedStartOn+' 至 '+department.dueOn});
 }
 return repositories.projectExecutionRepository.findById(project.id);
}

export async function configureProjectExecutionWorkflow(repositories, actor, projectExecutionId, input) {
  if (repositories.projectExecutionRepository.withTransaction && !repositories.inProjectTransaction) {
    return repositories.projectExecutionRepository.withTransaction((projectExecutionRepository,client) =>
      configureProjectExecutionWorkflow(transactionRepositories(repositories,projectExecutionRepository,client),actor,projectExecutionId,input));
  }
  await repositories.projectExecutionRepository.lockProject?.(projectExecutionId);
  const project=await getProjectExecutionDetail(repositories,actor,projectExecutionId);
  if(!canManageProjectExecution(actor,project)) forbidden();
  const existing=await repositories.projectExecutionRepository.findReleaseWorkflow(project.id);
  if(existing) return existing;
  const participants=await requireActiveWorkflowParticipants(repositories.userRepository,{...input,projectOwnerUserId:project.projectOwnerUserId});
  await repositories.projectExecutionRepository.createContractKickoffTemplate({
    projectExecutionId:project.id,referenceDate:project.plannedStartOn || project.contractSignedOn || todayInShanghai(),
    ...participants,technicalResponsibleUserId:participants.projectEngineerUserId,
    technicalApproverUserId:participants.technicalManagerUserId,
    kickoffParticipantNote:'参与人：销售负责人、技术负责人、项目执行人。',actorUserId:actor.id
  });
  return repositories.projectExecutionRepository.findReleaseWorkflow(project.id);
}

export async function getProjectExecutionDetail(repositories, actor, projectExecutionId) {
  const projectExecution = await repositories.projectExecutionRepository.findById(projectExecutionId);
  if (!projectExecution) {
    throw new Error('Project Execution not found');
  }
  if (!canViewProjectExecution(actor, projectExecution)) {
    forbidden();
  }
  return projectExecution;
}

function text(value, max = 2000) {
  return String(value || '').trim().slice(0, max);
}

function nullableDate(value) {
  return validDateOnly(value) || null;
}

function validProjectStatus(value) {
  return ['planning', 'in_progress', 'on_hold', 'completed', 'cancelled'].includes(value)
    ? value : null;
}

function validMilestoneStatus(value) {
  return ['not_started', 'in_progress', 'blocked', 'completed', 'cancelled'].includes(value)
    ? value : null;
}

function validWorkPackageStatus(value) {
  return ['not_started', 'in_progress', 'blocked', 'pending_acceptance', 'completed', 'cancelled'].includes(value)
    ? value : null;
}

function actorCanViewProject(actor, projectExecution, workPackages) {
  return canViewProjectExecution(actor, projectExecution)
    || workPackages.some((item) => Number(item.responsibleUserId) === Number(actor?.id));
}

export async function listProjectExecutions(repositories, actor) {
  const projects = await repositories.projectExecutionRepository.listAll();
  const visible = [];
  for (const project of projects) {
    if (canViewProjectExecution(actor, project)) {
      visible.push(project);
      continue;
    }
    const packages = await repositories.projectExecutionRepository.listWorkPackages(project.id);
    if (packages.some((item) => Number(item.responsibleUserId) === Number(actor?.id))) visible.push(project);
  }
  return visible;
}

export async function loadProjectExecutionWorkspace(repositories, actor, projectExecutionId) {
  const projectExecution = await repositories.projectExecutionRepository.findById(projectExecutionId);
  if (!projectExecution) throw new Error('Project Execution not found');
  const [milestones, workPackages, users, releaseWorkflow, auditEvents] = await Promise.all([
    repositories.projectExecutionRepository.listMilestones(projectExecution.id),
    repositories.projectExecutionRepository.listWorkPackages(projectExecution.id),
    repositories.userRepository.listUsersWithRoles(),
    typeof repositories.projectExecutionRepository.findReleaseWorkflow === 'function'
      ? repositories.projectExecutionRepository.findReleaseWorkflow(projectExecution.id) : null,
    typeof repositories.projectExecutionRepository.listAuditEvents === 'function'
      ? repositories.projectExecutionRepository.listAuditEvents(projectExecution.id) : []
  ]);
  if (!actorCanViewProject(actor, projectExecution, workPackages)) forbidden();
  return {
    projectExecution,
    milestones,
    workPackages,
    releaseWorkflow,
    auditEvents,
    users: users.filter((user) => user.isActive !== false),
    contractKickoff: {
      salesOwnerUserId: projectExecution.salespersonId,
      technicalResponsibleUserId: releaseWorkflow?.projectEngineerUserId || projectExecution.quotationEngineerId,
      projectOwnerUserId: projectExecution.projectOwnerUserId,
      technicalApproverUserId: releaseWorkflow?.technicalManagerUserId || projectExecution.technicalManagerId,
      technicalManagerId: releaseWorkflow?.technicalManagerUserId || projectExecution.technicalManagerId
    },
    canViewOriginOpportunity: canViewOpportunity(actor,projectExecution),
    departments: workPackages.filter(item => item.departmentCode),
    canManage: canManageProjectExecution(actor, projectExecution)
  };
}

export async function updateProjectExecution(repositories, actor, projectExecutionId, input) {
  const project = await getProjectExecutionDetail(repositories, actor, projectExecutionId);
  if (!canManageProjectExecution(actor, project)) forbidden();
  if(Number(input.projectOwnerUserId)!==Number(project.projectOwnerUserId)) throw new Error('Project owner must be assigned through department plan');
  const status = validProjectStatus(input.status);
  const projectOwnerUserId = Number(input.projectOwnerUserId);
  if (!status || !Number.isInteger(projectOwnerUserId) || projectOwnerUserId <= 0) {
    throw new Error('Valid project owner and status are required');
  }
  const plannedStartOn = nullableDate(input.plannedStartOn);
  const plannedCompletionOn = nullableDate(input.plannedCompletionOn);
  if (plannedStartOn && plannedCompletionOn && plannedCompletionOn < plannedStartOn) {
    throw new Error('Planned completion cannot be before planned start');
  }
  return repositories.projectExecutionRepository.updateProject(project.id, {
    projectOwnerUserId, status, plannedStartOn, plannedCompletionOn,
    actualDeliveryOn: nullableDate(input.actualDeliveryOn),
    actualAcceptanceOn: nullableDate(input.actualAcceptanceOn),
    riskSummary: text(input.riskSummary)
  });
}

export async function createProjectMilestone(repositories, actor, projectExecutionId, input) {
  const project = await getProjectExecutionDetail(repositories, actor, projectExecutionId);
  if (!canManageProjectExecution(actor, project)) forbidden();
  const title = text(input.title, 200);
  const plannedOn = validDateOnly(input.plannedOn);
  const milestoneType = ['design_release', 'production_readiness', 'inspection', 'shipment', 'delivery', 'acceptance', 'other'].includes(input.milestoneType)
    ? input.milestoneType : 'other';
  const status = validMilestoneStatus(input.status) || 'not_started';
  const responsibleUserId = input.responsibleUserId ? Number(input.responsibleUserId) : null;
  if (!title || !plannedOn || (input.responsibleUserId && (!Number.isInteger(responsibleUserId) || responsibleUserId <= 0))) {
    throw new Error('Valid milestone title and planned date are required');
  }
  return repositories.projectExecutionRepository.createMilestone({
    projectExecutionId: project.id, title, milestoneType, plannedOn,
    actualOn: nullableDate(input.actualOn), status, responsibleUserId,
    note: text(input.note), actorUserId: actor.id
  });
}

export async function updateProjectMilestone(repositories, actor, projectExecutionId, milestoneId, input) {
  const project = await getProjectExecutionDetail(repositories, actor, projectExecutionId);
  if (!canManageProjectExecution(actor, project)) forbidden();
  const plannedOn = validDateOnly(input.plannedOn);
  const status = validMilestoneStatus(input.status);
  const responsibleUserId = input.responsibleUserId ? Number(input.responsibleUserId) : null;
  if (!plannedOn || !status || (input.responsibleUserId && (!Number.isInteger(responsibleUserId) || responsibleUserId <= 0))) {
    throw new Error('Valid milestone plan, status and responsible user are required');
  }
  await repositories.projectExecutionRepository.updateMilestone(Number(milestoneId), {
    projectExecutionId: project.id,
    plannedOn,
    actualOn: nullableDate(input.actualOn),
    status,
    responsibleUserId,
    note: text(input.note)
  });
}

export async function createProjectWorkPackage(repositories, actor, projectExecutionId, input) {
  const project = await getProjectExecutionDetail(repositories, actor, projectExecutionId);
  if (!canManageProjectExecution(actor, project)) forbidden();
  const title = text(input.title, 200);
  const responsibleUserId = Number(input.responsibleUserId);
  const plannedStartOn = nullableDate(input.plannedStartOn);
  const dueOn = nullableDate(input.dueOn);
  if (!title || !Number.isInteger(responsibleUserId) || responsibleUserId <= 0) {
    throw new Error('Valid work package title and responsible user are required');
  }
  if (plannedStartOn && dueOn && dueOn < plannedStartOn) {
    throw new Error('Work package due date cannot be before planned start');
  }
  return repositories.projectExecutionRepository.createWorkPackage({
    projectExecutionId: project.id, title, responsibleUserId, plannedStartOn, dueOn,
    instruction: text(input.instruction), blockerNote: text(input.blockerNote),
    status: validWorkPackageStatus(input.status) || 'not_started', actorUserId: actor.id
  });
}

export async function updateProjectWorkPackage(repositories, actor, projectExecutionId, workPackageId, input) {
  const workspace = await loadProjectExecutionWorkspace(repositories, actor, projectExecutionId);
  const workPackage = workspace.workPackages.find((item) => Number(item.id) === Number(workPackageId));
  if (!workPackage) throw new Error('Work package not found');
  const manages = workspace.canManage;
  const owns = Number(workPackage.responsibleUserId) === Number(actor?.id);
  if (!manages && !owns) forbidden();
  const requestedStatus = validWorkPackageStatus(input.status);
  if (!requestedStatus) throw new Error('Valid work package status is required');
  if (!manages && !['in_progress', 'blocked', 'pending_acceptance'].includes(requestedStatus)) {
    forbidden();
  }
  const blockerNote = text(input.blockerNote);
  if (requestedStatus === 'blocked' && !blockerNote) {
    throw new Error('A blocker reason is required when a work package is blocked');
  }
  const responsibleUserId = manages && input.responsibleUserId
    ? validUserId(input.responsibleUserId) : workPackage.responsibleUserId;
  if (!responsibleUserId) throw new Error('A valid work package owner is required');
  if (manages && Number(responsibleUserId) !== Number(workPackage.responsibleUserId)) {
    const responsible = await repositories.userRepository.findByIdWithRoles(responsibleUserId);
    if (!responsible || responsible.isActive === false) throw new Error('A valid work package owner is required');
  }
  const plannedStartOn = manages ? nullableDate(input.plannedStartOn) : workPackage.plannedStartOn;
  const dueOn = manages ? nullableDate(input.dueOn) : workPackage.dueOn;
  if (plannedStartOn && dueOn && dueOn < plannedStartOn) {
    throw new Error('Work package due date cannot be before planned start');
  }
  const accepted = manages && requestedStatus === 'completed';
  await repositories.projectExecutionRepository.updateWorkPackage(workPackage.id, {
    responsibleUserId,
    plannedStartOn,
    dueOn,
    status: requestedStatus,
    blockerNote,
    acceptanceNote: text(input.acceptanceNote),
    completedOn: requestedStatus === 'completed' ? (nullableDate(input.completedOn) || new Date().toISOString().slice(0, 10)) : null,
    acceptedByUserId: accepted ? actor.id : null,
    acceptedAt: accepted ? new Date().toISOString() : null
  });
  if (typeof repositories.projectExecutionRepository.appendAuditEvent === 'function') {
    const note = requestedStatus === 'blocked'
      ? `受阻原因：${blockerNote}`
      : text(input.acceptanceNote) || `工作包状态更新为：${requestedStatus}`;
    await repositories.projectExecutionRepository.appendAuditEvent({
      projectExecutionId: workspace.projectExecution.id,
      workPackageId: workPackage.id,
      eventType: 'work_package_updated',
      fromStatus: workPackage.status,
      toStatus: requestedStatus,
      actorUserId: actor.id,
      note
    });
  }
}

export async function advanceProjectReleaseWorkflow(repositories, actor, projectExecutionId, input) {
  const project = await repositories.projectExecutionRepository.findById(projectExecutionId);
  if (!project) throw new Error('Project Execution not found');
  const workflow = await repositories.projectExecutionRepository.findReleaseWorkflow(project.id);
  if (!workflow) throw new Error('Project release workflow not found');
  const action = RELEASE_WORKFLOW_ACTIONS[input.action];
  if (!action || workflow.status !== action.from) throw new Error('Workflow action is not available at the current stage');
  const isWorkflowParticipant = Object.values(RELEASE_WORKFLOW_ACTIONS)
    .some((candidate) => Number(workflow[candidate.actor]) === Number(actor?.id));
  if (!canViewProjectExecution(actor, project) && !isWorkflowParticipant) forbidden();
  if (Number(workflow[action.actor]) !== Number(actor?.id)) forbidden();
  const version = action.version ? validReleaseVersion(input.version) : '';
  if (action.version && !version) throw new Error('A document version is required for submission');
  const note = text(input.note);
  const next = await repositories.projectExecutionRepository.advanceReleaseWorkflow(workflow.id, {
    status: action.to,
    technicalSolutionVersion: action.version === 'technicalSolutionVersion' ? version : '',
    manufacturingProcessVersion: action.version === 'manufacturingProcessVersion' ? version : ''
  });
  await repositories.projectExecutionRepository.appendAuditEvent({
    projectExecutionId: project.id,
    releaseWorkflowId: workflow.id,
    eventType: action.event,
    fromStatus: workflow.status,
    toStatus: action.to,
    actorUserId: actor.id,
    note: note || (version ? `提交版本：${version}` : '')
  });
  return next;
}

// Called only by the authorized contract approval inside its existing transaction.
export async function startProjectAfterContractApproval(repositories, actor, opportunity) {
  if(opportunity.status!==STATUSES.CONTRACT_ARCHIVED)throw new Error('Contract approval is required');
  const repo=repositories.projectExecutionRepository;
  await repo.lockOpportunity(opportunity.id);
  const existing=await repo.findByOpportunity(opportunity.id);
  if(existing)return {projectExecution:existing,created:false};
  const files=await repositories.attachmentRepository.listByOpportunity(opportunity.id);
  const contract=files.filter(f=>['contract','signed_contract'].includes(f.category)&&!f.retiredAt).sort((a,b)=>Number(b.id)-Number(a.id))[0];
  if(!contract)throw new Error('批准合同前须上传合同文件');
  await repo.lockSignedContract(contract.id,opportunity.id);
  const result=await repo.createForOpportunity({opportunityId:opportunity.id,contractSignedOn:null,confirmedByUserId:actor.id,projectOwnerUserId:null,signedContractAttachmentId:contract.id});
  if(result.created)await repo.appendAuditEvent({projectExecutionId:result.projectExecution.id,eventType:'contract_approved_project_started',actorUserId:actor.id,note:'商务合同批准后自动启动，待总经理制定执行计划；合同附件 #'+contract.id});
  return result;
}
