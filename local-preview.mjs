import { readFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('.', import.meta.url)));
// Clear inherited application settings before dotenv loads the local configuration.
const configSource = readFileSync(new URL('./src/config.mjs', import.meta.url), 'utf8');
for (const match of configSource.matchAll(/env\.([A-Z][A-Z0-9_]*)/g)) delete process.env[match[1]];
for (const key of Object.keys(process.env)) {
  if (/^(PG|DATABASE|SMTP|CUSTOMER_SMTP|EMAIL_|CRM_EMAIL|GOOGLE_MAIL|NOTIFICATION|TENCENT|WEB_PUSH|OPENAI|ANTHROPIC|DEEPSEEK|AI_|LLM_|DOTENV_CONFIG_)/.test(key)) delete process.env[key];
}
const { config: dotenv } = await import('dotenv');
dotenv({ path: '.env' });
// Enforce offline preview even if .env is later changed.
process.env.NODE_ENV = 'development';
process.env.DATABASE_URL = '';
process.env.BASE_URL = 'http://127.0.0.1:3000';
process.env.PORT = '3000';
process.env.SESSION_SECRET = randomBytes(32).toString('hex');
for (const match of configSource.matchAll(/env\.([A-Z][A-Z0-9_]*ENABLED)/g)) process.env[match[1]] = 'false';
const { loadConfig } = await import('./src/config.mjs');
const config = loadConfig();
if (config.databaseUrl || config.emailIntake.enabled || config.customerEmail.enabled || config.googleMail.enabled || config.notificationDelivery.enabled) throw new Error('Local preview isolation check failed');
const { createApp } = await import('./src/server.mjs');
const { default: express } = await import('express');
const app = express();
app.use('/ai-source-preview', express.static(fileURLToPath(new URL('./preview/ai-source/', import.meta.url))));
app.use(createApp(config));
app.listen(3000, '127.0.0.1', () => {
  console.log('LOCAL PREVIEW: http://127.0.0.1:3000');
  console.log('Database: disconnected; mail and external delivery: disabled. No business data available.');
});

