const crypto = require('crypto');
const config = require('../config');
const logger = require('../utils/logger');

function timingSafeEqual(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function basicAuth(req, res, next) {
  if (!config.auth.user || !config.auth.pass) {
    return next();
  }

  const header = req.headers.authorization;
  if (!header || !header.startsWith('Basic ')) {
    return challenge(res);
  }

  let decoded;
  try {
    decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
  } catch {
    return challenge(res);
  }

  const idx = decoded.indexOf(':');
  if (idx === -1) return challenge(res);

  const user = decoded.slice(0, idx);
  const pass = decoded.slice(idx + 1);

  if (timingSafeEqual(user, config.auth.user) && timingSafeEqual(pass, config.auth.pass)) {
    req.authUser = user;
    return next();
  }

  logger.warn('Auth failed', { ip: req.ip });
  return challenge(res);
}

function challenge(res) {
  res.set('WWW-Authenticate', 'Basic realm="Spark"');
  res.status(401).send('Authentication required');
}

module.exports = { basicAuth };
