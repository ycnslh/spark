const store = require('../services/deviceStore');
const tokenStore = require('../services/tokenStore');
const { challenge } = require('./auth');

function wakeTokenAuth(req, res, next) {
  // Express associe aussi HEAD à GET : HEAD ne doit jamais contourner Basic Auth.
  if (req.method !== 'GET' || !Object.hasOwn(req.query, 'token')) return next();
  const device = store.findByNameOrMac(req.params.deviceId);
  const token = device && tokenStore.findActiveToken(req.query.token, device.id);
  if (!token) return challenge(res);
  req.wakeToken = token;
  req.wakeDevice = device;
  return next();
}

module.exports = { wakeTokenAuth };
