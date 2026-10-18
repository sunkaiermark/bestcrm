import { Router,raw } from 'express';
import { rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { machineAuth,sha256 } from './auth.mjs';
import { parse,submissionSchema,interactionSchema,reconciliationSchema,safeJson,fail,AiSourceError } from './contracts.mjs';
import { publicStatus } from './service.mjs';
import { parseEvidence,stageEvidence } from './evidence.mjs';
export const integrationPrefix='/api/integrations/sunkaier-ai/v1';
export function integrationRoutes({config,repository,scanner,now}){
 const router=Router();
 router.use((req,res,next)=>{if(!config.enabled)return res.status(503).json({error:'integration_disabled'});next();});
 router.use((req,res,next)=>{if(req.get('Content-Encoding')&&req.get('Content-Encoding')!=='identity')return res.status(415).json({error:'content_encoding_not_supported'});next();});
 router.use(raw({type:()=>true,limit:'27mb'}));
 router.use(machineAuth({config,repository,now}));
 const route=fn=>async(req,res,next)=>{try{await fn(req,res);}catch(e){await repository?.audit(null,null,'machine_request_rejected',e.code||'invalid_request',{key_id:req.aiMachine?.keyId||'',correlation_id:req.correlationId}).catch(()=>{});next(e);}};
 router.use((req,res,next)=>{req.correlationId=randomUUID();res.set('X-Correlation-Id',req.correlationId);res.set('Cache-Control','no-store');next();});
 function json(req){if(!req.is('application/json'))fail(415,'json_required');if(req.body.length>128*1024)fail(413,'payload_too_large');return safeJson(req.body);}
 router.post('/sources',route(async(req,res)=>{
  const payload=parse(submissionSchema,json(req));
  const result=await repository.accept({...req.aiMachine,kind:'submission',externalLeadId:payload.external_lead_id,payload});
  res.status(result.created?201:200).json(result.receipt);
 }));
 router.post('/sources/:externalLeadId/interactions',route(async(req,res)=>{
  const payload=parse(interactionSchema,json(req));
  const result=await repository.accept({...req.aiMachine,kind:'interaction',externalLeadId:req.params.externalLeadId,payload});
  res.status(result.created?201:200).json(result.receipt);
 }));
 router.post('/sources/:externalLeadId/evidence',route(async(req,res)=>{
  if(!req.is('multipart/form-data'))fail(415,'multipart_required');
  const s=await repository.external(req.aiMachine.clientId,req.params.externalLeadId);if(!s)fail(404,'source_not_found');
  const {meta,buffer}=await parseEvidence(req);let staged;
  try{const result=await repository.accept({...req.aiMachine,hash:sha256(JSON.stringify(meta)),kind:'evidence',externalLeadId:req.params.externalLeadId,payload:meta},async(c,source,eventId)=>{
   if(meta.interaction_event_id){const event=await repository.event(req.aiMachine.clientId,meta.interaction_event_id,c);if(!event||event.source_id!==source.id||event.kind==='evidence')fail(422,'interaction_not_found');}
   staged=await stageEvidence({buffer,meta,root:config.evidenceRoot,scanner});
   await c.query("INSERT INTO ai_source_evidence(id,source_id,event_id,original_name,mime_type,file_size,sha256,storage_key,scan_status) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'clean')",[randomUUID(),source.id,eventId,meta.file_name,meta.mime_type,meta.file_size,meta.sha256,staged.key]);
  });res.status(result.created?201:200).json(result.receipt);
  }catch(e){if(staged)await rm(staged.target,{force:true});throw e;}
 }));
 router.get('/sources/:externalLeadId/status',route(async(req,res)=>{
  const s=await repository.external(req.aiMachine.clientId,req.params.externalLeadId);if(!s)fail(404,'source_not_found');
  res.json({submission_reference:s.id,status:publicStatus(s),version:s.version,updated_at:s.updated_at});
 }));
 router.post('/reconciliation',route(async(req,res)=>{
  const {external_event_ids:ids}=parse(reconciliationSchema,json(req));const rows=await repository.reconciliation(req.aiMachine.clientId,ids);
  res.json({results:ids.map(id=>{const r=rows.find(r=>r.external_event_id===id);return r?{external_event_id:id,received:true,submission_reference:r.receipt.submission_reference,status:publicStatus(r),version:r.version}:{external_event_id:id,received:false,status:'not_received'};})});
 }));
 router.use((req,res)=>res.status(404).json({error:'endpoint_not_found'}));
 router.use((err,req,res,next)=>{if(err.code==='LIMIT_FILE_SIZE'||err.type==='entity.too.large')return res.status(413).json({error:'payload_too_large'});if(err.name==='MulterError')return res.status(422).json({error:'invalid_multipart'});if(err instanceof AiSourceError)return res.status(err.status).json({error:err.code});res.status(500).json({error:'integration_unavailable'});});
 return router;
}




