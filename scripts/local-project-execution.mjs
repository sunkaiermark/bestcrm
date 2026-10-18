import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {randomBytes,createHash} from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
process.chdir(fileURLToPath(new URL('..',import.meta.url)));
await mkdir('var/project-execution-preview/uploads',{recursive:true});
const emptyEnv=path.resolve('var/project-execution-preview/empty.env');
await writeFile(emptyEnv,'');
process.env.DOTENV_CONFIG_PATH=emptyEnv;
for(const key of Object.keys(process.env))if(/^(PG|DATABASE|SMTP|EMAIL_|CRM_EMAIL|CUSTOMER_SMTP|GOOGLE_MAIL|NOTIFICATION|TENCENT|WEB_PUSH|OPENAI|ANTHROPIC|DEEPSEEK|SUNKAIER_AI|AI_SOURCE)/.test(key))delete process.env[key];
const {testDatabase,syntheticUser}=await import('../tests/integrations/ai-source-fixtures.mjs');
const {createUserRepository}=await import('../src/repositories/userRepository.mjs');
const {createAttachmentRepository}=await import('../src/repositories/attachmentRepository.mjs');
const {createApp}=await import('../src/server.mjs');
const {loadConfig}=await import('../src/config.mjs');
const {default:PDFDocument}=await import('pdfkit');
const credentialsPath=path.resolve('var/project-execution-preview/login.json');
let credentials;
try{credentials=JSON.parse(await readFile(credentialsPath,'utf8'));}catch{credentials={username:'local-project-sales',password:randomBytes(18).toString('base64url')};await writeFile(credentialsPath,JSON.stringify(credentials),{mode:0o600});}
const pool=await testDatabase('var/project-execution-preview/database');
const sales=await syntheticUser(pool,credentials.username,['salesperson','administrator'],credentials.password);
const technical=await syntheticUser(pool,'local-project-technical',['technical_manager'],randomBytes(18).toString('hex'));
await pool.query('UPDATE users SET display_name=$2 WHERE id=$1',[sales.id,'演示销售 · 项目负责人']);
await pool.query('UPDATE users SET display_name=$2 WHERE id=$1',[technical.id,'演示技术经理']);
const attachmentRepository=createAttachmentRepository(pool);
const uploadDir=path.resolve('var/project-execution-preview/uploads');
let customer=(await pool.query('SELECT id FROM customers WHERE name=$1',['合成示例 · 项目启动预览客户'])).rows[0];
if(!customer)customer=(await pool.query('INSERT INTO customers(name,owner_user_id) VALUES($1,$2) RETURNING id',['合成示例 · 项目启动预览客户',sales.id])).rows[0];
let startId;
for(const [number,title] of [['PREVIEW260019','反应系统交付项目 · 销售启动演示'],['PREVIEW260020','干燥系统交付项目 · 可操作预览']]){
 let opportunity=(await pool.query('SELECT id FROM opportunities WHERE opportunity_no=$1',[number])).rows[0];
 if(!opportunity){
  opportunity=(await pool.query("INSERT INTO opportunities(opportunity_no,title,customer_id,requirement,status,salesperson_id,quotation_engineer_id,technical_manager_id,archived_at) VALUES($1,$2,$3,$4,'contract_archived',$5,$5,$6,now()) RETURNING id",[number,title,customer.id,'本地合成演示，不连接云端，不代表真实订单。',sales.id,technical.id])).rows[0];
  const fileName=number+'-synthetic-signed.pdf';
  const pdf=new PDFDocument({size:'A4',margin:60});const chunks=[];pdf.on('data',chunk=>chunks.push(chunk));
  const done=new Promise(resolve=>pdf.on('end',resolve));
  pdf.fontSize(20).text('BESTCRM - SYNTHETIC CONTRACT PREVIEW');pdf.moveDown().fontSize(12).text('Demonstration only. This is not a real contract and has no legal effect.').moveDown().text('Opportunity: '+number).text('This placeholder represents the mutually signed contract uploaded by Sales.');pdf.end();await done;
  const bytes=Buffer.concat(chunks);await writeFile(path.join(uploadDir,fileName),bytes);
  await attachmentRepository.createAttachment({opportunityId:opportunity.id,category:'signed_contract',originalName:'合成示例_双方签署合同_'+number+'.pdf',storedPath:fileName,mimeType:'application/pdf',fileSize:bytes.length,uploadedBy:sales.id,sha256:createHash('sha256').update(bytes).digest('hex')});
 }
 if(!startId)startId=Number(opportunity.id);
}
const config=loadConfig({});
const app=createApp({...config,pool,userRepository:createUserRepository(pool),sessionStore:undefined,sessionSecret:randomBytes(32).toString('hex'),csrfProtection:true,uploadDir,aiSourceConfig:{enabled:false,workspaceEnabled:false,keys:[]},emailPurgeFileCleanupEnabled:false,startEmailPurgeFileCleanupLoop:()=>null});
const server=app.listen(3002,'127.0.0.1',()=>console.log('Local isolated project preview: http://127.0.0.1:3002/opportunities/'+startId+'/project-execution/start\nCredentials: '+credentialsPath+'\nSynthetic data only. External integrations disabled.'));
process.on('SIGINT',()=>server.close(async()=>{await pool.end();process.exit(0);}));
