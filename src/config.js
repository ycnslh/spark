const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const wolRepeatDelayMs = Number(process.env.WOL_REPEAT_DELAY_MS ?? 2000);
const sseMaxClients = Number(process.env.SSE_MAX_CLIENTS ?? 20);

if (process.env.NODE_ENV === 'production' && process.env.AUTH_PASS === 'changeme') {
  throw new Error('AUTH_PASS=changeme est interdit en production. Configurez un mot de passe sûr.');
}

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
  wol: {
    broadcast: process.env.WOL_BROADCAST?.trim() || null,
    allInterfaces: process.env.WOL_ALL_INTERFACES !== 'false',
    repeatDelayMs:
      Number.isInteger(wolRepeatDelayMs) && wolRepeatDelayMs >= 0 ? wolRepeatDelayMs : 2000,
    port: parseInt(process.env.WOL_PORT, 10) || 9,
  },
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
  scheduler: {
    enabled: process.env.SCHEDULER_ENABLED !== 'false',
    timeZone: process.env.SCHEDULER_TZ?.trim() || undefined,
  },
  sseMaxClients: Number.isSafeInteger(sseMaxClients) && sseMaxClients > 0 ? sseMaxClients : 20,
};
