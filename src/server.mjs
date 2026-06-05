import express from 'express';
import session from 'express-session';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.mjs';
import { createPool } from './db/pool.mjs';
import { createSessionStore } from './db/sessionStore.mjs';
import { attachCurrentUser } from './middleware/auth.mjs';
import { createUserRepository } from './repositories/userRepository.mjs';
import { authRoutes } from './routes/authRoutes.mjs';

const dirname = path.dirname(fileURLToPath(import.meta.url));

const emptyUserRepository = {
  async findByIdWithRoles() {
    return null;
  },
  async findByUsernameWithRoles() {
    return null;
  }
};

export function createApp(options = {}) {
  const config = { ...loadConfig(), ...options };
  const shouldCreatePool = !options.userRepository && config.databaseUrl;
  const pool = options.pool || (shouldCreatePool ? createPool(config) : null);
  const userRepository = options.userRepository || (pool ? createUserRepository(pool) : emptyUserRepository);
  const sessionStore = 'sessionStore' in options ? options.sessionStore : createSessionStore(pool);
  const app = express();

  app.disable('x-powered-by');
  app.set('view engine', 'ejs');
  app.set('views', path.join(dirname, 'views'));
  app.use(express.urlencoded({ extended: false }));
  app.use(express.json());
  app.use(session({
    name: 'bestcrm.sid',
    secret: config.sessionSecret,
    resave: false,
    saveUninitialized: false,
    store: sessionStore,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.nodeEnv === 'production'
    }
  }));
  app.use(attachCurrentUser(userRepository));
  app.use(authRoutes(userRepository));

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
