import { randomUUID } from 'node:crypto';
import { fail } from './contracts.mjs';
export function createAiSourceRepository(pool){
 const repo={
  pool,
  async transaction(fn){const c=await pool.connect();try{await c.query('BEGIN');const value=await fn(c);await c.query('COMMIT');return value;}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}},
  async audit(sourceId,actor,action,reason='',details={},q=pool){await q.query('INSERT INTO ai_source_audit(source_id,actor_user_id,action,reason_code,details,key_id) VALUES($1,$2,$3,$4,$5::jsonb,$6)',[sourceId,actor,action,reason,JSON.stringify(details),details.key_id||null]);},
  async consumeNonce(key,nonce,expiry){return repo.transaction(async q=>{
   await q.query('DELETE FROM ai_source_nonces WHERE expires_at<now()');
   const count=await q.query('SELECT count(*)::int AS count FROM ai_source_nonces WHERE key_id=$1 AND expires_at>now()',[key]);
   if(count.rows[0].count>=600)fail(429,'rate_limited');
   const r=await q.query('INSERT INTO ai_source_nonces(key_id,nonce,expires_at) VALUES($1,$2,$3) ON CONFLICT DO NOTHING RETURNING nonce',[key,nonce,expiry]);return !!r.rows.length;
  });},
  async source(id,q=pool,lock=false){return (await q.query(`SELECT * FROM ai_sources WHERE id=$1${lock?' FOR UPDATE':''}`,[id])).rows[0]||null;},
  async external(client,id){return (await pool.query('SELECT * FROM ai_sources WHERE client_id=$1 AND external_lead_id=$2',[client,id])).rows[0]||null;},
  async list(actor,{q='',channel='',state='',page=1,pageSize=20,leadId=null,opportunityId=null}={}){
   const privileged=actor.roles.some(r=>['administrator','sales_manager'].includes(r));
   const values=[],where=[];const bind=v=>{values.push(v);return '$'+values.length;};
   if(!privileged)where.push('s.assigned_user_id='+bind(actor.id));
   // A search defaults to the full authorised corpus, regardless of current tab.
   if(q){for(const word of q.trim().split(/\s+/).filter(Boolean).slice(0,8)){
     const pattern='%'+word.replace(/[\\%_]/g,'\\$&')+'%';const p=bind(pattern);
     where.push(`(concat_ws(' ',s.title,s.payload->>'company_name',s.payload->>'country_or_region',s.payload->>'requirement_summary',s.payload->>'email',s.external_lead_id,s.payload::text) ILIKE ${p} ESCAPE '\\' OR EXISTS (SELECT 1 FROM ai_source_events e WHERE e.source_id=s.id AND e.payload::text ILIKE ${p} ESCAPE '\\'))`);
   }}
   if(leadId)where.push('s.lead_id='+bind(leadId));
   if(opportunityId)where.push('(s.opportunity_id='+bind(opportunityId)+' OR s.lead_id=(SELECT origin_inquiry_id FROM opportunities WHERE id='+bind(opportunityId)+'))');
   if(channel)where.push('s.channel='+bind(channel));
   if(state==='pending')where.push("s.retention='active' AND s.lead_id IS NULL AND s.opportunity_id IS NULL");
   if(state==='archived')where.push("s.retention='archived'");
   if(state==='deleted')where.push("s.retention='deleted'");
   if(state==='linked')where.push("s.retention<>'deleted' AND (s.lead_id IS NOT NULL OR s.opportunity_id IS NOT NULL)");
   if(state==='lead')where.push("s.retention<>'deleted' AND s.lead_id IS NOT NULL");
   if(state==='opportunity')where.push("s.retention<>'deleted' AND s.opportunity_id IS NOT NULL");
   if(state==='all')where.push("s.retention<>'deleted'");
   const clause=where.length?' WHERE '+where.join(' AND '):'';
   return repo.transaction(async c=>{
    await c.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    const total=Number((await c.query('SELECT count(*) AS count FROM ai_sources s'+clause,values)).rows[0].count);
    const pages=Math.max(1,Math.ceil(total/pageSize));const current=Math.min(page,pages);
    const rows=(await c.query('SELECT s.* FROM ai_sources s'+clause+' ORDER BY s.received_at DESC,s.id DESC LIMIT $'+(values.length+1)+' OFFSET $'+(values.length+2),[...values,pageSize,(current-1)*pageSize])).rows;
    return {rows,total,page:current,pageSize,pages};
   });
  },
  async detail(id){const s=await repo.source(id);if(!s)return null;const events=(await pool.query('SELECT id,kind,occurred_at,received_at,payload FROM ai_source_events WHERE source_id=$1 ORDER BY received_at,id',[id])).rows;const evidence=(await pool.query('SELECT id,original_name,mime_type,file_size,sha256,scan_status,uploaded_at FROM ai_source_evidence WHERE source_id=$1 ORDER BY uploaded_at,id',[id])).rows;const audit=(await pool.query('SELECT action,reason_code,details,created_at,actor_user_id FROM ai_source_audit WHERE source_id=$1 ORDER BY id DESC LIMIT 100',[id])).rows;return {...s,events,evidence,audit};},
  async event(client,event,q=pool){return (await q.query('SELECT * FROM ai_source_events WHERE client_id=$1 AND external_event_id=$2',[client,event])).rows[0];},
  async reconciliation(client,ids){return(await pool.query('SELECT e.external_event_id,e.receipt,s.retention,s.lead_id,s.opportunity_id,s.version FROM ai_source_events e LEFT JOIN ai_sources s ON s.id=e.source_id WHERE e.client_id=$1 AND e.external_event_id=ANY($2::text[])',[client,ids])).rows;},
  async accept({clientId,keyId,hash,kind,externalLeadId,payload},extra=async()=>{}){
   return repo.transaction(async c=>{
    const eventId=randomUUID();
    const reserved=await c.query("INSERT INTO ai_source_events(id,client_id,external_event_id,idempotency_key,payload_sha256,kind,occurred_at,payload) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb) ON CONFLICT DO NOTHING RETURNING id",[eventId,clientId,payload.external_event_id,payload.idempotency_key,hash,kind,payload.occurred_at,JSON.stringify(payload)]);
    if(!reserved.rows.length){const old=(await c.query('SELECT * FROM ai_source_events WHERE client_id=$1 AND (external_event_id=$2 OR idempotency_key=$3)',[clientId,payload.external_event_id,payload.idempotency_key])).rows;if(old.length!==1||old[0].payload_sha256!==hash||old[0].kind!==kind||old[0].external_event_id!==payload.external_event_id||old[0].idempotency_key!==payload.idempotency_key)fail(409,'idempotency_conflict');const linked=await repo.source(old[0].source_id,c);if(!linked||linked.external_lead_id!==externalLeadId)fail(409,'idempotency_conflict');return {created:false,receipt:old[0].receipt};}
    let initialSource=false;if(kind==='submission'){const inserted=await c.query('INSERT INTO ai_sources(id,client_id,external_lead_id,channel,title,payload,last_event_at) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7) ON CONFLICT(client_id,external_lead_id) DO NOTHING RETURNING id',[randomUUID(),clientId,externalLeadId,payload.source_channel,payload.title,JSON.stringify(payload),payload.occurred_at]);initialSource=!!inserted.rows.length;}
    const s=(await c.query('SELECT * FROM ai_sources WHERE client_id=$1 AND external_lead_id=$2 FOR UPDATE',[clientId,externalLeadId])).rows[0];
    if(!s)fail(404,'source_not_found');if(s.retention==='deleted')fail(409,'source_deleted');
    await extra(c,s,eventId);
    const receipt={submission_reference:s.id,status:'received',reason_code:'awaiting_human_processing'};
    const auditPayload=initialSource?{external_event_id:payload.external_event_id,idempotency_key:payload.idempotency_key,event_type:payload.event_type,source_channel:payload.source_channel,occurred_at:payload.occurred_at,original_payload_reference:'ai_sources.payload'}:payload;
    await c.query('UPDATE ai_source_events SET source_id=$1,receipt=$2::jsonb,payload=$4::jsonb WHERE id=$3',[s.id,JSON.stringify(receipt),eventId,JSON.stringify(auditPayload)]);
    // Original facts stay unchanged, including out-of-order events.
    await c.query('UPDATE ai_sources SET updated_at=now(),last_event_at=GREATEST(last_event_at,$2::timestamptz),version=version+1 WHERE id=$1',[s.id,payload.occurred_at]);
    await repo.audit(s.id,null,'machine_'+kind,'received',{key_id:keyId,event_id:payload.external_event_id},c);
    return{created:true,receipt};
   });
  },
  async evidence(id){return(await pool.query('SELECT * FROM ai_source_evidence WHERE id=$1',[id])).rows[0];}
 };return repo;
}
