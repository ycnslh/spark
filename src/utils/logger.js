const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const currentLevel = LEVELS[(process.env.LOG_LEVEL || 'info').toLowerCase()] || LEVELS.info;

function sanitize(value) {
  if (typeof value !== 'string') value = String(value);
  return value.replace(/[\r\n]+/g, ' ');
}

function emit(level, message, meta) {
  if (LEVELS[level] < currentLevel) return;
  const entry = {
    time: new Date().toISOString(),
    level: level.toUpperCase(),
    msg: sanitize(message),
    ...(meta ? { meta } : {}),
  };
  const line = `[${entry.time}] [${entry.level}] ${entry.msg}${meta ? ' ' + JSON.stringify(meta) : ''}`;
  if (level === 'error' || level === 'warn') {
    console.error(line);
  } else {
    console.log(line);
  }
}

module.exports = {
  debug: (msg, meta) => emit('debug', msg, meta),
  info: (msg, meta) => emit('info', msg, meta),
  warn: (msg, meta) => emit('warn', msg, meta),
  error: (msg, meta) => emit('error', msg, meta),
};
