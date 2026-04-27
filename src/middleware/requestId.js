const crypto = require('crypto');

function requestId(req, res, next) {
  const incoming = req.get('X-Request-Id');
  const id = incoming && /^[\w-]{8,128}$/.test(incoming) ? incoming : crypto.randomUUID();
  req.id = id;
  res.set('X-Request-Id', id);
  next();
}

module.exports = { requestId };
