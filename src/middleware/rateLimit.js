const rateLimit = require('express-rate-limit');
const config = require('../config');

const wakeRateLimiter = rateLimit({
  windowMs: config.wakeRateLimit.windowMs,
  max: config.wakeRateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Trop de requêtes, réessaie dans une minute.' },
});

module.exports = { wakeRateLimiter };
