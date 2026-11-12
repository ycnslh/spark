const pino = require('pino');

const isDev = process.env.NODE_ENV !== 'production' && process.env.NODE_ENV !== 'test';
const isTest = process.env.NODE_ENV === 'test';
const level = (process.env.LOG_LEVEL || (isTest ? 'silent' : 'info')).toLowerCase();

// Retirer toute query string, y compris dans les messages d'erreur, avant Pino.
// Les clés sensibles sont aussi masquées si un objet de requête est journalisé.
function redact(value, seen = new WeakSet()) {
  if (typeof value === 'string') return value.replace(/\?[^\s"'<>]*/g, '?[REDACTED]');
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (value instanceof Error) {
    return { name: value.name, message: redact(value.message), stack: redact(value.stack) };
  }
  if (Array.isArray(value)) return value.map((item) => redact(item, seen));
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      /^(token|authorization|cookie)$/i.test(key) ? '[REDACTED]' : redact(item, seen),
    ])
  );
}

const baseOptions = {
  level,
  base: { app: 'spark' },
  hooks: {
    logMethod(args, method) {
      return method.apply(
        this,
        args.map((arg) => redact(arg))
      );
    },
  },
};

// Le flux pretty direct évite un worker lors de la fermeture des ressources natives
// SQLite sous Node 26. Les logs de développement sont écrits avant la sortie.
const destination = isDev
  ? require('pino-pretty')({
      sync: true,
      translateTime: 'SYS:standard',
      ignore: 'pid,hostname,app',
    })
  : undefined;

const logger = pino(baseOptions, destination);

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
    const c = logger.child(redact(bindings));
    return {
      debug: (msg, meta) => (meta ? c.debug(meta, msg) : c.debug(msg)),
      info: (msg, meta) => (meta ? c.info(meta, msg) : c.info(msg)),
      warn: (msg, meta) => (meta ? c.warn(meta, msg) : c.warn(msg)),
      error: (msg, meta) => (meta ? c.error(meta, msg) : c.error(msg)),
    };
  },
  raw: logger,
};
