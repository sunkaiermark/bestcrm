import { readdir,readFile } from 'node:fs/promises';
import { openLocalAiDatabase } from '../src/integrations/sunkaier-ai/local-database.mjs';
const pool=await openLocalAiDatabase();
try{for(const f of (await readdir('src/db/migrations')).filter(x=>x.endsWith('.sql')).sort()){try{await pool.query(await readFile('src/db/migrations/'+f,'utf8'));}catch(e){console.error('MIGRATION',f,e.message);process.exitCode=1;break;}}
if(!process.exitCode){await pool.query(await readFile('src/db/migrations/121_sunkai_ai_lead_integration.sql','utf8'));console.log('All migrations and repeat migration 121 passed');}}finally{await pool.end();}
