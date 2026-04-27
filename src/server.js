const express = require('express');
const helmet = require('helmet');

const config = require('./config');
const logger = require('./utils/logger');
const { basicAuth } = require('./middleware/auth');
const { authFailureLimiter, writeLimiter } = require('./middleware/rateLimit');
const { sameOrigin } = require('./middleware/sameOrigin');
const { requestId } = require('./middleware/requestId');
const { getDb, closeDb } = require('./services/db');
const { getPoller } = require('./services/statusPoller');

const devicesRouter = require('./routes/devices');
const wakeRouter = require('./routes/wake');
const healthRouter = require('./routes/health');
const statusRouter = require('./routes/status');
const tagsRouter = require('./routes/tags');
const dataRouter = require('./routes/data');

const app = express();

if (config.trustProxy) app.set('trust proxy', config.trustProxy);
app.use(requestId);
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", 'https://cdnjs.cloudflare.com'],
        fontSrc: ["'self'", 'https://cdnjs.cloudflare.com'],
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

app.use(authFailureLimiter, basicAuth);

const requireSameOrigin = sameOrigin();
const requireWriteGuard = (req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  return requireSameOrigin(req, res, (err) => {
    if (err) return next(err);
    return writeLimiter(req, res, next);
  });
};

app.use(express.static(config.publicDir));
app.use('/api/devices', requireWriteGuard, devicesRouter);
app.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  return requireWriteGuard(req, res, next);
}, tagsRouter);
app.use((req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  return requireWriteGuard(req, res, next);
}, dataRouter);
app.use(statusRouter);
app.use(wakeRouter);

app.use((err, _req, res, _next) => {
  logger.error('Unhandled error', { error: err.message });
  res.status(500).json({ success: false, message: 'Erreur interne' });
});

function start() {
  getDb();
  const poller = getPoller({ intervalMs: config.statusPollMs, timeoutMs: 800 });
  poller.start();

  const server = app.listen(config.port, () => {
    logger.info(`Spark running on port ${config.port}`, {
      authEnabled: !!(config.auth.user && config.auth.pass),
    });
  });

  const shutdown = (signal) => {
    logger.info(`Received ${signal}, shutting down`);
    poller.stop();
    server.close(() => {
      closeDb();
      process.exit(0);
    });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

if (require.main === module) {
  start();
}

module.exports = { app, start };
