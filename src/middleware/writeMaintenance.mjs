import { existsSync } from 'node:fs';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

function isAuthenticationMutation(pathname) {
  return pathname === '/login'
    || pathname.startsWith('/login/')
    || pathname === '/logout';
}

function prefersJson(req) {
  const accepted = req.accepts?.(['html', 'json']);
  return accepted === 'json';
}

export function writeMaintenance({
  flagPath = '/run/bestcrm/write-maintenance',
  flagExists = existsSync
} = {}) {
  return (req, res, next) => {
    const active = Boolean(flagPath) && flagExists(flagPath);
    res.locals.writeMaintenanceActive = active;

    if (!active || SAFE_METHODS.has(req.method) || isAuthenticationMutation(req.path)) {
      next();
      return;
    }

    res.set('Cache-Control', 'no-store');
    res.set('Retry-After', '60');

    const payload = {
      ok: false,
      code: 'write_maintenance',
      message: 'BESTCRM is creating a release backup. Reading remains available; saving and submitting are temporarily paused.'
    };

    if (prefersJson(req)) {
      res.status(503).json(payload);
      return;
    }

    res.status(503).type('html').send(`<!doctype html>
<html lang="zh-CN">
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>BESTCRM maintenance</title></head>
  <body style="font:18px/1.6 Arial,'Microsoft YaHei',sans-serif;margin:48px;color:#16202a">
    <h1 style="font-size:24px">系统正在创建发布前备份</h1>
    <p>浏览和查询仍可使用；保存、提交及上传暂时暂停。请稍后重试。</p>
    <p>BESTCRM is creating a release backup. Reading remains available; saving, submitting and uploading are temporarily paused.</p>
  </body>
</html>`);
  };
}
