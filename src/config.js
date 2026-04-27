const path = require('path');

const rootDir = path.resolve(__dirname, '..');

module.exports = {
  rootDir,
  port: parseInt(process.env.PORT, 10) || 3000,
  publicDir: path.join(rootDir, 'public'),
  dataDir: path.join(rootDir, 'data'),
  dbPath: process.env.DB_PATH || path.join(rootDir, 'data', 'spark.db'),
  legacyCsvPath: path.join(rootDir, 'devices.csv'),
  auth: {
    user: process.env.AUTH_USER || null,
    pass: process.env.AUTH_PASS || null,
  },
  logLevel: process.env.LOG_LEVEL || 'info',
  trustProxy: process.env.TRUST_PROXY
    ? parseInt(process.env.TRUST_PROXY, 10) || process.env.TRUST_PROXY
    : 0,
  wakeRateLimit: {
    windowMs: 60 * 1000,
    max: parseInt(process.env.WAKE_RATE_LIMIT, 10) || 10,
  },
  authRateLimit: {
    windowMs: 60 * 1000,
    max: parseInt(process.env.AUTH_RATE_LIMIT, 10) || 5,
  },
  pingTimeoutMs: 60_000,
  pingIntervalMs: 5_000,
  statusPollMs: 30_000,
};
