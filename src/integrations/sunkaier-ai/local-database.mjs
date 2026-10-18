import { PGlite } from '@electric-sql/pglite';
// Local synthetic runtime only; production uses the existing pg.Pool.
// Serialises independent calls and holds a lease for the entire transaction.
export async function openLocalAiDatabase(location){
 const db=new PGlite(location);await db.waitReady;let tail=Promise.resolve();
 const lock=async()=>{const prev=tail;let release;tail=new Promise(r=>{release=r;});await prev;return release;};
 const query=async(sql,params=[])=>{const r=params.length?await db.query(sql,params):(await db.exec(sql)).at(-1)||{rows:[],affectedRows:0};return{...r,rowCount:r.affectedRows??r.rows.length};};
 return{db,async query(sql,p){const unlock=await lock();try{return await query(sql,p);}finally{unlock();}},async connect(){const unlock=await lock();return{query,release:unlock};},async end(){await tail;await db.close();}};
}

