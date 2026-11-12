const express = require('express');
const helmet = require('helmet');

const config = require('./config');
const logger = require('./utils/logger');
const { wakeTokenAuth } = require('./middleware/wakeTokenAuth');
const { basicAuth } = require('./middleware/auth');
const { authFailureLimiter, writeLimiter } = require('./middleware/rateLimit');
const { sameOrigin } = require('./middleware/sameOrigin');
const { requestId } = require('./middleware/requestId');
const { getDb, closeDb } = require('./services/db');
const { getPoller } = require('./services/statusPoller');
const { createScheduler } = require('./services/scheduler');
const { router: schedulesRouter } = require('./routes/schedules');

const devicesRouter = require('./routes/devices');
const wakeRouter = require('./routes/wake');
const healthRouter = require('./routes/health');
const statusRouter = require('./routes/status');
const tagsRouter = require('./routes/tags');
const dataRouter = require('./routes/data');
const { createEventsRouter } = require('./routes/events');
const { createServiceWorkerHandler } = require('./routes/serviceWorker');
const eventsRouter = createEventsRouter();

const app = express();

if (config.trustProxy) app.set('trust proxy', config.trustProxy);
app.use(requestId);
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'"],
        fontSrc: ["'self'"],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
      },
    },
  })
);
app.use((req, res, next) => {
  const limit = req.path === '/api/import' ? '512kb' : '16kb';
  return express.json({ limit })(req, res, next);
});

app.use('/health', healthRouter);

app.use(authFailureLimiter);
// Seul ce GET peut accorder une identité de token avant Basic Auth.
app.get('/wake/:deviceId', wakeTokenAuth);
app.use((req, res, next) => (req.wakeToken ? next() : basicAuth(req, res, next)));

const requireSameOrigin = sameOrigin();
const requireWriteGuard = (req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  return requireSameOrigin(req, res, (err) => {
    if (err) return next(err);
    return writeLimiter(req, res, next);
  });
};

app.get('/sw.js', createServiceWorkerHandler(config.publicDir));
app.use(express.static(config.publicDir));
app.use(['/api/schedules', '/api/devices/:id/schedules'], requireWriteGuard);
app.use(schedulesRouter);
app.use('/api/devices', requireWriteGuard, devicesRouter);
app.use(requireWriteGuard, tagsRouter);
app.use(requireWriteGuard, dataRouter);
app.use(statusRouter);
app.use(eventsRouter);
app.use(wakeRouter);

app.use((err, _req, res, _next) => {
  logger.error('Unhandled error', { error: err.message });
  res.status(500).json({ success: false, message: 'Erreur interne' });
});

function start() {
  if (!config.auth.user || !config.auth.pass) {
    logger.warn(
      'Authentification désactivée : configurez AUTH_USER et AUTH_PASS pour protéger l’accès à Spark.'
    );
  }

  getDb();
  const scheduler = createScheduler();
  scheduler.start();
  const poller = getPoller({ intervalMs: config.statusPollMs, timeoutMs: 800 });
  poller.start();

  const server = app.listen(config.port, () => {
    logger.info(`Spark running on port ${config.port}`, {
      authEnabled: !!(config.auth.user && config.auth.pass),
    });
  });

  let shuttingDown = false;
  const shutdown = async (signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info(`Received ${signal}, shutting down`);
    poller.stop();
    eventsRouter.closeAll();
    await Promise.all([scheduler.stop(), new Promise((resolve) => server.close(resolve))]);
    closeDb();
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
  return server;
}

if (require.main === module) {
  start();
}

module.exports = { app, start };
