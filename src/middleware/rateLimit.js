const rateLimit = require('express-rate-limit');
const config = require('../config');

const noop = (_req, _res, next) => next();
const isTest = process.env.NODE_ENV === 'test' || process.env.RATE_LIMIT_DISABLED === '1';

function makeLimiter(opts) {
  if (isTest) return noop;
  return rateLimit({ standardHeaders: true, legacyHeaders: false, ...opts });
}

const wakeRateLimiter = makeLimiter({
  windowMs: config.wakeRateLimit.windowMs,
  max: config.wakeRateLimit.max,
  message: { success: false, message: 'Trop de requêtes, réessaie dans une minute.' },
});

const authFailureLimiter = makeLimiter({
  windowMs: config.authRateLimit.windowMs,
  max: config.authRateLimit.max,
  skipSuccessfulRequests: true,
  message: { success: false, message: "Trop d'échecs d'authentification." },
});

const writeLimiter = makeLimiter({
  windowMs: 60 * 1000,
  max: 30,
  message: { success: false, message: 'Trop de requêtes.' },
});

module.exports = { wakeRateLimiter, authFailureLimiter, writeLimiter };
