import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { fail } from './contracts.mjs';
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export function signature(secret,method,path,timestamp,nonce,hash){return createHmac('sha256',secret).update([method,path,timestamp,nonce,hash].join('\n')).digest('hex');}
export function machineAuth({config,repository,now=()=>Date.now()}){
 return async(req,res,next)=>{try{
  if(!config.enabled)fail(503,'integration_disabled');
  if(!repository)fail(503,'database_unavailable');
  const get=n=>req.get('X-Sunkaier-'+n)||'';
  const keyId=get('Key-Id'),ts=get('Timestamp'),nonce=get('Nonce'),hash=get('Content-SHA256'),sig=get('Signature');
  if(!/^[A-Za-z0-9_.-]{1,80}$/.test(keyId)||!/^\d{10}$/.test(ts)||!/^[A-Za-z0-9_-]{16,128}$/.test(nonce)||!/^([a-f0-9]{64})$/.test(hash)||!/^([a-f0-9]{64})$/.test(sig))fail(401,'invalid_authentication');
  if(Math.abs(now()-Number(ts)*1000)>300000)fail(401,'expired_timestamp');
  const key=config.keys.find(k=>k.id===keyId);
  if(!key||key.secret.length<32)fail(401,'invalid_authentication');
  if(req.originalUrl.includes('?'))fail(400,'query_not_supported');
  const body=Buffer.isBuffer(req.body)?req.body:Buffer.alloc(0);
  if(sha256(body)!==hash)fail(401,'body_hash_mismatch');
  const expected=signature(key.secret,req.method,req.originalUrl,ts,nonce,hash);
  if(!timingSafeEqual(Buffer.from(expected,'hex'),Buffer.from(sig,'hex')))fail(401,'invalid_authentication');
  if(!await repository.consumeNonce(keyId,nonce,new Date(now()+600000)))fail(409,'nonce_replayed');
  req.aiMachine={clientId:key.clientId,keyId,hash};next();
 }catch(error){if(repository)await repository.audit(null,null,'authentication_rejected',error.code||'internal_error',{key_id:/^[A-Za-z0-9_.-]{1,80}$/.test(req.get('X-Sunkaier-Key-Id')||'')?req.get('X-Sunkaier-Key-Id'):'invalid'}).catch(()=>{});next(error);}};
}
