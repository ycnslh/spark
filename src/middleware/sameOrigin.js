const logger = require('../utils/logger');

function getRequestOrigin(req) {
  const origin = req.get('Origin');
  if (origin) return origin;
  const referer = req.get('Referer');
  if (!referer) return null;
  try {
    const url = new URL(referer);
    return `${url.protocol}//${url.host}`;
  } catch {
    return null;
  }
}

function getRequestHostUrl(req) {
  const host = req.get('Host');
  if (!host) return null;
  const proto = req.protocol;
  return `${proto}://${host}`;
}

function isAppleShortcut(req) {
  const ua = req.get('User-Agent') || '';
  return /Shortcuts/i.test(ua);
}

function sameOrigin(options = {}) {
  const allowAppleShortcuts = options.allowAppleShortcuts !== false;

  return (req, res, next) => {
    if (req.method === 'GET' && allowAppleShortcuts && isAppleShortcut(req)) {
      return next();
    }

    const expected = getRequestHostUrl(req);
    const actual = getRequestOrigin(req);

    if (!actual) {
      logger.warn('Missing Origin/Referer', { path: req.path, ip: req.ip });
      return res.status(403).json({ success: false, message: 'Origin requis' });
    }
    if (actual !== expected) {
      logger.warn('Origin mismatch', { path: req.path, ip: req.ip, actual, expected });
      return res.status(403).json({ success: false, message: 'Origin invalide' });
    }
    return next();
  };
}

module.exports = { sameOrigin, getRequestOrigin, isAppleShortcut };
