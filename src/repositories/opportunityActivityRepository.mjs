function numberOrNull(value) {
  return value === null || value === undefined ? null : Number(value);
}

function mapActivityRow(row) {
  return {
    id: row.id,
    opportunityId: Number(row.opportunity_id),
    type: {
      code: row.type_code,
      labelEn: row.label_en,
      labelZh: row.label_zh,
      category: row.category
    },
    status: row.status,
    direction: row.direction,
    occurredAt: row.occurred_at,
    recordedAt: row.recorded_at,
    actorUserId: numberOrNull(row.actor_user_id),
    ownerUserId: numberOrNull(row.owner_user_id),
    subject: row.subject,
    summary: row.summary,
    visibility: row.visibility,
    sourceSystem: row.source_system,
    sourceExternalKey: row.source_external_key,
    correlationId: row.correlation_id,
    parentActivityId: row.parent_activity_id,
    supersedesActivityId: row.supersedes_activity_id,
    snapshotSchemaVersion: Number(row.snapshot_schema_version),
    snapshot: row.snapshot || {},
    participants: row.participants || [],
    source: row.source || {}
  };
}

function visibleOpportunityPredicate(userParam) {
  return `(
    opportunity.salesperson_id = ${userParam}
    OR opportunity.sales_manager_id = ${userParam}
    OR opportunity.quotation_engineer_id = ${userParam}
    OR opportunity.technical_manager_id = ${userParam}
    OR opportunity.commercial_manager_id = ${userParam}
    OR EXISTS (
      SELECT 1 FROM opportunity_members member
      WHERE member.opportunity_id = opportunity.id
        AND member.user_id = ${userParam}
        AND member.is_active = true
    )
    OR EXISTS (
      SELECT 1
      FROM contract_approvals approval
      JOIN contract_approval_steps step ON step.contract_approval_id = approval.id
      WHERE approval.opportunity_id = opportunity.id
        AND step.reviewer_user_id = ${userParam}
    )
  )`;
}

export function createOpportunityActivityRepository(queryTarget) {
  return {
    async listByOpportunity(opportunityId, { visibleToUserId = null, limit = 100, before = null } = {}) {
      const params = [opportunityId];
      const where = ['activity.opportunity_id = $1'];
      if (visibleToUserId) {
        params.push(visibleToUserId);
        where.push(visibleOpportunityPredicate(`$${params.length}`));
      }
      if (before?.occurredAt && before?.id) {
        params.push(before.occurredAt, before.id);
        where.push(`(activity.occurred_at, activity.id) < ($${params.length - 1}, $${params.length})`);
      }
      const safeLimit = Math.min(250, Math.max(1, Number(limit) || 100));
      params.push(safeLimit);
      const result = await queryTarget.query(`
        SELECT
          activity.*,
          activity_type.label_en,
          activity_type.label_zh,
          activity_type.category,
          COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
              'role', participant.participant_role,
              'key', participant.participant_key,
              'userId', participant.user_id,
              'contactId', participant.contact_id,
              'emailAddress', participant.email_address
            ) ORDER BY participant.id)
            FROM opportunity_activity_participants participant
            WHERE participant.activity_id = activity.id
          ), '[]'::jsonb) AS participants,
          COALESCE((
            SELECT jsonb_strip_nulls(jsonb_build_object(
              'linkRole', link.link_role,
              'emailMessageId', link.email_message_id,
              'workflowEventId', link.workflow_event_id,
              'salesWorkPlanId', link.sales_work_plan_id,
              'salesWorkLogId', link.sales_work_log_id,
              'attachmentId', link.attachment_id,
              'technicalSolutionId', link.technical_solution_id,
              'commercialQuoteId', link.commercial_quote_id,
              'quotationPackageVersionId', link.quotation_package_version_id,
              'contractApprovalId', link.contract_approval_id,
              'opportunityOwnerTransferId', link.opportunity_owner_transfer_id,
              'opportunityMemberEventId', link.opportunity_member_event_id,
              'engineeringContributionId', link.engineering_contribution_id
            ))
            FROM opportunity_activity_links link
            WHERE link.activity_id = activity.id AND link.link_role = 'primary'
          ), '{}'::jsonb) AS source
        FROM opportunity_activities activity
        JOIN activity_types activity_type ON activity_type.code = activity.type_code
        JOIN opportunities opportunity ON opportunity.id = activity.opportunity_id
        WHERE ${where.join(' AND ')}
        ORDER BY activity.occurred_at DESC, activity.id DESC
        LIMIT $${params.length}
      `, params);
      return result.rows.map(mapActivityRow);
    }
  };
}
