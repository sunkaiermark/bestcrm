import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLES } from '../../src/domain/roles.mjs';
import { STATUSES } from '../../src/domain/statuses.mjs';
import {
  advanceProjectReleaseWorkflow,
  confirmProjectExecution,
  loadProjectExecutionConfirmationContext,
  updateProjectWorkPackage
} from '../../src/services/projectExecutionService.mjs';

function setup(overrides = {}) {
  const actor = {
    id: 7,
    roles: [ROLES.SALESPERSON]
  };
  const opportunity = {
    id: 30,
    status: STATUSES.CONTRACT_ARCHIVED,
    salespersonId: 7,
    salesManagerId: 7
  };
  const setting = {
    settingKey: 'project_execution_creation',
    userId: 7,
    roleCode: ROLES.SALES_MANAGER,
    isActive: true
  };
  const calls = [];
  const users = [
    { id: 11, displayName: 'Project Owner', isActive: true, roles: [] },
    { id: 12, displayName: 'Project Engineer', isActive: true, roles: [ROLES.QUOTATION_ENGINEER] },
    { id: 13, displayName: 'Process Engineer', isActive: true, roles: [] },
    { id: 14, displayName: 'Technical Manager', isActive: true, roles: [ROLES.TECHNICAL_MANAGER] },
    { id: 15, displayName: 'Approver', isActive: true, roles: [] },
    { id: 16, displayName: 'Publisher', isActive: true, roles: [] }
  ];
  const repositories = {
    attachmentRepository:{async listByOpportunity(){return [{id:90,category:'signed_contract',sha256:'a'.repeat(64),fileSize:100}];}},
    userRepository: {
      async listUsersWithRoles() { return users; },
      async findByIdWithRoles(id) { return users.find((user) => user.id === Number(id)) || null; }
    },
    opportunityRepository: {
      async getOpportunityDetail() { return overrides.opportunity ?? opportunity; }
    },
    approvalSettingRepository: {
      async findActiveByKey(key) {
        calls.push(['setting', key]);
        return overrides.setting === undefined ? setting : overrides.setting;
      }
    },
    projectExecutionRepository: {
      async findByOpportunity() { return overrides.existing || null; },
      async appendAuditEvent(input) { calls.push(['audit', input]); },
      async createContractKickoffTemplate(input) { calls.push(['kickoff', input]); },
      async createForOpportunity(input) {
        calls.push(['create', input]);
        return {
          created: true,
          projectExecution: { id: 5, ...input }
        };
      }
    }
  };
  return { actor, repositories, calls };
}

const workflowParticipants = {
  projectOwnerUserId: '11',
  projectEngineerUserId: '12',
  processEngineerUserId: '13',
  technicalManagerUserId: '14',
  approverUserId: '15',
  publisherUserId: '16'
};

test('assigned Sales starts execution with signed contract without any creation approval setting', async () => {
  const { actor, repositories, calls } = setup();

  const result = await confirmProjectExecution(
    repositories,
    actor,
    30,
    { contractSignedOn: '2026-09-14', signedContractAttachmentId:90, ...workflowParticipants }
  );

  assert.equal(result.created, true);
  assert.equal(calls.some(([name])=>name==='setting'),false);
  assert.deepEqual(calls[0],['create',{opportunityId:30,contractSignedOn:null,confirmedByUserId:7,projectOwnerUserId:null,signedContractAttachmentId:90}]);
  assert.equal(calls[1][1].eventType,'sales_project_started');
  assert.equal(calls.some(([name])=>name==='kickoff'),false);
});

test('repeated confirmation reopens the existing record and never inserts a duplicate', async () => {
  const existing = { id: 5, opportunityId: 30 };
  const { actor, repositories, calls } = setup({ existing });

  const result = await confirmProjectExecution(repositories, actor, 30, {});

  assert.deepEqual(result, { projectExecution: existing, created: false });
  assert.equal(calls.some(([name]) => name === 'create'), false);
});

test('a different salesperson cannot start this Opportunity even with the old approval setting', async () => {
  const { actor, repositories } = setup({
    setting: { userId: 8, roleCode: ROLES.SALES_MANAGER, isActive: true }
  });

  await assert.rejects(
    () => loadProjectExecutionConfirmationContext(repositories, {...actor,id:8}, 30),
    /Forbidden/
  );
});

test('contract approval states before contract archive cannot create Project Execution', async () => {
  const { actor, repositories } = setup({
    opportunity: { id: 30, salespersonId:7, status: STATUSES.CONTRACT_APPROVAL_IN_PROGRESS }
  });

  await assert.rejects(
    () => confirmProjectExecution(repositories, actor, 30, { contractSignedOn: '2026-09-14', ...workflowParticipants }),
    /only be created after contract approval/
  );
});

test('workflow advances only by its designated participant and records the versioned audit fact', async () => {
  const calls = [];
  const project = { id: 5, confirmedByUserId: 7, projectOwnerUserId: 11, opportunityId: 30 };
  const workflow = {
    id: 40,
    status: 'technical_solution_pending',
    projectEngineerUserId: 12,
    processEngineerUserId: 13,
    technicalManagerUserId: 14,
    approverUserId: 15,
    publisherUserId: 16
  };
  const repositories = {
    projectExecutionRepository: {
      async findById() { return project; },
      async findReleaseWorkflow() { return workflow; },
      async advanceReleaseWorkflow(id, input) { calls.push(['advance', id, input]); return { ...workflow, status: input.status }; },
      async appendAuditEvent(input) { calls.push(['audit', input]); }
    }
  };

  const result = await advanceProjectReleaseWorkflow(repositories, { id: 12, roles: [] }, 5, {
    action: 'submit_technical_solution', version: 'TS-1.0', note: '方案完成'
  });

  assert.equal(result.status, 'manufacturing_process_pending');
  assert.deepEqual(calls, [
    ['advance', 40, { status: 'manufacturing_process_pending', technicalSolutionVersion: 'TS-1.0', manufacturingProcessVersion: '' }],
    ['audit', {
      projectExecutionId: 5, releaseWorkflowId: 40, eventType: 'technical_solution_submitted',
      fromStatus: 'technical_solution_pending', toStatus: 'manufacturing_process_pending',
      actorUserId: 12, note: '方案完成'
    }]
  ]);
});

test('work package cannot be marked blocked without a blocker reason', async () => {
  const project = { id: 5, confirmedByUserId: 7, projectOwnerUserId: 11, opportunityId: 30 };
  const repositories = {
    projectExecutionRepository: {
      async findById() { return project; },
      async listMilestones() { return []; },
      async listWorkPackages() { return [{ id: 51, responsibleUserId: 12, status: 'in_progress' }]; }
    },
    userRepository: { async listUsersWithRoles() { return []; } }
  };

  await assert.rejects(
    () => updateProjectWorkPackage(repositories, { id: 12, roles: [] }, 5, 51, { status: 'blocked', blockerNote: '' }),
    /blocker reason is required/
  );
});

test('signed contract selection is required and an ordinary contract cannot be substituted',async()=>{
 const {actor,repositories}=setup();
 await assert.rejects(()=>confirmProjectExecution(repositories,actor,30,{contractSignedOn:'2026-09-14',projectOwnerUserId:11,signedContractAttachmentId:999}),/signed contract attachment is required/);
});
test('Sales cannot assign an execution owner or fabricate the signing date',async()=>{
 const {actor,repositories,calls}=setup();
 await confirmProjectExecution(repositories,actor,30,{contractSignedOn:'2099-01-01',projectOwnerUserId:999,signedContractAttachmentId:90});
 assert.equal(calls[0][1].contractSignedOn,null);
 assert.equal(calls[0][1].projectOwnerUserId,null);
});
