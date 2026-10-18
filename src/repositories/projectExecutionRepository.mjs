function numberOrNull(value) {
  return value === null || value === undefined ? null : Number(value);
}

function mapProjectExecutionRow(row) {
  if (!row) {
    return null;
  }
  return {
    id: Number(row.id),
    opportunityId: Number(row.opportunity_id),
    // Project Execution deliberately has no independent serial number: its external
    // execution number is always the originating winning Opportunity number.
    projectExecutionNo: row.opportunity_no || '',
    opportunityNo: row.opportunity_no || '',
    opportunityTitle: row.opportunity_title || '',
    customerName: row.customer_name || '',
    contractSignedOn: row.contract_signed_on,
    status: row.status,
    projectOwnerUserId: numberOrNull(row.project_owner_user_id),
    projectOwnerDisplayName: row.project_owner_display_name || '',
    plannedStartOn: row.planned_start_on || null,
    plannedCompletionOn: row.planned_completion_on || null,
    actualDeliveryOn: row.actual_delivery_on || null,
    actualAcceptanceOn: row.actual_acceptance_on || null,
    riskSummary: row.risk_summary || '',
    confirmedByUserId: Number(row.confirmed_by_user_id),
    confirmedByDisplayName: row.confirmed_by_display_name || '',
    salespersonId: numberOrNull(row.salesperson_id),
    salesManagerId: numberOrNull(row.sales_manager_id),
    quotationEngineerId: numberOrNull(row.quotation_engineer_id),
    technicalManagerId: numberOrNull(row.technical_manager_id),
    commercialManagerId: numberOrNull(row.commercial_manager_id),
    teamMembers: Array.isArray(row.team_members) ? row.team_members.map((member) => ({
      userId: Number(member.userId ?? member.user_id),
      isActive: member.isActive ?? member.is_active
    })) : [],
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function mapMilestone(row) {
  if (!row) return null;
  return {
    id: Number(row.id), title: row.title, milestoneType: row.milestone_type,
    plannedOn: row.planned_on, actualOn: row.actual_on || null, status: row.status,
    responsibleUserId: numberOrNull(row.responsible_user_id),
    responsibleDisplayName: row.responsible_display_name || '', note: row.note || ''
  };
}

function mapWorkPackage(row) {
  if (!row) return null;
  return {
    id: Number(row.id), projectExecutionId: Number(row.project_execution_id), title: row.title, instruction: row.instruction || '',
    responsibleUserId: Number(row.responsible_user_id),
    responsibleDisplayName: row.responsible_display_name || '',
    plannedStartOn: row.planned_start_on || null, dueOn: row.due_on || null,
    completedOn: row.completed_on || null, status: row.status,
    blockerNote: row.blocker_note || '', acceptanceNote: row.acceptance_note || '',
    acceptedByUserId: numberOrNull(row.accepted_by_user_id), acceptedAt: row.accepted_at || null
  };
}

function mapReleaseWorkflow(row) {
  if (!row) return null;
  return {
    id: Number(row.id), projectExecutionId: Number(row.project_execution_id), status: row.status,
    projectEngineerUserId: Number(row.project_engineer_user_id), projectEngineerDisplayName: row.project_engineer_display_name || '',
    processEngineerUserId: Number(row.process_engineer_user_id), processEngineerDisplayName: row.process_engineer_display_name || '',
    technicalManagerUserId: Number(row.technical_manager_user_id), technicalManagerDisplayName: row.technical_manager_display_name || '',
    approverUserId: Number(row.approver_user_id), approverDisplayName: row.approver_display_name || '',
    publisherUserId: Number(row.publisher_user_id), publisherDisplayName: row.publisher_display_name || '',
    technicalSolutionVersion: row.technical_solution_version || '',
    manufacturingProcessVersion: row.manufacturing_process_version || '',
    createdAt: row.created_at, updatedAt: row.updated_at
  };
}

function mapAuditEvent(row) {
  if (!row) return null;
  return {
    id: Number(row.id), projectExecutionId: Number(row.project_execution_id),
    workPackageId: numberOrNull(row.work_package_id), releaseWorkflowId: numberOrNull(row.release_workflow_id),
    eventType: row.event_type, fromStatus: row.from_status || '', toStatus: row.to_status || '',
    actorUserId: Number(row.actor_user_id), actorDisplayName: row.actor_display_name || '',
    note: row.note || '', createdAt: row.created_at
  };
}

const projectExecutionSelect = `
  SELECT
    pe.*,
    o.opportunity_no,
    o.title AS opportunity_title,
    o.salesperson_id,
    o.sales_manager_id,
    o.quotation_engineer_id,
    o.technical_manager_id,
    o.commercial_manager_id,
    COALESCE((
      SELECT json_agg(json_build_object('userId', om.user_id, 'isActive', om.is_active))
      FROM opportunity_members om
      WHERE om.opportunity_id = o.id
    ), '[]'::json) AS team_members,
    c.name AS customer_name,
    confirmer.display_name AS confirmed_by_display_name,
    owner.display_name AS project_owner_display_name
  FROM project_executions pe
  JOIN opportunities o ON o.id = pe.opportunity_id
  JOIN customers c ON c.id = o.customer_id
  JOIN users confirmer ON confirmer.id = pe.confirmed_by_user_id
  LEFT JOIN users owner ON owner.id = pe.project_owner_user_id
`;

export function createProjectExecutionRepository(queryTarget) {
  async function findByOpportunity(opportunityId) {
    const result = await queryTarget.query(`
      ${projectExecutionSelect}
      WHERE pe.opportunity_id = $1
      LIMIT 1
    `, [Number(opportunityId)]);
    return mapProjectExecutionRow(result.rows[0]);
  }

  return {
    async findById(id) {
      const result = await queryTarget.query(`
        ${projectExecutionSelect}
        WHERE pe.id = $1
        LIMIT 1
      `, [Number(id)]);
      return mapProjectExecutionRow(result.rows[0]);
    },

    async listAll() {
      const result = await queryTarget.query(`
        ${projectExecutionSelect}
        ORDER BY pe.updated_at DESC, pe.id DESC
      `);
      return result.rows.map(mapProjectExecutionRow);
    },

    findByOpportunity,

    async createForOpportunity(input) {
      const inserted = await queryTarget.query(`
        INSERT INTO project_executions (
          opportunity_id,
          contract_signed_on,
          confirmed_by_user_id,
          project_owner_user_id
        )
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (opportunity_id) DO NOTHING
        RETURNING id
      `, [
        Number(input.opportunityId),
        input.contractSignedOn,
        Number(input.confirmedByUserId),
        input.projectOwnerUserId ? Number(input.projectOwnerUserId) : null
      ]);

      const projectExecution = await findByOpportunity(input.opportunityId);
      return {
        projectExecution,
        created: inserted.rowCount > 0
      };
    },

    async updateProject(id, input) {
      await queryTarget.query(`
        UPDATE project_executions
        SET project_owner_user_id = $2, planned_start_on = $3, planned_completion_on = $4,
            actual_delivery_on = $5, actual_acceptance_on = $6, risk_summary = $7,
            status = $8, updated_at = now()
        WHERE id = $1
      `, [id, input.projectOwnerUserId, input.plannedStartOn, input.plannedCompletionOn,
        input.actualDeliveryOn, input.actualAcceptanceOn, input.riskSummary, input.status]);
      return this.findById(id);
    },

    async listMilestones(projectExecutionId) {
      const result = await queryTarget.query(`
        SELECT m.*, u.display_name AS responsible_display_name
        FROM project_execution_milestones m
        LEFT JOIN users u ON u.id = m.responsible_user_id
        WHERE m.project_execution_id = $1
        ORDER BY m.planned_on, m.sort_order, m.id
      `, [projectExecutionId]);
      return result.rows.map(mapMilestone);
    },

    async createMilestone(input) {
      const result = await queryTarget.query(`
        INSERT INTO project_execution_milestones (
          project_execution_id, title, milestone_type, planned_on, actual_on, status,
          responsible_user_id, note, created_by_user_id
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id
      `, [input.projectExecutionId, input.title, input.milestoneType, input.plannedOn,
        input.actualOn, input.status, input.responsibleUserId, input.note, input.actorUserId]);
      return Number(result.rows[0].id);
    },

    async createContractKickoffTemplate(input) {
      await queryTarget.query(`
        INSERT INTO project_execution_milestones (
          project_execution_id, title, milestone_type, planned_on, status,
          responsible_user_id, note, sort_order, created_by_user_id
        ) VALUES
          ($1, '合同执行首次会议', 'other', $2, 'not_started', $3, $4, 10, $5),
          ($1, '首次技术评估', 'design_release', $2, 'not_started', $6, '技术部明确图纸/技术文件输入与技术路线。', 20, $5),
          ($1, '图纸/技术文件提交评审', 'design_release', $2, 'not_started', $6, '技术负责人提交图纸/技术文件评审资料。', 30, $5),
          ($1, '图纸/技术文件批准发布', 'design_release', $2, 'not_started', $7, '技术经理批准发布图纸/技术文件；提交人不得自行批准。', 40, $5)
      `, [
        input.projectExecutionId,
        input.referenceDate,
        input.projectOwnerUserId,
        input.kickoffParticipantNote,
        input.actorUserId,
        input.technicalResponsibleUserId,
        input.technicalApproverUserId
      ]);

      const packages = await queryTarget.query(`
        INSERT INTO project_execution_work_packages (
          project_execution_id, title, instruction, responsible_user_id, status, blocker_note, created_by_user_id
        ) VALUES
          ($1, '技术方案', '项目工程师提交技术方案，进入受控评审流程。', $2, 'not_started', '', $6),
          ($1, '制造工艺方案', '制造工艺工程师提交制造工艺方案。', $3, 'not_started', '', $6),
          ($1, '技术经理评审', '技术经理评审技术方案与制造工艺方案。', $4, 'not_started', '', $6),
          ($1, '批准发布', '批准后由发布责任人发布到项目执行。', $5, 'not_started', '', $6)
        RETURNING id, title
      `, [
        input.projectExecutionId,
        input.projectEngineerUserId,
        input.processEngineerUserId,
        input.technicalManagerUserId,
        input.publisherUserId,
        input.actorUserId
      ]);

      const workflow = await queryTarget.query(`
        INSERT INTO project_execution_release_workflows (
          project_execution_id, project_engineer_user_id, process_engineer_user_id,
          technical_manager_user_id, approver_user_id, publisher_user_id, created_by_user_id
        ) VALUES ($1,$2,$3,$4,$5,$6,$7)
        RETURNING id
      `, [
        input.projectExecutionId,
        input.projectEngineerUserId,
        input.processEngineerUserId,
        input.technicalManagerUserId,
        input.approverUserId,
        input.publisherUserId,
        input.actorUserId
      ]);
      const workflowId = Number(workflow.rows[0]?.id);

      await queryTarget.query(`
        INSERT INTO project_execution_audit_events (
          project_execution_id, release_workflow_id, event_type, actor_user_id, note
        ) VALUES ($1,$2,'workflow_configured',$3,$4)
      `, [input.projectExecutionId, workflowId, input.actorUserId, '已配置项目工程师、制造工艺工程师、技术经理、批准人和发布责任人。']);

      for (const item of packages.rows) {
        await queryTarget.query(`
          INSERT INTO project_execution_audit_events (
            project_execution_id, work_package_id, event_type, actor_user_id, note
          ) VALUES ($1,$2,'work_package_created',$3,$4)
        `, [input.projectExecutionId, Number(item.id), input.actorUserId, `已创建标准工作包：${item.title}`]);
      }
    },

    async updateMilestone(id, input) {
      await queryTarget.query(`
        UPDATE project_execution_milestones
        SET planned_on = $3, actual_on = $4, status = $5, responsible_user_id = $6,
            note = $7, updated_at = now()
        WHERE id = $1 AND project_execution_id = $2
      `, [id, input.projectExecutionId, input.plannedOn, input.actualOn, input.status, input.responsibleUserId, input.note]);
    },

    async listWorkPackages(projectExecutionId) {
      const result = await queryTarget.query(`
        SELECT w.*, u.display_name AS responsible_display_name
        FROM project_execution_work_packages w
        JOIN users u ON u.id = w.responsible_user_id
        WHERE w.project_execution_id = $1
        ORDER BY w.due_on NULLS LAST, w.id
      `, [projectExecutionId]);
      return result.rows.map(mapWorkPackage);
    },

    async createWorkPackage(input) {
      const result = await queryTarget.query(`
        INSERT INTO project_execution_work_packages (
          project_execution_id, title, instruction, responsible_user_id, planned_start_on,
          due_on, status, blocker_note, created_by_user_id
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id
      `, [input.projectExecutionId, input.title, input.instruction, input.responsibleUserId,
        input.plannedStartOn, input.dueOn, input.status, input.blockerNote, input.actorUserId]);
      return Number(result.rows[0].id);
    },

    async updateWorkPackage(id, input) {
      await queryTarget.query(`
        UPDATE project_execution_work_packages
        SET responsible_user_id = $2, planned_start_on = $3, due_on = $4, status = $5,
            blocker_note = $6, acceptance_note = $7, completed_on = $8,
            accepted_by_user_id = $9, accepted_at = $10, updated_at = now()
        WHERE id = $1
      `, [id, input.responsibleUserId, input.plannedStartOn, input.dueOn, input.status,
        input.blockerNote, input.acceptanceNote, input.completedOn,
        input.acceptedByUserId, input.acceptedAt]);
    },

    async findWorkPackage(id) {
      const result = await queryTarget.query(`
        SELECT w.*, u.display_name AS responsible_display_name
        FROM project_execution_work_packages w JOIN users u ON u.id = w.responsible_user_id
        WHERE w.id = $1 LIMIT 1
      `, [id]);
      return mapWorkPackage(result.rows[0]);
    },

    async findReleaseWorkflow(projectExecutionId) {
      const result = await queryTarget.query(`
        SELECT w.*,
          project_engineer.display_name AS project_engineer_display_name,
          process_engineer.display_name AS process_engineer_display_name,
          technical_manager.display_name AS technical_manager_display_name,
          approver.display_name AS approver_display_name,
          publisher.display_name AS publisher_display_name
        FROM project_execution_release_workflows w
        JOIN users project_engineer ON project_engineer.id = w.project_engineer_user_id
        JOIN users process_engineer ON process_engineer.id = w.process_engineer_user_id
        JOIN users technical_manager ON technical_manager.id = w.technical_manager_user_id
        JOIN users approver ON approver.id = w.approver_user_id
        JOIN users publisher ON publisher.id = w.publisher_user_id
        WHERE w.project_execution_id = $1
        LIMIT 1
      `, [projectExecutionId]);
      return mapReleaseWorkflow(result.rows[0]);
    },

    async advanceReleaseWorkflow(id, input) {
      const result = await queryTarget.query(`
        UPDATE project_execution_release_workflows
        SET status = $2,
            technical_solution_version = COALESCE(NULLIF($3, ''), technical_solution_version),
            manufacturing_process_version = COALESCE(NULLIF($4, ''), manufacturing_process_version),
            updated_at = now()
        WHERE id = $1
        RETURNING *
      `, [id, input.status, input.technicalSolutionVersion || '', input.manufacturingProcessVersion || '']);
      return mapReleaseWorkflow(result.rows[0]);
    },

    async appendAuditEvent(input) {
      const result = await queryTarget.query(`
        INSERT INTO project_execution_audit_events (
          project_execution_id, work_package_id, release_workflow_id,
          event_type, from_status, to_status, actor_user_id, note
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        RETURNING *
      `, [
        input.projectExecutionId, input.workPackageId || null, input.releaseWorkflowId || null,
        input.eventType, input.fromStatus || null, input.toStatus || null,
        input.actorUserId, input.note || ''
      ]);
      return mapAuditEvent(result.rows[0]);
    },

    async listAuditEvents(projectExecutionId) {
      const result = await queryTarget.query(`
        SELECT e.*, actor.display_name AS actor_display_name
        FROM project_execution_audit_events e
        JOIN users actor ON actor.id = e.actor_user_id
        WHERE e.project_execution_id = $1
        ORDER BY e.created_at DESC, e.id DESC
      `, [projectExecutionId]);
      return result.rows.map(mapAuditEvent);
    }
  };
}
