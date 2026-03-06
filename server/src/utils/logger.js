const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 };
const CURRENT_LEVEL = LOG_LEVELS[process.env.LOG_LEVEL] ?? LOG_LEVELS.info;

function formatMessage(level, message, meta) {
  const timestamp = new Date().toISOString();
  const base = `[${timestamp}] [${level.toUpperCase()}] ${message}`;
  return meta ? `${base} ${JSON.stringify(meta)}` : base;
}

const logger = {
  debug(msg, meta) {
    if (CURRENT_LEVEL <= LOG_LEVELS.debug) console.debug(formatMessage("debug", msg, meta));
  },
  info(msg, meta) {
    if (CURRENT_LEVEL <= LOG_LEVELS.info) console.info(formatMessage("info", msg, meta));
  },
  warn(msg, meta) {
    if (CURRENT_LEVEL <= LOG_LEVELS.warn) console.warn(formatMessage("warn", msg, meta));
  },
  error(msg, meta) {
    if (CURRENT_LEVEL <= LOG_LEVELS.error) console.error(formatMessage("error", msg, meta));
  },
};

export default logger;
