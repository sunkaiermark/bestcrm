import {randomBytes,createHash,createHmac} from 'node:crypto';
export function createSunkaierAiClient({baseUrl,keyId,secret,fetchImpl=fetch,timeoutMs=15000}){
 const base=new URL(baseUrl);if((base.protocol!=='https:'&&!(base.protocol==='http:'&&['127.0.0.1','localhost','[::1]'].includes(base.hostname)))||base.username||base.password||base.search||base.hash)throw new Error('HTTPS or loopback base URL required');
 if(typeof secret!=='string'||secret.length<32)throw new Error('Environment-managed HMAC secret required');
 const prefix='/api/integrations/sunkaier-ai/v1';
 async function send(method,endpoint,body,contentType='application/json'){
  const bytes=body===undefined?Buffer.alloc(0):Buffer.isBuffer(body)?body:Buffer.from(JSON.stringify(body));
  const hash=createHash('sha256').update(bytes).digest('hex'),timestamp=String(Math.floor(Date.now()/1000)),nonce=randomBytes(24).toString('hex');
  const signature=createHmac('sha256',secret).update([method,endpoint,timestamp,nonce,hash].join('\n')).digest('hex');
  const response=await fetchImpl(new URL(endpoint,base),{method,signal:AbortSignal.timeout(timeoutMs),redirect:'error',headers:{'Content-Type':contentType,'X-Sunkaier-Key-Id':keyId,'X-Sunkaier-Timestamp':timestamp,'X-Sunkaier-Nonce':nonce,'X-Sunkaier-Content-SHA256':hash,'X-Sunkaier-Signature':signature},...(method==='GET'?{}:{body:bytes})});
  const result=await response.json();if(!response.ok){const error=new Error(result.error||'request_failed');error.status=response.status;error.retryable=response.status===429||response.status>=500;throw error;}return result;
 }
 return{
  submit:payload=>send('POST',prefix+'/sources',payload),
  append:(id,payload)=>send('POST',prefix+'/sources/'+encodeURIComponent(id)+'/interactions',payload),
  status:id=>send('GET',prefix+'/sources/'+encodeURIComponent(id)+'/status'),
  reconcile:ids=>send('POST',prefix+'/reconciliation',{external_event_ids:ids}),
  async evidence(id,metadata,bytes){const form=new FormData();form.set('metadata',JSON.stringify(metadata));form.set('file',new Blob([bytes],{type:metadata.mime_type}),metadata.file_name);const req=new Request(new URL(prefix,base),{method:'POST',body:form});return send('POST',prefix+'/sources/'+encodeURIComponent(id)+'/evidence',Buffer.from(await req.arrayBuffer()),req.headers.get('Content-Type'));}
 };
}
// Retry policy belongs to the AI durable outbox. Preserve event IDs and keys,
// reconcile uncertain outcomes first, then use bounded exponential backoff with jitter.
export function retryDelay(attempt,random=Math.random){return Math.floor(Math.min(60000,1000*2**Math.min(10,Math.max(0,attempt)))*(0.5+random()*0.5));}
