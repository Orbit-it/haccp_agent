const path = require('path');
const { spawn } = require('child_process');
const { loadConfig } = require('./core/config');
const { createLogger } = require('./core/logger');
const { checkAndApplyUpdate, getActiveAgentDir } = require('./core/updater');

// Processus stable installé comme service système (systemd / service Windows).
// Son seul rôle : surveiller/relancer le worker (src/index.js, la vraie
// logique de l'agent) et appliquer les mises à jour publiées sur GitHub
// Releases sans jamais nécessiter de désinstallation/réinstallation manuelle
// sur le poste du restaurant.
const BOOTSTRAP_DIR = path.join(__dirname, '..');
const RESPAWN_DELAY_MS = 5000;

function main() {
  const config = loadConfig();
  const logger = createLogger('launcher', config.logLevel);

  let child = null;
  let shuttingDown = false;

  function resolveActiveDir() {
    return getActiveAgentDir({ versionsDir: config.versionsDir, bootstrapDir: BOOTSTRAP_DIR });
  }

  function resolveActiveVersion(activeDir) {
    // eslint-disable-next-line global-require
    return require(path.join(activeDir, 'package.json')).version;
  }

  function spawnWorker() {
    const activeDir = resolveActiveDir();
    const version = resolveActiveVersion(activeDir);
    logger.info(`Démarrage du worker v${version} (${activeDir})`);

    child = spawn(process.execPath, [path.join(activeDir, 'src', 'index.js')], {
      cwd: activeDir,
      env: process.env,
      stdio: 'inherit'
    });

    child.on('exit', (code, signal) => {
      child = null;
      if (shuttingDown) return;

      logger.warn(`Worker arrêté (code=${code}, signal=${signal}), redémarrage dans ${RESPAWN_DELAY_MS / 1000}s...`);
      setTimeout(spawnWorker, RESPAWN_DELAY_MS);
    });
  }

  async function runUpdateCheck() {
    try {
      const activeDir = resolveActiveDir();
      const currentVersion = resolveActiveVersion(activeDir);
      const newDir = await checkAndApplyUpdate({
        repo: config.updateRepo,
        versionsDir: config.versionsDir,
        currentVersion,
        logger
      });

      if (newDir && child) {
        logger.info('Redémarrage du worker pour appliquer la mise à jour...');
        child.kill('SIGTERM'); // déclenche le respawn automatique sur la nouvelle version
      }
    } catch (error) {
      logger.error('Vérification de mise à jour échouée:', error.message);
    }
  }

  spawnWorker();
  runUpdateCheck();
  const updateTimer = setInterval(runUpdateCheck, config.updateCheckIntervalMs);

  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    clearInterval(updateTimer);
    logger.info('Arrêt du launcher...');
    if (child) child.kill('SIGTERM');
    setTimeout(() => process.exit(0), 500);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main();
