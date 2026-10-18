import { readFile,mkdir,writeFile,access } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('..',import.meta.url)));
// Clear external business connections before importing the application.
const configText=await readFile('src/config.mjs','utf8');
for(const m of configText.matchAll(/env\.([A-Z][A-Z0-9_]*)/g))delete process.env[m[1]];
for(const k of Object.keys(process.env))if(/^(PG|DATABASE|SMTP|EMAIL_|CRM_EMAIL|CUSTOMER_SMTP|GOOGLE_MAIL|NOTIFICATION|TENCENT|WEB_PUSH|OPENAI|ANTHROPIC|DEEPSEEK|SUNKAIER_AI|AI_SOURCE)/.test(k))delete process.env[k];
const {testDatabase,syntheticUser}=await import('../tests/integrations/ai-source-fixtures.mjs');
const {createAiSourceRepository}=await import('../src/integrations/sunkaier-ai/repository.mjs');
const {createAiSourceService}=await import('../src/integrations/sunkaier-ai/service.mjs');
const {createUserRepository}=await import('../src/repositories/userRepository.mjs');
const {sha256}=await import('../src/integrations/sunkaier-ai/auth.mjs');
const {createApp}=await import('../src/server.mjs');
const {loadConfig}=await import('../src/config.mjs');
await mkdir('var',{recursive:true});
const credentialsFile=path.resolve('var/ai-source-local-login.json');let credentials;
try{credentials=JSON.parse(await readFile(credentialsFile,'utf8'));}catch{credentials={username:'local-ai-review',password:randomBytes(18).toString('base64url')};await writeFile(credentialsFile,JSON.stringify(credentials,null,2),{mode:0o600});}
const pool=await testDatabase('var/ai-source-local-db');
const manager=await syntheticUser(pool,credentials.username,['administrator','sales_manager','salesperson'],credentials.password);
const repository=createAiSourceRepository(pool),service=createAiSourceService(repository);
if(process.argv.includes('--seed-demo')&&!(await pool.query('SELECT 1 FROM ai_sources WHERE client_id=$1 LIMIT 1',['local-synthetic'])).rows.length){
 const titles=['合成海湾材料扩建项目','合成东南亚树脂产线','合成欧洲电池材料项目','合成北美溶剂回收项目','合成南美生物材料项目','合成非洲化工改造项目'];
 for(let i=0;i<30;i++){
  const channel=i<24?'ai_project_search':['website_form','web_chat','phone_consultation'][i%3];
  const p={external_lead_id:'local-project-'+i,external_event_id:'local-event-'+i,idempotency_key:'local-key-'+i,event_type:'discovered',occurred_at:new Date(Date.now()-i*3600000).toISOString(),source_channel:channel,title:i<24?titles[i%titles.length]+' '+(Math.floor(i/6)+1):'合成客户咨询 '+i,company_name:'合成示例企业 '+i,contact_name:'合成联系人',email:'visitor'+i+'@example.invalid',phone:'+1202555'+String(1000+i),country_or_region:['阿联酋','马来西亚','德国','美国','巴西','南非'][i%6],interested_products:['真空干燥','反应系统'],requirement_summary:'合成项目资料：设备采购范围与时间待核实。此记录只用于本地功能测试。',consent_status:'unknown',data_origin:'synthetic',project:{name:'合成项目 '+i,verification:'unverified',sources:[{title:'合成项目公告',url:'https://source.example.invalid/project-'+i}]} };
  const r=await repository.accept({clientId:'local-synthetic',keyId:'local-seeder',hash:sha256(JSON.stringify(p)),kind:'submission',externalLeadId:p.external_lead_id,payload:p});
  if(i%7===0)await service.act(manager,r.receipt.submission_reference,{action:'archive',note:'合成初始归档资料'});
 }
}
const app=createApp({...loadConfig({}),pool,userRepository:createUserRepository(pool),sessionStore:undefined,sessionSecret:randomBytes(32).toString('hex'),csrfProtection:true,aiSourceConfig:{enabled:false,workspaceEnabled:true,keys:[],evidenceRoot:path.resolve('var/local-ai-evidence')},startEmailPurgeFileCleanupLoop:()=>null});
const server=app.listen(3001,'127.0.0.1',()=>console.log('Persistent local AI Source: http://127.0.0.1:3001/ai-sources\nSynthetic login file: '+credentialsFile+'\nMachine API disabled. Database persists only under var/.'));
process.on('SIGINT',()=>server.close(async()=>{await pool.end();process.exit(0);}));
