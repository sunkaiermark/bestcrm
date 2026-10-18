import { readdir,readFile } from 'node:fs/promises';
import { openLocalAiDatabase } from '../../src/integrations/sunkaier-ai/local-database.mjs';
import { seedInternalAccounts } from '../../src/db/seed.mjs';
import { hashPassword } from '../../src/services/authService.mjs';
export async function testDatabase(location){
 const pool=await openLocalAiDatabase(location);
 await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())');
 for(const f of (await readdir('src/db/migrations')).filter(x=>x.endsWith('.sql')).sort()){
  if((await pool.query('SELECT 1 FROM schema_migrations WHERE name=$1',[f])).rows.length)continue;
  await pool.query(await readFile('src/db/migrations/'+f,'utf8'));await pool.query('INSERT INTO schema_migrations(name) VALUES($1)',[f]);
 }
 await seedInternalAccounts(pool);
 return pool;
}
export async function syntheticUser(pool,name,roles,password){
 const existing=(await pool.query('SELECT id FROM users WHERE username=$1',[name])).rows[0];let id=existing?.id;
 if(!id)id=(await pool.query('INSERT INTO users(username,password_hash,display_name) VALUES($1,$2,$3) RETURNING id',[name,await hashPassword(password),name])).rows[0].id;
 for(const role of roles)await pool.query('INSERT INTO user_roles(user_id,role_id) SELECT $1,id FROM roles WHERE code=$2 ON CONFLICT DO NOTHING',[id,role]);
 return{id:Number(id),username:name,displayName:name,isActive:true,roles};
}
