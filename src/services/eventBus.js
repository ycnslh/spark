const { EventEmitter } = require('node:events');

// Partagé entre les routes de réveil et les flux SSE.
module.exports = new EventEmitter();
