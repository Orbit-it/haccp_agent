const LEVELS = { error: 0, warn: 1, info: 2, debug: 3 };

function createLogger(prefix, level = process.env.LOG_LEVEL || 'info') {
  const threshold = LEVELS[level] ?? LEVELS.info;

  function log(levelName, ...args) {
    if (LEVELS[levelName] > threshold) return;
    const ts = new Date().toISOString();
    const tag = { error: '❌', warn: '⚠️ ', info: 'ℹ️ ', debug: '🔍' }[levelName] || '';
    // eslint-disable-next-line no-console
    console.log(`${ts} ${tag} [${prefix}]`, ...args);
  }

  return {
    error: (...args) => log('error', ...args),
    warn: (...args) => log('warn', ...args),
    info: (...args) => log('info', ...args),
    debug: (...args) => log('debug', ...args)
  };
}

module.exports = { createLogger };
