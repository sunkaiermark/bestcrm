import express from 'express';
import { loadConfig } from './config.mjs';

export function createApp(options = {}) {
  const config = { ...loadConfig(), ...options };
  const app = express();

  app.disable('x-powered-by');
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());

  app.get('/health', (req, res) => {
    res.json({ ok: true, app: 'BESTCRM' });
  });

  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const config = loadConfig();
  const app = createApp(config);
  app.listen(config.port, () => {
    console.log(`BESTCRM listening on ${config.baseUrl}`);
  });
}
