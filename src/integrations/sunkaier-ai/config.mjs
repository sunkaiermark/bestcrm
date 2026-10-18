import path from 'node:path';
export function loadAiSourceConfig(env=process.env){
 const enabled=env.SUNKAIER_AI_INTEGRATION_ENABLED==='true';let keys=[];
 if(enabled){try{keys=JSON.parse(env.SUNKAIER_AI_KEYS_JSON||'[]');}catch{throw new Error('Invalid SUNKAIER_AI_KEYS_JSON');}
 if(!Array.isArray(keys)||!keys.length||keys.length>10||keys.some(k=>!k||!/^[A-Za-z0-9_.-]{1,80}$/.test(k.id)||typeof k.secret!=='string'||k.secret.length<32||!/^[A-Za-z0-9_.-]{1,80}$/.test(k.clientId))||new Set(keys.map(k=>k.id)).size!==keys.length)throw new Error('AI integration requires dedicated key IDs, clientId scopes and secrets of at least 32 characters');}
 return{enabled,workspaceEnabled:env.AI_SOURCE_ENABLED==='true',keys,evidenceRoot:path.resolve(env.UPLOAD_DIR||'./var/uploads','ai-source-private'),scannerCommand:env.AI_SOURCE_SCANNER_COMMAND||'clamdscan'};
}
