import {createAttachmentRepository} from './attachmentRepository.mjs';
import {createOpportunityTechnicalDraftRepository} from './opportunityTechnicalDraftRepository.mjs';
import {createWorkflowEventRepository} from './workflowEventRepository.mjs';
import {createTodoRepository} from './todoRepository.mjs';
import {createOpportunityResponsibilityRepository} from './opportunityResponsibilityRepository.mjs';
function mapWorkPackage(row) {
  return {
    id: Number(row.id),
    opportunityId: Number(row.opportunity_id),
    planKind: row.plan_kind,
    sourceWorkPackageId: row.source_work_package_id ? Number(row.source_work_package_id) : null,
    deletedAt: row.deleted_at || null,
    title: row.title,
    assigneeUserId: Number(row.assignee_user_id),
    assigneeDisplayName: row.assignee_display_name || row.assignee_username || '',
    plannedStartDate: row.planned_start_date || null,
    plannedSubmitDate: row.planned_submit_date || null,
    status: row.status,
    createdByUserId: Number(row.created_by_user_id),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    latestVersion: null,
    versionHistory: []
  };
}

function mapVersion(row) {
  return {
    id: Number(row.id),
    workPackageId: Number(row.work_package_id),
    versionNo: Number(row.version_no),
    approvedVersionNo: row.approved_version_no ? Number(row.approved_version_no) : null,
    status: row.status,
    submittedByUserId: Number(row.submitted_by_user_id),
    submittedByDisplayName: row.submitted_by_display_name || row.submitted_by_username || '',
    submittedAt: row.submitted_at,
    reviewedByUserId: row.reviewed_by_user_id ? Number(row.reviewed_by_user_id) : null,
    reviewedByDisplayName: row.reviewed_by_display_name || '',
    reviewedAt: row.reviewed_at || null,
    reviewNote: row.review_note || '',
    files: []
  };
}

export function createOpportunityCollaborationRepository(queryTarget, { inTransaction = false } = {}) {
  return {
    supportsWorkPackages: true,
    async commercialReadiness(opportunityId) {
      const result=await queryTarget.query(`
        SELECT count(*)::int AS technical_count,
          COALESCE(bool_and(COALESCE(
            (SELECT v.status FROM opportunity_collaboration_work_package_versions v WHERE v.work_package_id=t.id ORDER BY v.version_no DESC,v.id DESC LIMIT 1)='accepted'
            AND EXISTS(SELECT 1 FROM opportunity_collaboration_work_packages q
              WHERE q.opportunity_id=t.opportunity_id AND q.source_work_package_id=t.id AND q.plan_kind='internal_quote' AND q.deleted_at IS NULL
              AND (SELECT v.status FROM opportunity_collaboration_work_package_versions v WHERE v.work_package_id=q.id ORDER BY v.version_no DESC,v.id DESC LIMIT 1)='accepted')
          ,false)),false) AS ready
        FROM opportunity_collaboration_work_packages t
        WHERE t.opportunity_id=$1 AND t.plan_kind='technical_solution' AND t.deleted_at IS NULL
      `,[opportunityId]);
      return {technicalCount:Number(result.rows[0]?.technical_count||0),ready:result.rows[0]?.ready===true};
    },
    async snapshotApprovedTechnicalPackages(opportunityId, actorUserId) {
      const result=await queryTarget.query(`
        SELECT t.id AS package_id,v.id AS version_id,v.approved_version_no,v.reviewed_by_user_id,v.reviewed_at,a.id AS attachment_id,a.sha256,a.original_name,a.stored_path,a.mime_type,a.file_size,a.uploaded_by
        FROM opportunity_collaboration_work_packages t
        JOIN LATERAL (SELECT * FROM opportunity_collaboration_work_package_versions WHERE work_package_id=t.id ORDER BY version_no DESC,id DESC LIMIT 1) v ON v.status='accepted'
        JOIN opportunity_collaboration_work_package_files f ON f.work_package_version_id=v.id
        JOIN attachments a ON a.id=f.attachment_id AND a.retired_at IS NULL
        WHERE t.opportunity_id=$1 AND t.plan_kind='technical_solution' AND t.deleted_at IS NULL
        ORDER BY t.id,a.id
      `,[opportunityId]);
      const approvals=result.rows;
      if(!approvals.length)throw Error('Approved technical package files are required');
      const metadata={workPackageApprovalSnapshot:true,approvals};
      const previous=await queryTarget.query(`SELECT id FROM opportunity_technical_drafts WHERE opportunity_id=$1 AND status='approved' AND source_metadata=$2::jsonb`,[opportunityId,JSON.stringify(metadata)]);
      if(previous.rows.length)return Number(previous.rows[0].id);
      const drafts=createOpportunityTechnicalDraftRepository(queryTarget);
      const draft=await drafts.createDraft({opportunityId,templateRevisionId:null,language:'zh',templateCodeSnapshot:'WORK_PACKAGE_APPROVALS',templateNameSnapshot:'已批准技术工作包汇总',templateRevisionNoSnapshot:1,contentSchemaSnapshot:{},variableSchemaSnapshot:[],variableValues:{},selectedClauses:[],renderedContent:{},sourceMetadata:metadata,validationIssues:[],actorUserId,sourceKind:'uploaded_file',deliverableType:'technical_agreement'});
      const ids=[];const hashes=new Set();const names=new Set();
      const attachmentRepo=createAttachmentRepository(queryTarget);
      for(const row of approvals){
        if(hashes.has(row.sha256))continue;
        hashes.add(row.sha256);
        let name=row.original_name;
        if(names.has(name.toLowerCase()))name=row.package_id+'-'+name;
        names.add(name.toLowerCase());
        const copy=await attachmentRepo.createAttachment({opportunityId,category:'technical_solution',originalName:name,storedPath:row.stored_path,mimeType:row.mime_type,fileSize:Number(row.file_size),sha256:row.sha256,uploadedBy:actorUserId});
        ids.push(copy.id);
      }
      await drafts.setUploadedFiles({draftId:draft.id,attachmentIds:ids,actorUserId});
      await queryTarget.query(`UPDATE opportunity_technical_drafts SET status='approved',formal_version_no=(SELECT COALESCE(MAX(formal_version_no),0)+1 FROM opportunity_technical_drafts WHERE opportunity_id=$1),reviewed_by=$3,reviewed_at=now(),review_comment='由工作包批准记录自动汇总，无需重复审批',updated_by=$3 WHERE id=$2`,[opportunityId,draft.id,actorUserId]);
      await queryTarget.query(`INSERT INTO opportunity_technical_draft_events(technical_draft_id,event_type,actor_user_id,details) VALUES($1,'approved',$2,$3::jsonb)`,[draft.id,actorUserId,JSON.stringify(metadata)]);
      return draft.id;
    },
    async advanceCommercialWhenReady(opportunityId, actorUserId) {
      const before=(await queryTarget.query('SELECT id,status,quotation_engineer_id FROM opportunities WHERE id=$1 FOR UPDATE',[opportunityId])).rows[0];
      const readiness=await this.commercialReadiness(opportunityId);
      if(!readiness.technicalCount||!readiness.ready)return false;
      await this.snapshotApprovedTechnicalPackages(opportunityId,actorUserId);
      const result=await queryTarget.query(`UPDATE opportunities SET status='commercial_quote_in_progress',updated_at=now()
        WHERE id=$1 AND archived_at IS NULL AND status IN ('technical_solution_in_progress','technical_solution_pending','technical_solution_rejected') RETURNING id`,[opportunityId]);
      if(result.rows.length){
        await createWorkflowEventRepository(queryTarget).create({opportunityId,eventType:'technical_and_internal_quote_approved',fromStatus:before.status,toStatus:'commercial_quote_in_progress',actorUserId,targetUserId:before.quotation_engineer_id,comment:'技术方案及对应内部报价全部批准，自动开启商务方案'});
        if(before.quotation_engineer_id)await createTodoRepository(queryTarget).create({opportunityId,assigneeUserId:Number(before.quotation_engineer_id),title:'Prepare commercial quote'},actorUserId);
      }
      return result.rows.length>0;
    },

    async listByOpportunity(opportunityId) {
      const [packagesResult, versionsResult, filesResult] = await Promise.all([
        queryTarget.query(`
          SELECT wp.*, assignee.display_name AS assignee_display_name, assignee.username AS assignee_username
          FROM opportunity_collaboration_work_packages wp
          JOIN users assignee ON assignee.id = wp.assignee_user_id
          WHERE wp.opportunity_id = $1 AND (wp.deleted_at IS NULL OR (wp.plan_kind='internal_quote' AND wp.source_work_package_id IS NOT NULL))
          ORDER BY wp.plan_kind, wp.created_at, wp.id
        `, [opportunityId]),
        queryTarget.query(`
          SELECT v.*, submitter.display_name AS submitted_by_display_name, submitter.username AS submitted_by_username,
            reviewer.display_name AS reviewed_by_display_name
          FROM opportunity_collaboration_work_package_versions v
          JOIN opportunity_collaboration_work_packages wp ON wp.id = v.work_package_id
          JOIN users submitter ON submitter.id = v.submitted_by_user_id
          LEFT JOIN users reviewer ON reviewer.id = v.reviewed_by_user_id
          WHERE wp.opportunity_id = $1
          ORDER BY v.work_package_id, v.version_no DESC, v.id DESC
        `, [opportunityId]),
        queryTarget.query(`
          SELECT f.work_package_version_id, a.id AS attachment_id, a.original_name, a.mime_type, a.uploaded_at
          FROM opportunity_collaboration_work_package_files f
          JOIN opportunity_collaboration_work_package_versions v ON v.id = f.work_package_version_id
          JOIN opportunity_collaboration_work_packages wp ON wp.id = v.work_package_id
          JOIN attachments a ON a.id = f.attachment_id
          WHERE wp.opportunity_id = $1 AND a.retired_at IS NULL
          ORDER BY f.work_package_version_id, f.sort_order, f.id
        `, [opportunityId])
      ]);
      const packages = packagesResult.rows.map(mapWorkPackage);
      const packageById = new Map(packages.map((item) => [item.id, item]));
      const versionById = new Map();
      for (const row of versionsResult.rows) {
        const version = mapVersion(row);
        versionById.set(version.id, version);
        const workPackage = packageById.get(version.workPackageId);
        if (!workPackage) continue;
        workPackage.versionHistory.push(version);
        if (!workPackage.latestVersion) workPackage.latestVersion = version;
      }
      for (const row of filesResult.rows) {
        const version = versionById.get(Number(row.work_package_version_id));
        if (!version) continue;
        version.files.push({
          id: Number(row.attachment_id),
          originalName: row.original_name,
          mimeType: row.mime_type,
          uploadedAt: row.uploaded_at
        });
      }
      return packages;
    },

    async ensureInternalQuotePackage(sourceId, opportunityId, actorUserId) {
      const result=await queryTarget.query(`
        WITH created AS (
          INSERT INTO opportunity_collaboration_work_packages(opportunity_id,plan_kind,title,assignee_user_id,planned_start_date,planned_submit_date,created_by_user_id,source_work_package_id)
          SELECT opportunity_id,'internal_quote',title,assignee_user_id,planned_start_date,planned_submit_date,$3,id
          FROM opportunity_collaboration_work_packages WHERE id=$1 AND opportunity_id=$2 AND plan_kind='technical_solution' AND deleted_at IS NULL
          ON CONFLICT(source_work_package_id) WHERE source_work_package_id IS NOT NULL DO UPDATE SET source_work_package_id=EXCLUDED.source_work_package_id
          RETURNING *
        ) SELECT * FROM created`,[sourceId,opportunityId,actorUserId]);
      return result.rows[0]?mapWorkPackage(result.rows[0]):null;
    },

    async createWorkPackage(input) {
      const result = await queryTarget.query(`
        WITH created AS (
          INSERT INTO opportunity_collaboration_work_packages (
            opportunity_id, plan_kind, title, assignee_user_id, planned_start_date, planned_submit_date, created_by_user_id
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7)
          RETURNING *
        ), logged AS (
          INSERT INTO opportunity_collaboration_work_package_events (work_package_id, event_type, actor_user_id)
          SELECT id, 'created', $7 FROM created
        )
        SELECT id FROM created
      `, [
        input.opportunityId,
        input.planKind,
        input.title,
        input.assigneeUserId,
        input.plannedStartDate || null,
        input.plannedSubmitDate || null,
        input.createdByUserId
      ]);
      return result.rows[0] ? { id: Number(result.rows[0].id) } : null;
    },

    async updateWorkPackage(input) {
      const result=await queryTarget.query(`
        WITH before AS (SELECT * FROM opportunity_collaboration_work_packages WHERE id=$1 AND opportunity_id=$2 FOR UPDATE),
        updated AS (UPDATE opportunity_collaboration_work_packages wp SET title=$3,assignee_user_id=$4,planned_start_date=$5,planned_submit_date=$6,updated_at=now()
          FROM before WHERE wp.id=before.id RETURNING wp.*),
        logged AS (INSERT INTO opportunity_collaboration_work_package_events(work_package_id,event_type,actor_user_id,note)
          SELECT updated.id,'updated',$7,json_build_object('before',json_build_object('title',before.title,'assigneeUserId',before.assignee_user_id,'start',before.planned_start_date,'due',before.planned_submit_date),'after',json_build_object('title',updated.title,'assigneeUserId',updated.assignee_user_id,'start',updated.planned_start_date,'due',updated.planned_submit_date))::text FROM updated JOIN before ON before.id=updated.id)
        SELECT * FROM updated
      `,[input.id,input.opportunityId,input.title,input.assigneeUserId,input.plannedStartDate||null,input.plannedSubmitDate||null,input.actorUserId]);
      return result.rows[0]?mapWorkPackage(result.rows[0]):null;
    },

    async findWorkPackageById(id) {
      const result = await queryTarget.query(`
        SELECT * FROM opportunity_collaboration_work_packages WHERE id = $1 AND deleted_at IS NULL LIMIT 1
      `, [id]);
      return result.rows[0] ? mapWorkPackage(result.rows[0]) : null;
    },

    async submitVersion(input) {
      const result = await queryTarget.query(`
        WITH next_version AS (
          SELECT COALESCE(MAX(version_no), 0) + 1 AS version_no
          FROM opportunity_collaboration_work_package_versions
          WHERE work_package_id = $1
        ), created AS (
          INSERT INTO opportunity_collaboration_work_package_versions (work_package_id, version_no, submitted_by_user_id,status,submitted_at)
          SELECT $1, version_no, $2,$4,CASE WHEN $4='submitted' THEN now() ELSE NULL END FROM next_version
          RETURNING id, work_package_id
        ), files AS (
          INSERT INTO opportunity_collaboration_work_package_files (work_package_version_id, attachment_id, sort_order, added_by_user_id)
          SELECT created.id, linked.attachment_id, linked.sort_order, $2
          FROM created
          JOIN unnest($3::bigint[]) WITH ORDINALITY AS linked(attachment_id, sort_order) ON true
        ), updated AS (
          UPDATE opportunity_collaboration_work_packages SET status = CASE WHEN $4='submitted' THEN 'submitted' ELSE 'in_progress' END, updated_at = now()
          WHERE id = $1
        ), logged AS (
          INSERT INTO opportunity_collaboration_work_package_events (work_package_id, work_package_version_id, event_type, actor_user_id)
          SELECT work_package_id, id, $4, $2 FROM created
        )
        SELECT id FROM created
      `, [input.workPackageId, input.submittedByUserId, input.attachmentIds,input.staged?'uploaded':'submitted']);
      return result.rows[0] ? { id: Number(result.rows[0].id) } : null;
    },

    async reviewVersion(input) {
      if(input.status==='returned'&&!String(input.note||'').trim())throw Error('Return reason is required');
      if(!inTransaction && typeof queryTarget.connect==='function'){
        const client=await queryTarget.connect();try{await client.query('BEGIN');const result=await createOpportunityCollaborationRepository(client, { inTransaction: true }).reviewVersion(input);await client.query('COMMIT');return result;}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
      }
      const owner=await queryTarget.query('SELECT opportunity_id FROM opportunity_collaboration_work_packages WHERE id=$1',[input.workPackageId]);
      if(owner.rows[0])await queryTarget.query('SELECT id FROM opportunities WHERE id=$1 FOR UPDATE',[owner.rows[0].opportunity_id]);
      await queryTarget.query('SELECT id FROM opportunity_collaboration_work_packages WHERE id=$1 FOR UPDATE',[input.workPackageId]);
      const result = await queryTarget.query(`
        WITH reviewed AS (
          UPDATE opportunity_collaboration_work_package_versions
          SET status = $3, reviewed_by_user_id = $2, reviewed_at = now(), review_note = $4,
            approved_version_no=CASE WHEN $3='accepted' THEN (SELECT COALESCE(MAX(approved_version_no),0)+1 FROM opportunity_collaboration_work_package_versions WHERE work_package_id=$5) ELSE NULL END
          WHERE id = $1 AND status = 'submitted' AND work_package_id=$5 AND id=(SELECT id FROM opportunity_collaboration_work_package_versions WHERE work_package_id=$5 ORDER BY version_no DESC LIMIT 1)
          RETURNING id, work_package_id
        ), updated AS (
          UPDATE opportunity_collaboration_work_packages wp
          SET status = $3, updated_at = now()
          FROM reviewed
          WHERE wp.id = reviewed.work_package_id
        ), logged AS (
          INSERT INTO opportunity_collaboration_work_package_events (work_package_id, work_package_version_id, event_type, actor_user_id, note)
          SELECT work_package_id, id, $3, $2, $4 FROM reviewed
          RETURNING id,work_package_id
        )
        SELECT reviewed.id,logged.id AS event_id FROM reviewed JOIN logged ON logged.work_package_id=reviewed.work_package_id
      `, [input.versionId, input.reviewedByUserId, input.status, input.note || '',input.workPackageId]);
      if(result.rows[0])await queryTarget.query(`
        INSERT INTO notifications(user_id,event_type,title,body,action_url,source_type,source_id,actor_user_id)
        SELECT assignee_user_id,'collaboration_review',CASE WHEN $2='accepted' THEN '文件已批准' ELSE '文件退回修改' END,
          title||CASE WHEN $2='accepted' THEN '：已批准' ELSE '：'||$3 END,
          '/opportunities/'||opportunity_id||CASE WHEN plan_kind='internal_quote' THEN '#internal-quote' ELSE '#technical-proposal' END,
          'collaboration_review',$4,$5 FROM opportunity_collaboration_work_packages WHERE id=$1
        ON CONFLICT(user_id,source_type,source_id) DO NOTHING
      `,[input.workPackageId,input.status,input.note||'',result.rows[0].event_id,input.reviewedByUserId]);
      if(result.rows[0] && input.status==='accepted' && owner.rows[0])await this.advanceCommercialWhenReady(owner.rows[0].opportunity_id,input.reviewedByUserId);
      return result.rows[0] ? { id: Number(result.rows[0].id) } : null;
    },

    async listTechnicalTeam(opportunityId){return (await queryTarget.query('SELECT * FROM opportunity_technical_team_assignments WHERE opportunity_id=$1 AND is_active=true ORDER BY position,user_id',[opportunityId])).rows;},
    async listTechnicalTeamEvents(opportunityId) {
      const events = (await queryTarget.query('SELECT e.*,u.display_name AS actor_display_name,u.username AS actor_username FROM opportunity_technical_team_events e JOIN users u ON u.id=e.actor_user_id WHERE e.opportunity_id=$1 ORDER BY e.created_at DESC,e.id DESC',[opportunityId])).rows;
      const ids = [...new Set(events.flatMap(event=>[...(event.before_state||[]),...(event.after_state||[])].map(row=>Number(row.userId??row.user_id))).filter(id=>id>0))];
      const people = ids.length ? (await queryTarget.query('SELECT id,display_name,username FROM users WHERE id=ANY($1::bigint[])',[ids])).rows : [];
      const names = new Map(people.map(user=>[Number(user.id),user.display_name||user.username]));
      const snapshot = rows => (rows||[]).map(row=>({userId:Number(row.userId??row.user_id),userDisplayName:row.userDisplayName||names.get(Number(row.userId??row.user_id))||('#'+(row.userId??row.user_id)),position:row.position,specialty:row.specialty||''}));
      return events.map(event=>({id:Number(event.id),actorUserId:Number(event.actor_user_id),actorDisplayName:event.actor_display_name||event.actor_username,createdAt:event.created_at,reason:event.change_reason||'',before:snapshot(event.before_state),after:snapshot(event.after_state)}));
    },
    async saveTechnicalTeam(input){
      if(!inTransaction && typeof queryTarget.connect==='function'){
        const client=await queryTarget.connect();try{await client.query('BEGIN');const result=await createOpportunityCollaborationRepository(client, { inTransaction: true }).saveTechnicalTeam(input);await client.query('COMMIT');return result;}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
      }
      const opportunity=(await queryTarget.query('SELECT * FROM opportunities WHERE id=$1 FOR UPDATE',[input.opportunityId])).rows[0];
      const rows=input.assignments;const leads=rows.filter(row=>row.position==='lead');
      if(!rows.length||leads.length!==1||rows.some(row=>!row.specialty.trim()||row.specialty.length>300)||new Set(rows.map(row=>row.userId)).size!==rows.length)throw Error('Exactly one lead and a specialty for each engineer are required');
      if(!input.canChangeLead&&Number(leads[0].userId)!==Number(opportunity.quotation_engineer_id))throw Error('Only the manager can change the lead engineer');
      const eligible=(await queryTarget.query("SELECT DISTINCT u.id,u.display_name,u.username FROM users u JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id WHERE u.is_active=true AND r.code='quotation_engineer' AND u.id=ANY($1::bigint[])",[rows.map(row=>row.userId)])).rows;
      if(eligible.length!==rows.length)throw Error('Active engineers are required');
      const before=await this.listTechnicalTeam(input.opportunityId),members=createOpportunityResponsibilityRepository(queryTarget);
      const existing=await members.listTeamMembersByOpportunity(input.opportunityId);
      const canonical = assignments => JSON.stringify(assignments.map(row=>({userId:Number(row.userId??row.user_id),position:row.position,specialty:String(row.specialty||'').trim()})).sort((a,b)=>a.userId-b.userId));
      const previous = before.length ? before : [{userId:Number(opportunity.quotation_engineer_id),position:'lead',specialty:''},...existing.filter(m=>m.roleCode==='quotation_engineer'&&m.isActive!==false).map(m=>({userId:Number(m.userId),position:'support',specialty:m.taskDescription||''}))].filter(row=>row.userId>0);
      if (canonical(previous) === canonical(rows)) return {changed:false};
      const reason = String(input.reason||'').trim();
      if (previous.length && !reason) throw Error('Technical team change reason is required');
      if (reason.length>1000) throw Error('Technical team change reason is too long');
      const snapshotIds = [...new Set([...previous,...rows].map(row=>Number(row.userId??row.user_id)))];
      const snapshotUsers = (await queryTarget.query('SELECT id,display_name,username FROM users WHERE id=ANY($1::bigint[])',[snapshotIds])).rows;
      const snapshotNames = new Map(snapshotUsers.map(user=>[Number(user.id),user.display_name||user.username]));
      const snapshot = assignments => assignments.map(row=>({userId:Number(row.userId??row.user_id),userDisplayName:snapshotNames.get(Number(row.userId??row.user_id))||('#'+(row.userId??row.user_id)),position:row.position,specialty:row.specialty||''}));
      for(const member of existing.filter(m=>m.roleCode==='quotation_engineer'&&m.isActive!==false))if(!rows.some(row=>row.userId===Number(member.userId)&&row.position==='support'))await members.removeTeamMember({opportunityId:input.opportunityId,memberId:member.id,removedBy:input.actorUserId});
      await queryTarget.query('UPDATE opportunity_technical_team_assignments SET is_active=false WHERE opportunity_id=$1',[input.opportunityId]);
      for(const row of rows){
        await queryTarget.query('INSERT INTO opportunity_technical_team_assignments(opportunity_id,user_id,position,specialty,updated_by) VALUES($1,$2,$3,$4,$5) ON CONFLICT(opportunity_id,user_id) DO UPDATE SET position=EXCLUDED.position,specialty=EXCLUDED.specialty,is_active=true,updated_by=EXCLUDED.updated_by,updated_at=now()',[input.opportunityId,row.userId,row.position,row.specialty,input.actorUserId]);
        if(row.position==='support'){const prior=existing.find(m=>Number(m.userId)===row.userId&&m.roleCode==='quotation_engineer'&&m.isActive!==false);await members.addTeamMember({opportunityId:input.opportunityId,userId:row.userId,roleCode:'quotation_engineer',permissionLevel:prior?.permissionLevel||'edit',assignmentScope:prior?.assignmentScope||'Technical Proposal',taskDescription:row.specialty,dueDate:prior?.dueDate||null,addedBy:input.actorUserId,canSendExternalEmail:prior?.canSendExternalEmail||false});}
      }

      if (['quotation_engineer_assignment_pending', 'technical_solution_in_progress', 'technical_solution_rejected'].includes(opportunity.status)) {
        const todos = createTodoRepository(queryTarget);
        if (opportunity.status === 'quotation_engineer_assignment_pending') {
          await todos.closePendingForOpportunityAndTitle(input.opportunityId, 'Assign technical work', 'completed', input.actorUserId);
          await queryTarget.query("UPDATE opportunities SET status='technical_solution_in_progress',updated_at=now() WHERE id=$1",[input.opportunityId]);
        }
        const previousIds = new Set([Number(opportunity.quotation_engineer_id), ...existing.filter(m => m.roleCode === 'quotation_engineer' && m.isActive !== false).map(m => Number(m.userId))].filter(id => id > 0));
        const nextIds = new Set(rows.map(row => Number(row.userId)));
        for (const userId of previousIds) {
          if (!nextIds.has(userId)) {
            for (const title of ['Prepare technical solution', 'Revise technical solution']) {
              await todos.closePendingForOpportunityAssigneeAndTitle(input.opportunityId, userId, title, 'reassigned', input.actorUserId);
            }
          }
        }
        const title = opportunity.status === 'technical_solution_rejected' ? 'Revise technical solution' : 'Prepare technical solution';
        const currentTodos = await todos.listByOpportunity(input.opportunityId);
        for (const userId of nextIds) {
          if (!previousIds.has(userId) && !currentTodos.some(todo => todo.assigneeUserId === userId && todo.title === title && todo.status === 'pending')) {
            await todos.create({ opportunityId: input.opportunityId, assigneeUserId: userId, title, actionUrl: '/opportunities/' + input.opportunityId + '#technical-proposal', ...(opportunity.technical_plan_submit_date ? {dueAt: (opportunity.technical_plan_submit_date instanceof Date ? opportunity.technical_plan_submit_date.toISOString().slice(0,10) : String(opportunity.technical_plan_submit_date).slice(0,10)) + 'T23:59:59+08:00'} : {}) }, input.actorUserId);
          }
        }
      }
      await queryTarget.query('UPDATE opportunities SET quotation_engineer_id=$2,updated_at=now() WHERE id=$1',[input.opportunityId,leads[0].userId]);
      await queryTarget.query('INSERT INTO opportunity_technical_team_events(opportunity_id,actor_user_id,before_state,after_state,change_reason) VALUES($1,$2,$3::jsonb,$4::jsonb,$5)',[input.opportunityId,input.actorUserId,JSON.stringify(snapshot(previous)),JSON.stringify(snapshot(rows)),reason]);
    },
    async applyTechnicalLifecycle(input){
      if(!inTransaction && typeof queryTarget.connect==='function'){
        const client=await queryTarget.connect();try{await client.query('BEGIN');const result=await createOpportunityCollaborationRepository(client, { inTransaction: true }).applyTechnicalLifecycle(input);await client.query('COMMIT');return result;}catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
      }
      const wp=(await queryTarget.query("SELECT * FROM opportunity_collaboration_work_packages WHERE id=$1 AND opportunity_id=$2 AND plan_kind IN ('technical_solution','internal_quote') AND deleted_at IS NULL FOR UPDATE",[input.workPackageId,input.opportunityId])).rows[0];
      if(!wp)throw Error('Technical work package not found');
      const versions=(await queryTarget.query('SELECT * FROM opportunity_collaboration_work_package_versions WHERE work_package_id=$1 ORDER BY version_no DESC FOR UPDATE',[wp.id])).rows;
      const version=versions.find(row=>Number(row.id)===Number(input.versionId));
      if(input.action!=='delete_package'&&!version)throw Error('Submission not found');
      if(!input.isManager && Number(version?.submitted_by_user_id)!==Number(input.actorUserId))throw Error('Only the submitter can withdraw or remove this file');
      const targetVersions=input.action==='delete_package'?versions:[version];
      const ids=targetVersions.map(row=>row.id);
      const files=(await queryTarget.query('SELECT a.* FROM attachments a JOIN opportunity_collaboration_work_package_files f ON f.attachment_id=a.id WHERE f.work_package_version_id=ANY($1::bigint[]) FOR UPDATE OF a',[ids])).rows;
      const fileIds=files.map(row=>row.id);
      const refs=(await queryTarget.query(`SELECT 1 WHERE EXISTS(SELECT 1 FROM quotation_package_attachments WHERE attachment_id=ANY($1::bigint[])) OR EXISTS(SELECT 1 FROM sales_commercial_quotation_drafts WHERE source_attachment_id=ANY($1::bigint[])) OR EXISTS(SELECT 1 FROM opportunity_technical_draft_attachments WHERE attachment_id=ANY($1::bigint[])) OR EXISTS(SELECT 1 FROM opportunity_technical_drafts WHERE uploaded_attachment_id=ANY($1::bigint[])) OR EXISTS(SELECT 1 FROM project_executions WHERE signed_contract_attachment_id=ANY($1::bigint[]))`,[fileIds])).rows;
      if(targetVersions.some(row=>row.status==='accepted')||files.some(file=>file.opportunity_material_version_id)||refs.length)throw Error('Locked: confirmed, approved or referenced files must be retained');
      if(input.action==='confirm'){
        if(version.status!=='uploaded'||Number(version.id)!==Number(versions[0]?.id)||!files.some(file=>!file.retired_at))throw Error('Only the latest uploaded file can be submitted');
        await queryTarget.query("UPDATE opportunity_collaboration_work_package_versions SET status='submitted',submitted_at=now() WHERE id=$1",[version.id]);
        await queryTarget.query("UPDATE opportunity_collaboration_work_packages SET status='submitted',updated_at=now() WHERE id=$1",[wp.id]);
      }else if(input.action==='withdraw'){
        if(!['submitted','uploaded'].includes(version.status)||Number(version.id)!==Number(versions[0]?.id))throw Error('Only the latest pending submission can be withdrawn');
        await queryTarget.query("UPDATE opportunity_collaboration_work_package_versions SET status='withdrawn' WHERE id=$1",[version.id]);
        const previous=versions.find(row=>Number(row.id)!==Number(version.id)&&row.status==='accepted');
        await queryTarget.query('UPDATE opportunity_collaboration_work_packages SET status=$2,updated_at=now() WHERE id=$1',[wp.id,previous?'accepted':'in_progress']);
      }else{
        if(targetVersions.some(row=>row.status==='submitted'))throw Error('Withdraw the pending submission before deleting');
        if(input.action==='delete_file'){
          if(!files.some(file=>Number(file.id)===Number(input.attachmentId)))throw Error('File not found');
          await queryTarget.query("UPDATE attachments SET retired_at=now(),retired_by=$2,retirement_reason='Technical submission removed' WHERE id=$1 AND retired_at IS NULL",[input.attachmentId,input.actorUserId]);
        }else{
          await queryTarget.query('UPDATE opportunity_collaboration_work_packages SET deleted_at=now(),deleted_by=$2 WHERE id=$1',[wp.id,input.actorUserId]);
          await queryTarget.query("UPDATE attachments SET retired_at=now(),retired_by=$2,retirement_reason='Technical work package removed' WHERE id=ANY($1::bigint[]) AND retired_at IS NULL",[fileIds,input.actorUserId]);
        }
      }
      await queryTarget.query('INSERT INTO opportunity_collaboration_work_package_events(work_package_id,work_package_version_id,event_type,actor_user_id,note) VALUES($1,$2,$3,$4,$5)',[wp.id,version?.id||null,input.action==='confirm'?'submitted':input.action==='withdraw'?'withdrawn':input.action==='delete_file'?'file_retired':'deleted',input.actorUserId,'Technical-only lifecycle action; physical files and history retained']);
    },

    async isAttachmentLinked(attachmentId) {
      const result = await queryTarget.query(`
        SELECT 1 FROM opportunity_collaboration_work_package_files WHERE attachment_id = $1 LIMIT 1
      `, [attachmentId]);
      return result.rowCount > 0;
    }
  };
}
