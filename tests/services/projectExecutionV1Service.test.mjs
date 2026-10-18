import test from 'node:test';
import assert from 'node:assert/strict';
import { ROLES } from '../../src/domain/roles.mjs';
import {
  updateProjectExecution,
  updateProjectWorkPackage
} from '../../src/services/projectExecutionService.mjs';

const project = {
  id: 5, opportunityId: 30, projectOwnerUserId: 7, confirmedByUserId: 7,
  salespersonId: 2, status: 'planning'
};

test('General Manager updates delivery status without changing the originating opportunity', async () => {
  let saved = null;
  const repositories = {
    projectExecutionRepository: {
      async findById() { return project; },
      async updateProject(_id, input) { saved = input; return { ...project, ...input }; }
    }
  };
  await updateProjectExecution(repositories, { id: 7, roles: [ROLES.GENERAL_MANAGER] }, 5, {
    projectOwnerUserId: '7', status: 'in_progress', plannedStartOn: '2026-10-20',
    plannedCompletionOn: '2026-11-20', actualDeliveryOn: '', actualAcceptanceOn: '',
    riskSummary: 'Supplier date to confirm'
  });
  assert.equal(saved.status, 'in_progress');
  assert.equal(saved.plannedCompletionOn, '2026-11-20');
  assert.equal(saved.riskSummary, 'Supplier date to confirm');
});

test('a work-package owner may submit but cannot self-accept the package', async () => {
  let updates = 0;
  const repositories = {
    projectExecutionRepository: {
      async findById() { return project; },
      async listMilestones() { return []; },
      async listWorkPackages() { return [{ id: 9, responsibleUserId: 11, status: 'in_progress' }]; },
      async updateWorkPackage() { updates += 1; }
    },
    userRepository: { async listUsersWithRoles() { return []; } }
  };
  await updateProjectWorkPackage(repositories, { id: 11, roles: [ROLES.QUOTATION_ENGINEER] }, 5, 9, {
    status: 'pending_acceptance', blockerNote: '', acceptanceNote: 'Submitted'
  });
  assert.equal(updates, 1);
  await assert.rejects(
    () => updateProjectWorkPackage(repositories, { id: 11, roles: [ROLES.QUOTATION_ENGINEER] }, 5, 9, {
      status: 'completed', blockerNote: '', acceptanceNote: 'Self accept'
    }),
    /Forbidden/
  );
});
