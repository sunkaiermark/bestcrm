import { Router } from 'express';
import { page, client } from '../experiments/leadAiLabAssets.mjs';
import { sampleEmail, fieldLabels, demoResult, callAnalysis, researchCustomer, synthesizeSpeech } from '../experiments/leadAiLab.mjs';
import { createEmailAiDraftService } from '../experiments/emailAiDraftService.mjs';

// Separate, explicitly enabled trial. No formal business repositories are injected.
export function leadAiTrialRoutes({ env = process.env, analyze = callAnalysis, research = researchCustomer, speak = synthesizeSpeech } = {}) {
  const router = Router();
  const allowed = new Set(String(env.LEAD_AI_TRIAL_USER_IDS || '').split(',').map(id => id.trim()).filter(id => /^\d+$/.test(id)));
  const usernames = new Set(String(env.LEAD_AI_TRIAL_USERNAMES || '').split(',').map(name => name.trim().toLowerCase()).filter(Boolean));
  const enabled = env.LEAD_AI_TRIAL_ENABLED === 'true';
  const limit = Math.max(1, Math.min(100, Number(env.LAB_CALL_LIMIT) || 5));
  let calls = 0, busy = false;
  const drafts = new Map(), threads = new Map();
  const key = (actor, id) => String(actor.id) + ':' + id;
  const service = createEmailAiDraftService({
    repository: {
      save: async draft => drafts.set(draft.id, structuredClone(draft)),
      get: async id => drafts.get(id),
      latest: async (actorId, threadId) => [...drafts.values()].reverse().find(draft => draft.actorId === actorId && draft.threadId === threadId)
    },
    loadVisibleThread: async (actor, id) => threads.get(key(actor, id)),
    analyze: async (email, options) => options.mode === 'demo'
      ? { ...demoResult(email), mode: 'demo', provider: 'demo', model: '固定虚构样例', createdAt: new Date().toISOString(), usage: {} }
      : analyze(email, { provider: options.provider, env })
  });
  router.use((req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!enabled) return res.status(404).send('Not found');
    if (!req.currentUser?.isActive || (!allowed.has(String(req.currentUser.id)) && !usernames.has(String(req.currentUser.username || '').toLowerCase()))) return res.status(403).json({ error: '仅允许已授权试用账号访问。' });
    if (req.method === 'POST' && !req.validateCsrf?.()) return res.status(403).json({ error: '页面已过期，请刷新后重试。' });
    next();
  });
  async function paid(res, run) {
    if (busy) return res.status(409).json({ error: '已有任务执行中，请稍候。' });
    if (calls >= limit) return res.status(429).json({ error: '本次服务运行的试用调用额度已用完，请管理员检查后重启。' });
    calls++; busy = true;
    try { return await run(); } finally { busy = false; }
  }
  const handle = callback => async (req, res) => {
    try { await callback(req, res); }
    catch { res.status(400).json({ error: 'AI请求未完成，请检查模型与搜索权限、额度或网络；现有业务流程不受影响。' }); }
  };
  router.get('/', (req, res) => res.type('html').send(page
    .replace('src="/lab.js"', 'src="/lead-ai-trial/lab.js"')
    .replace('<meta charset="utf-8">', '<meta charset="utf-8"><meta name="trial-csrf" content="' + res.locals.csrfToken + '">')));
  router.get('/lab.js', (req, res) => res.type('application/javascript').send(client
    .replace("fetch('/api/'", "fetch('/lead-ai-trial/api/'")
    .replace("fetch('/api/config')", "fetch('/lead-ai-trial/api/config')")
    .replace("headers:{'Content-Type':'application/json'}", "headers:{'Content-Type':'application/json','X-CSRF-Token':document.querySelector('meta[name=trial-csrf]').content}")));
  router.get('/api/config', (req, res) => res.json({ sampleEmail, fieldLabels, doubaoConfigured: Boolean(env.LAB_ARK_API_KEY), openaiConfigured: Boolean(env.LAB_OPENAI_API_KEY) && env.LAB_OPENAI_ENABLED === 'true', speechConfigured: Boolean(env.LAB_TTS_API_KEY), searchEnabled: env.LAB_SEARCH_ENABLED === 'true', calls, callLimit: limit }));
  router.post('/api/analyze', handle(async (req, res) => {
    if (req.body.mode !== 'demo' && req.body.consent !== true) return res.status(400).json({ error: '请确认将邮件提交至所选模型服务商。' });
    const email = req.body.email;
    if (typeof email !== 'string' || !email.trim() || email.length > 20000) return res.status(400).json({ error: '邮件正文必填，最多20000字符。' });
    const run = async () => {
      // Limited memory, no restart persistence; keep each authorized user's source separate.
      for (const [id, draft] of drafts) if (String(draft.actorId) === String(req.currentUser.id)) drafts.delete(id);
      threads.set(key(req.currentUser, 'trial'), { id: 'trial', messages: [{ id: 'latest', direction: 'inbound', textBody: email }] });
      const draft = await service.prepare(req.currentUser, 'trial', { mode: req.body.mode, provider: req.body.provider, refresh: true });
      res.json({ ...draft.result, draftId: draft.id, suggestion: draft.suggestion });
    };
    if (req.body.mode === 'demo') await run(); else await paid(res, run);
  }));
  router.post('/api/review', handle(async (req, res) => {
    const draft = await service.review(req.currentUser, 'trial', req.body.draftId, { confirmed: req.body.confirmed, fields: req.body.fields, customerReport: req.body.customerReport });
    res.json({ draftId: draft.id, reviewedAt: draft.reviewedAt, suggestion: draft.suggestion });
  }));
  router.post('/api/research', handle(async (req, res) => {
    if (req.body.consent !== true) return res.status(400).json({ error: '请确认以公司及最终用户信息进行联网调查。' });
    await paid(res, async () => res.json(await research(req.body.fields || {}, { env })));
  }));
  router.post('/api/speak', handle(async (req, res) => {
    if (req.body.consent !== true) return res.status(400).json({ error: '请确认将朗读文本提交至语音服务。' });
    await paid(res, async () => res.type('audio/mpeg').send(await speak(req.body.text, { env })));
  }));
  return router;
}