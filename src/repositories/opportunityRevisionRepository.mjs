import {hasRole,ROLES} from '../domain/roles.mjs';
import {createTodoRepository} from './todoRepository.mjs';
import {createAttachmentRepository} from './attachmentRepository.mjs';

export function canStartOpportunityRevision(user,opportunity){
 return user?.isActive!==false&&!opportunity.archivedAt&&!opportunity.archived_at
  &&['technical_solution_in_progress','technical_solution_rejected','commercial_quote_in_progress','commercial_quote_rejected','customer_negotiation','won_contract_pending','contract_rejected'].includes(opportunity.status)
  &&(hasRole(user,ROLES.ADMINISTRATOR)
   ||(hasRole(user,ROLES.SALESPERSON)&&Number(user.id)===Number(opportunity.salespersonId??opportunity.salesperson_id))
   ||(hasRole(user,ROLES.QUOTATION_ENGINEER)&&Number(user.id)===Number(opportunity.quotationEngineerId??opportunity.quotation_engineer_id))
   ||(hasRole(user,ROLES.TECHNICAL_MANAGER)&&Number(user.id)===Number(opportunity.technicalManagerId??opportunity.technical_manager_id)));
}
export function canAcceptOpportunityQuotation(user,opportunity){
 return user?.isActive!==false&&!opportunity.archivedAt&&!opportunity.archived_at
  &&['customer_negotiation','won_contract_pending','contract_rejected'].includes(opportunity.status)
  &&(hasRole(user,ROLES.ADMINISTRATOR)||(hasRole(user,ROLES.SALESPERSON)&&Number(user.id)===Number(opportunity.salespersonId??opportunity.salesperson_id)));
}
const fail=(message,statusCode=409)=>{throw Object.assign(Error(message),{statusCode});};
const validId=value=>Number.isSafeInteger(Number(value))&&Number(value)>0?Number(value):null;
async function currentRound(client,opportunityId){return(await client.query('SELECT * FROM opportunity_revision_rounds WHERE opportunity_id=$1 AND closed_at IS NULL FOR UPDATE',[opportunityId])).rows[0];}
async function hasSubmittedQuote(client,roundId){return(await client.query("SELECT id FROM sales_commercial_quotation_versions WHERE revision_round_id=$1 AND status IN ('pending','approved','signed') UNION ALL SELECT id FROM commercial_quotes WHERE revision_round_id=$1 AND status IN ('pending','approved') LIMIT 1",[roundId])).rows.length>0;}
async function initialRound(client,op,actor,basis){
 return(await client.query("INSERT INTO opportunity_revision_rounds(opportunity_id,round_no,revision_kind,feedback,baseline,created_by) VALUES($1,1,'initial',$2,COALESCE($3::jsonb,bestcrm_quotation_basis($1)),$4) RETURNING *",[op.id,String(op.requirement||'初始需求').slice(0,4000),basis?JSON.stringify(basis):null,actor.id])).rows[0];
}
export function createOpportunityRevisionRepository(queryTarget,{inTransaction=false}={}){
 const transaction=async callback=>{
  if(inTransaction)return callback(queryTarget);
  if(typeof queryTarget.connect!=='function')throw Error('Revision action requires a database transaction');
  const client=await queryTarget.connect();
  try{await client.query('BEGIN');const result=await callback(client);await client.query('COMMIT');return result;}
  catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
 };
 return{
  async load(opportunityId){
   const rounds=(await queryTarget.query('SELECT r.*,u.display_name AS creator_name FROM opportunity_revision_rounds r JOIN users u ON u.id=r.created_by WHERE opportunity_id=$1 ORDER BY round_no DESC',[opportunityId])).rows;
   const quotes=(await queryTarget.query(`SELECT 'formal' AS kind,id,version_no,quotation_no AS label,status,revision_round_id,approval_basis,submitted_at,snapshot AS quote_content FROM sales_commercial_quotation_versions WHERE opportunity_id=$1
    UNION ALL SELECT 'legacy',id,version_no,'商务方案 V'||version_no,status,revision_round_id,approval_basis,submitted_at,jsonb_build_object('totalPrice',total_price,'paymentTerms',payment_terms,'validityDate',validity_date,'remarks',remarks,'reviewComment',review_comment) AS quote_content FROM commercial_quotes WHERE opportunity_id=$1 ORDER BY submitted_at DESC`,[opportunityId])).rows;
   const contracts=(await queryTarget.query('SELECT id,version_no,status,revision_round_id,final_quote_kind,final_quote_id,final_quote_snapshot FROM contract_approvals WHERE opportunity_id=$1 ORDER BY version_no DESC',[opportunityId])).rows;
   const basis=(await queryTarget.query('SELECT bestcrm_quotation_basis($1) AS basis,bestcrm_revision_basis_ready($1,bestcrm_quotation_basis($1)) AS ready',[opportunityId])).rows[0];
   const linkedAttachments=(await queryTarget.query('SELECT l.revision_round_id,a.id,a.category,a.original_name,a.uploaded_at,a.retired_at FROM opportunity_revision_attachment_links l JOIN attachments a ON a.id=l.attachment_id WHERE a.opportunity_id=$1 ORDER BY a.uploaded_at,a.id',[opportunityId])).rows;
   const requirementTexts=(await queryTarget.query('SELECT id,revision_round_id,requirement_text,reason,created_at FROM requirement_updates WHERE opportunity_id=$1 ORDER BY created_at,id',[opportunityId])).rows;
   return{rounds,quotes,contracts,linkedAttachments,requirementTexts,...basis};
  },
  async appendInitialRequirement(actor,opportunityId,input){return transaction(async client=>{
   const op=(await client.query('SELECT * FROM opportunities WHERE id=$1 AND deleted_at IS NULL FOR UPDATE',[opportunityId])).rows[0];
   if(!op||op.archived_at||!['draft','initiation_rejected'].includes(op.status))fail('初始需求已进入后续流程，请新增修改需求。');
   if(actor?.isActive===false||!(hasRole(actor,ROLES.ADMINISTRATOR)||Number(actor.id)===Number(op.salesperson_id)))fail('不能修改此客户需求。',403);
   const text=String(input.requirementText||'').trim();if(!text||text.length>4000)fail('需求文字不能为空且不能超过4000字。',400);
   let round=await currentRound(client,opportunityId);
   if(round&&round.revision_kind!=='initial')fail('当前不是初始需求，请刷新页面。');
   if(round&&(round.accepted_quote_id||await hasSubmittedQuote(client,round.id)))fail('本轮需求已用于正式报价，不能修改原始依据。');
   if(!round)round=await initialRound(client,op,actor);
   return(await client.query('INSERT INTO requirement_updates(opportunity_id,requirement_text,reason,created_by,revision_round_id) VALUES($1,$2,$3,$4,$5) RETURNING *',[opportunityId,text,input.reason||'初始需求补充',actor.id,round.id])).rows[0];
  });},
  async createRevisionAttachment(actor,opportunityId,expectedRoundId,attachment){return transaction(async client=>{
   const op=(await client.query('SELECT * FROM opportunities WHERE id=$1 AND deleted_at IS NULL FOR UPDATE',[opportunityId])).rows[0];
   if(!op||op.archived_at)fail('商机不存在或已归档。');
   const admin=hasRole(actor,ROLES.ADMINISTRATOR),sales=hasRole(actor,ROLES.SALESPERSON)&&Number(actor.id)===Number(op.salesperson_id),engineer=hasRole(actor,ROLES.QUOTATION_ENGINEER)&&Number(actor.id)===Number(op.quotation_engineer_id);
   if(actor?.isActive===false||!(admin||(attachment.category==='requirement'?sales:attachment.category==='commercial_quote'&&engineer)))fail('不能上传此需求或商务文件。',403);
   let round=await currentRound(client,opportunityId);
   if((expectedRoundId!=null&&Number(expectedRoundId)!==Number(round?.id||0))||(expectedRoundId==null&&round&&round.revision_kind!=='initial'))fail('需求轮次已变化，请刷新后上传。');
   if(round?.accepted_quote_id)fail('本轮最终版本已确认，请先新增修改需求。');
   if(round&&await hasSubmittedQuote(client,round.id))fail('本轮已提交正式商务报价，新增客户要求请发起新修订；报价附件请先完成或驳回当前审批。');
   if(Number(attachment.opportunityId)!==Number(opportunityId)||!['requirement','commercial_quote'].includes(attachment.category))fail('附件不属于此商机或栏目。',400);
   if(!round)round=await initialRound(client,op,actor);
   const created=await createAttachmentRepository(client).createAttachment(attachment);
   await client.query('INSERT INTO opportunity_revision_attachment_links(revision_round_id,attachment_id,added_by) VALUES($1,$2,$3)',[round.id,created.id,actor.id]);
   return created;
  });},
  async start(actor,opportunityId,input){return transaction(async client=>{
   const op=(await client.query('SELECT * FROM opportunities WHERE id=$1 AND deleted_at IS NULL FOR UPDATE',[opportunityId])).rows[0];
   if(!op)fail('商机不存在。',404);
   if(!canStartOpportunityRevision(actor,op))fail('当前阶段或账号不能发起修订；审批中的报价请先完成、撤回或驳回。',403);
   const feedback=String(input.feedback||'').trim(),kind=input.revisionKind;
   if(!['technical','commercial'].includes(kind)||!feedback||feedback.length>4000)fail('请选择修订类型并填写客户反馈（最多4000字）。',400);
   let current=await currentRound(client,opportunityId);
   if(!Number.isSafeInteger(Number(input.expectedRoundNo))||Number(input.expectedRoundNo)!==Number(current?.round_no||0))fail('修订轮次已变化，请刷新后重试。');
   if((await client.query("SELECT id FROM sales_commercial_quotation_versions WHERE opportunity_id=$1 AND status='pending' LIMIT 1",[opportunityId])).rows.length)fail('已有正式报价待审批，请先处理该版本。');
   const basis=(await client.query('SELECT bestcrm_quotation_basis($1) AS basis',[opportunityId])).rows[0].basis;
   if(kind==='commercial'&&!(await client.query('SELECT bestcrm_revision_basis_ready($1,$2::jsonb) AS ready',[opportunityId,JSON.stringify(basis)])).rows[0].ready)fail('技术方案和价格核算尚未全部批准，请先完成技术核算流程。');
   const sourceEmailId=input.sourceEmailMessageId?validId(input.sourceEmailMessageId):null;
   if(input.sourceEmailMessageId&&!sourceEmailId)fail('来源邮件无效。',400);
   if(sourceEmailId&&!(await client.query('SELECT m.id FROM email_messages m JOIN email_threads t ON t.id=m.thread_id WHERE m.id=$1 AND t.opportunity_id=$2',[sourceEmailId,opportunityId])).rows.length)fail('来源邮件不属于本商机。',400);
   if(!current)current=await initialRound(client,op,actor,basis);
   await client.query('UPDATE opportunity_revision_rounds SET closed_at=now(),closed_basis=$2::jsonb WHERE id=$1',[current.id,JSON.stringify({...basis,requirementText:op.requirement})]);
   const round=(await client.query(`INSERT INTO opportunity_revision_rounds(opportunity_id,round_no,revision_kind,feedback,baseline,created_by,source_email_message_id)
    SELECT $1,COALESCE(MAX(round_no),0)+1,$2,$3,$4::jsonb,$5,$6 FROM opportunity_revision_rounds WHERE opportunity_id=$1 RETURNING *`,[opportunityId,kind,feedback,JSON.stringify(basis),actor.id,sourceEmailId])).rows[0];
   if(input.requirementText)await client.query('INSERT INTO requirement_updates(opportunity_id,requirement_text,reason,created_by,revision_round_id) VALUES($1,$2,$3,$4,$5)',[opportunityId,input.requirementText,input.reason,actor.id,round.id]);
   const target=kind==='technical'?'technical_solution_in_progress':'commercial_quote_in_progress';
   await client.query('UPDATE opportunities SET status=$2,accepted_quotation_package_id=NULL,updated_at=now() WHERE id=$1',[opportunityId,target]);
   await client.query('UPDATE sales_commercial_quotation_drafts SET draft_revision_no=draft_revision_no+1,updated_by=$2 WHERE opportunity_id=$1',[opportunityId,actor.id]);
   await createTodoRepository(client).closePendingForOpportunity(opportunityId,'superseded',actor.id);
   await client.query(`INSERT INTO workflow_events(opportunity_id,event_type,from_status,to_status,actor_user_id,target_user_id,comment)
    VALUES($1,'add_requirement_update',$2,$3,$4,$5,$6)`,[opportunityId,op.status,target,actor.id,op.quotation_engineer_id,'第'+round.round_no+'轮修订：'+feedback]);
   if(op.quotation_engineer_id)await createTodoRepository(client).create({opportunityId,assigneeUserId:Number(op.quotation_engineer_id),title:kind==='technical'?'Revise technical solution for supplemental requirement':'Revise commercial quote'},actor.id);
   return round;
  });},
  async accept(actor,opportunityId,input){return transaction(async client=>{
   const op=(await client.query('SELECT * FROM opportunities WHERE id=$1 AND deleted_at IS NULL FOR UPDATE',[opportunityId])).rows[0];
   if(!op)fail('商机不存在。',404);
   if(!canAcceptOpportunityQuotation(actor,op))fail('仅销售负责人或管理员可确认客户接受的版本。',403);
   if(input.quoteChoice){const choice=/^(formal|legacy):([1-9]\d*)$/.exec(input.quoteChoice);if(!choice)fail('报价版本无效。',400);input={...input,quoteKind:choice[1],quoteId:choice[2]};}
   const note=String(input.note||'').trim(),quoteId=validId(input.quoteId);
   if(!quoteId||!['formal','legacy'].includes(input.quoteKind)||!note||note.length>2000)fail('请选择最终报价版本并填写客户接受依据（最多2000字）。',400);
   const round=await currentRound(client,opportunityId);
   if(!round||Number(input.expectedRoundNo)!==Number(round.round_no))fail('修订轮次已变化，请刷新后重试。');
   if(round.accepted_quote_id)fail('本轮已确认最终版本，需变更请发起新修订。');
   const result=(await client.query('UPDATE opportunity_revision_rounds SET accepted_quote_kind=$2,accepted_quote_id=$3,acceptance_note=$4,accepted_by=$5,accepted_at=now() WHERE id=$1 RETURNING *',[round.id,input.quoteKind,quoteId,note,actor.id])).rows[0];
   await client.query("INSERT INTO workflow_events(opportunity_id,event_type,from_status,to_status,actor_user_id,comment) VALUES($1,'customer_quotation_accepted',$2,$2,$3,$4)",[opportunityId,op.status,actor.id,'第'+round.round_no+'轮客户接受 '+input.quoteKind+' #'+quoteId+'：'+note]);
   return result;
  });}
 };
}
