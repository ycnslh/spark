const express = require('express');
const helmet = require('helmet');
const path = require('path');

const config = require('./config');
const logger = require('./utils/logger');
const { basicAuth } = require('./middleware/auth');
const { getDb, closeDb } = require('./services/db');

const devicesRouter = require('./routes/devices');
const wakeRouter = require('./routes/wake');
const healthRouter = require('./routes/health');
const statusRouter = require('./routes/status');

const app = express();

app.set('trust proxy', 1);
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://cdnjs.cloudflare.com'],
        fontSrc: ["'self'", 'https://cdnjs.cloudflare.com'],
        scriptSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
      },
    },
  })
);
app.use(express.json({ limit: '16kb' }));

app.use('/health', healthRouter);

app.use(basicAuth);

app.use(express.static(config.publicDir));
app.use('/api/devices', devicesRouter);
app.use(statusRouter);
app.use(wakeRouter);

app.use((err, _req, res, _next) => {
  logger.error('Unhandled error', { error: err.message });
  res.status(500).json({ success: false, message: 'Erreur interne' });
});

function start() {
  getDb();
  const server = app.listen(config.port, () => {
    logger.info(`Spark running on port ${config.port}`, {
      authEnabled: !!(config.auth.user && config.auth.pass),
    });
  });

  const shutdown = (signal) => {
    logger.info(`Received ${signal}, shutting down`);
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
