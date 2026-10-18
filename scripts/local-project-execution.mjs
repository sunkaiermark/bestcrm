import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {randomBytes} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
process.chdir(fileURLToPath(new URL('..',import.meta.url)));
const base=path.resolve('var/project-execution-preview-v2');
await mkdir(path.join(base,'uploads'),{recursive:true});
const emptyEnv=path.join(base,'empty.env');await writeFile(emptyEnv,'');process.env.DOTENV_CONFIG_PATH=emptyEnv;
for(const key of Object.keys(process.env))if(/^(PG|DATABASE|SMTP|EMAIL_|CRM_EMAIL|CUSTOMER_SMTP|GOOGLE_MAIL|NOTIFICATION|TENCENT|WEB_PUSH|OPENAI|ANTHROPIC|DEEPSEEK|SUNKAIER_AI|AI_SOURCE)/.test(key))delete process.env[key];
const {testDatabase,syntheticUser}=await import('../tests/integrations/ai-source-fixtures.mjs');
const {createUserRepository}=await import('../src/repositories/userRepository.mjs');
const {createAttachmentRepository}=await import('../src/repositories/attachmentRepository.mjs');
const {createOpportunityRepository}=await import('../src/repositories/opportunityRepository.mjs');
const {createProjectExecutionRepository}=await import('../src/repositories/projectExecutionRepository.mjs');
const {receiveSignedContract}=await import('../src/services/projectExecutionService.mjs');
const {createApp}=await import('../src/server.mjs');
const {loadConfig}=await import('../src/config.mjs');
const {default:PDFDocument}=await import('pdfkit');
const credentialsPath=path.join(base,'login.json');let credentials;
try{credentials=JSON.parse(await readFile(credentialsPath,'utf8'));}catch{credentials={username:'local-project-sales',password:randomBytes(18).toString('base64url'),gmUsername:'local-project-gm',gmPassword:randomBytes(18).toString('base64url')};await writeFile(credentialsPath,JSON.stringify(credentials),{mode:0o600});}
const pool=await testDatabase(path.join(base,'database'));
const userRepository=createUserRepository(pool),attachmentRepository=createAttachmentRepository(pool);
const sales=await syntheticUser(pool,credentials.username,['salesperson'],credentials.password);
const gm=await syntheticUser(pool,credentials.gmUsername,['general_manager'],credentials.gmPassword);
await pool.query('UPDATE users SET display_name=$2 WHERE id=$1',[sales.id,'演示销售']);
await pool.query('UPDATE users SET display_name=$2 WHERE id=$1',[gm.id,'演示总经理']);
for(const [name,label,roles] of [['project','项目部执行人',[]],['technical','技术执行人',['quotation_engineer']],['supply','供应链执行人',[]],['quality','质量控制执行人',[]],['reviewer','技术经理',['technical_manager']]]){
 const user=await syntheticUser(pool,'local-preview-'+name,roles,randomBytes(18).toString('hex'));
 await pool.query('UPDATE users SET display_name=$2 WHERE id=$1',[user.id,'演示'+label]);
}
const uploadDir=path.join(base,'uploads');
let customer=(await pool.query('SELECT id FROM customers WHERE name=$1',['合成示例 · 自动建项预览客户'])).rows[0];
if(!customer)customer=(await pool.query('INSERT INTO customers(name,owner_user_id) VALUES($1,$2) RETURNING id',['合成示例 · 自动建项预览客户',sales.id])).rows[0];
for(const [number,title,received] of [['PREVIEW260019','反应系统交付项目 · 待总经理安排',true],['PREVIEW260020','干燥系统交付项目 · 销售上传演示',false]]){
 let opportunity=(await pool.query('SELECT id FROM opportunities WHERE opportunity_no=$1',[number])).rows[0];
 if(!opportunity){
  opportunity=(await pool.query("INSERT INTO opportunities(opportunity_no,title,customer_id,requirement,status,salesperson_id,archived_at) VALUES($1,$2,$3,$4,'contract_archived',$5,now()) RETURNING id",[number,title,customer.id,'本地合成演示，不连接云端，不代表真实订单。',sales.id])).rows[0];
  const pdf=new PDFDocument({size:'A4',margin:60}),chunks=[];pdf.on('data',chunk=>chunks.push(chunk));const done=new Promise(resolve=>pdf.on('end',resolve));
  pdf.fontSize(20).text('BESTCRM - SYNTHETIC CONTRACT PREVIEW');pdf.moveDown().fontSize(12).text('Demonstration only. No legal effect.').moveDown().text('Opportunity: '+number).text('Placeholder for the mutually signed contract received by Sales.');pdf.end();await done;
  const filePath=path.join(uploadDir,number+'-synthetic-signed.pdf');await writeFile(filePath,Buffer.concat(chunks));
  if(received)await receiveSignedContract({opportunityRepository:createOpportunityRepository(pool),attachmentRepository,userRepository,projectExecutionRepository:createProjectExecutionRepository(pool)},sales,opportunity.id,{path:filePath,originalname:'合成示例_双方签署合同.pdf',mimetype:'application/pdf'},uploadDir);
 }
}
const config={...loadConfig({}),pool,userRepository,sessionStore:undefined,csrfProtection:true,uploadDir,aiSourceConfig:{enabled:false,workspaceEnabled:false,keys:[]},emailPurgeFileCleanupEnabled:false,startEmailPurgeFileCleanupLoop:()=>null};
const salesApp=createApp({...config,sessionSecret:randomBytes(32).toString('hex'),sessionCookieName:'bestcrm.sales-preview.sid'});
const gmApp=createApp({...config,sessionSecret:randomBytes(32).toString('hex'),sessionCookieName:'bestcrm.gm-preview.sid'});
const server=salesApp.listen(3002,'127.0.0.1',()=>console.log('Sales upload preview: http://127.0.0.1:3002/opportunities/2/project-execution/start'));
const gmServer=gmApp.listen(3003,'127.0.0.1',()=>console.log('General Manager plan preview: http://127.0.0.1:3003/project-executions/1\nCredentials: '+credentialsPath+'\nSynthetic local data only. No external integrations.'));
process.on('SIGINT',()=>{server.close(()=>gmServer.close(async()=>{await pool.end();process.exit(0);}));});
