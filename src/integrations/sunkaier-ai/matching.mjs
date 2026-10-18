import { fail } from './contracts.mjs';
export async function refreshCandidates(repo,user,source){
 if(!user?.roles?.some(r=>['administrator','sales_manager'].includes(r)))fail(403,'forbidden');
 return repo.transaction(async c=>{
  const s=await repo.source(source,c,true);if(!s)fail(404,'source_not_found');const payloads=[s.payload,...(await c.query("SELECT payload FROM ai_source_events WHERE source_id=$1 AND kind='submission'",[source])).rows.map(r=>r.payload)];
  for(const p of payloads){
   const rules=[];if(p.email)rules.push(['email',p.email.toLowerCase(),"lower(btrim(contact_email))=$1"]);
   if(p.phone)rules.push(['e164_phone',p.phone,"btrim(contact_phone)=$1"]);
   if(p.company_name)rules.push(['company_name',p.company_name.toLowerCase(),"lower(btrim(company_name))=$1"]);
   if(p.project?.website_domain)rules.push(['website_domain',p.project.website_domain.toLowerCase(),"lower(regexp_replace(regexp_replace(company_website,'^https?://','','i'),'/.*$',''))=$1"]);
   for(const[rule,value,where]of rules){const matches=(await c.query(`SELECT id,count(*) OVER() AS matches FROM inquiries WHERE ${where} ORDER BY id LIMIT 30`,[value])).rows;for(const m of matches)await c.query("INSERT INTO ai_source_match_candidates(source_id,target_kind,target_id,rule,confidence) VALUES($1,'lead',$2,$3,$4) ON CONFLICT DO NOTHING",[source,m.id,rule,['email','e164_phone'].includes(rule)&&Number(m.matches)===1?'high':'review']);}
   if(p.email||p.phone){const matches=(await c.query("SELECT DISTINCT customer_id FROM contacts WHERE ($1<>'' AND lower(btrim(email))=$1) OR ($2<>'' AND btrim(phone)=$2) LIMIT 31",[p.email||'',p.phone||''])).rows;for(const m of matches.slice(0,30))await c.query("INSERT INTO ai_source_match_candidates(source_id,target_kind,target_id,rule,confidence) VALUES($1,'customer',$2,'contact_identity',$3) ON CONFLICT DO NOTHING",[source,m.customer_id,matches.length===1?'high':'review']);}
  }
  await repo.audit(source,user.id,'refresh_candidates','manual_review_only',{},c);
  return(await c.query('SELECT * FROM ai_source_match_candidates WHERE source_id=$1 ORDER BY id',[source])).rows;
 });
}
