import { createEmailAiDraftService } from '../src/experiments/emailAiDraftService.mjs';
import express from 'express';
import { page,client } from '../src/experiments/leadAiLabAssets.mjs';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { sampleEmail,fieldLabels,demoResult,callAnalysis,researchCustomer,synthesizeSpeech } from '../src/experiments/leadAiLab.mjs';
if(process.env.LEAD_AI_LAB_ENV_FILE)dotenv.config({path:process.env.LEAD_AI_LAB_ENV_FILE});
const app=express(),port=Number(process.env.LEAD_AI_LAB_PORT||3011);let calls=0,busy=false;
app.use((req,res,next)=>{res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; media-src 'self' blob:; object-src 'none'; frame-ancestors 'none'");
 const hosts=['127.0.0.1:'+port,'localhost:'+port];if(!hosts.includes(req.headers.host))return res.status(403).json({error:'仅允许本机访问。'});
 if(req.method==='POST'&&req.headers.origin!==('http://'+req.headers.host))return res.status(403).json({error:'来源不匹配。'});next();});
app.use(express.json({limit:'100kb'}));
app.get('/',async(req,res)=>res.type('html').send(page));
app.get('/lab.js',async(req,res)=>res.type('js').send(client));
app.get('/api/config',(req,res)=>res.json({sampleEmail,fieldLabels,doubaoConfigured:Boolean(process.env.LAB_ARK_API_KEY),openaiConfigured:Boolean(process.env.LAB_OPENAI_API_KEY)&&process.env.LAB_OPENAI_ENABLED==='true',speechConfigured:Boolean(process.env.LAB_TTS_API_KEY),searchEnabled:process.env.LAB_SEARCH_ENABLED==='true',callLimit:Number(process.env.LAB_CALL_LIMIT||20),calls}));
async function paid(res,callback){if(busy)return res.status(409).json({error:'已有任务执行中，请稍候。'});if(calls>=Number(process.env.LAB_CALL_LIMIT||20))return res.status(429).json({error:'已达到本次实验的调用次数上限。'});busy=true;calls++;try{await callback();}finally{busy=false;}}
// Isolated experimental repository; never receives production CRM repositories.
const drafts=new Map(),threads=new Map();
const draftService=createEmailAiDraftService({repository:{save:async d=>drafts.set(d.id,structuredClone(d)),get:async id=>drafts.get(id),latest:async(a,t)=>[...drafts.values()].reverse().find(d=>d.actorId===a&&d.threadId===t)},loadVisibleThread:async(actor,id)=>actor.id==='local-experiment'?threads.get(id):null,analyze:async(email,options)=>options.mode==='demo'?{...demoResult(email),mode:'demo',provider:'demo',model:'固定虚构样例',createdAt:new Date().toISOString(),usage:{}}:callAnalysis(email,{provider:options.provider})});
app.post('/api/analyze',async(req,res,next)=>{try{
 if(req.body.mode!=='demo'&&req.body.consent!==true)return res.status(400).json({error:'请确认将邮件内容提交至所选模型服务商。'});
 const email=req.body.email;if(typeof email!=='string'||!email.trim()||email.length>20000)throw Error('邮件正文必填，最多20000字符。');
 const threadId='local-preview';threads.set(threadId,{id:threadId,triageStatus:'pending',messages:[{id:'preview-message',direction:'inbound',textBody:email}]});
 const run=async()=>{const draft=await draftService.prepare({id:'local-experiment'},threadId,{mode:req.body.mode,provider:req.body.provider,refresh:true});res.json({...draft.result,draftId:draft.id,suggestion:draft.suggestion});};
 if(req.body.mode==='demo')await run();else await paid(res,run);
}catch(e){next(e);}});
app.post('/api/review',async(req,res,next)=>{try{const draft=await draftService.review({id:'local-experiment'},'local-preview',req.body.draftId,{confirmed:req.body.confirmed,fields:req.body.fields,customerReport:req.body.customerReport});res.json({draftId:draft.id,reviewedAt:draft.reviewedAt,suggestion:draft.suggestion});}catch(e){next(e);}});
app.post('/api/research',async(req,res,next)=>{try{if(req.body.consent!==true)return res.status(400).json({error:'请确认将公司名及官网用于联网调查。'});await paid(res,async()=>res.json(await researchCustomer(req.body.fields||{})));}catch(e){next(e);}});
app.post('/api/speak',async(req,res,next)=>{try{if(req.body.consent!==true)return res.status(400).json({error:'请确认将朗读文本提交至豆包语音。'});await paid(res,async()=>res.type('audio/mpeg').send(await synthesizeSpeech(req.body.text)));}catch(e){next(e);}});
app.use((err,req,res,next)=>{res.status(400).json({error:err.name==='AbortError'||err.name==='TimeoutError'?'调用超时，请稍后重试。':err.message?.slice(0,300)||'请求失败。'});});
app.listen(port,'127.0.0.1',()=>console.log('AI线索实验版：http://127.0.0.1:'+port+'（独立实验，不写生产数据库）'));
