const pino = require('pino');

const isDev = process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test';
const isTest = process.env.NODE_ENV === 'test';
const level = (process.env.LOG_LEVEL || (isTest ? 'silent' : 'info')).toLowerCase();

const baseOptions = { level, base: { app: 'spark' } };

const transport = isDev
  ? {
      transport: {
        target: 'pino-pretty',
        options: { translateTime: 'SYS:standard', ignore: 'pid,hostname,app' },
      },
    }
  : {};

const logger = pino({ ...baseOptions, ...transport });

function wrap(method) {
  return (msg, meta) => {
    if (meta && typeof meta === 'object') {
      logger[method](meta, msg);
    } else {
      logger[method](msg);
    }
  };
}

module.exports = {
  debug: wrap('debug'),
  info: wrap('info'),
  warn: wrap('warn'),
  error: wrap('error'),
  child: (bindings) => {
    const c = logger.child(bindings);
    return {
      debug: (msg, meta) => (meta ? c.debug(meta, msg) : c.debug(msg)),
      info: (msg, meta) => (meta ? c.info(meta, msg) : c.info(msg)),
      warn: (msg, meta) => (meta ? c.warn(meta, msg) : c.warn(msg)),
      error: (msg, meta) => (meta ? c.error(meta, msg) : c.error(msg)),
    };
  },
  raw: logger,
};
