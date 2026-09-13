const { loadConfig, validateConfig } = require('./core/config');
const { createLogger } = require('./core/logger');
const { PrinterRegistry } = require('./core/registry');
const { JobQueue } = require('./core/jobQueue');
const { BackendLink } = require('./core/backendLink');
const { createHttpServer } = require('./core/httpServer');
const { startDiscovery } = require('./core/discovery');
const pkg = require('../package.json');

async function main() {
  const config = loadConfig();
  const logger = createLogger('agent', config.logLevel);

  const errors = validateConfig(config);
  if (errors.length) {
    logger.error('Configuration invalide :', errors.join(', '));
    logger.error(`Éditez ${config.configPath} (ou les variables d'environnement HACCP_BACKEND_URL / HACCP_AGENT_KEY) puis relancez l'agent.`);
    process.exit(1);
  }

  logger.info(`Démarrage de l'agent HACCP v${pkg.version} (${config.agentName})`);

  const registry = new PrinterRegistry(logger);

  const backendLink = new BackendLink({
    backendUrl: config.backendUrl,
    agentKey: config.agentKey,
    version: pkg.version,
    logger
  });

  // Traite un job en le déléguant au pilote adapté à l'imprimante visée.
  async function processJob(job) {
    const printer = registry.get(job.printer.id) || job.printer;
    const driver = registry.getDriverFor(printer);
    return driver.print(job.job_type, job.payload);
  }

  const jobQueue = new JobQueue({
    dataDir: config.dataDir,
    logger,
    processFn: processJob
  });

  jobQueue.on('success', (job) => {
    logger.info(`✅ Job #${job.id} imprimé avec succès`);
    backendLink.sendJobResult(job.id, true);
  });

  jobQueue.on('failed', (job, error) => {
    logger.error(`❌ Job #${job.id} abandonné après ${job.attempts} tentatives: ${error.message}`);
    backendLink.sendJobResult(job.id, false, error.message);
  });

  backendLink.on('printers_sync', (message) => registry.sync(message.printers));

  backendLink.on('print_job', (message) => {
    logger.info(`📥 Nouveau job reçu du backend: #${message.job.id} (${message.job.job_type})`);
    if (message.printer) registry.upsert(message.printer);
    jobQueue.enqueue({ id: message.job.id, job_type: message.job.job_type, payload: message.job.payload, printer: message.printer });
  });

  // Impression directe demandée par un client du réseau local (front web /
  // appli mobile), sans passer par le backend. Utile en mode dégradé
  // (backend injoignable) ou pour des impressions purement locales.
  async function onDirectPrint({ printer_id, job_type, payload }) {
    const printer = registry.get(printer_id);
    if (!printer) throw new Error(`Imprimante #${printer_id} inconnue de cet agent`);
    const driver = registry.getDriverFor(printer);
    return driver.print(job_type, payload);
  }

  const httpServer = createHttpServer({
    port: config.httpPort,
    logger,
    registry,
    version: pkg.version,
    backendLink,
    onDirectPrint
  });

  const discovery = startDiscovery({
    port: config.discoveryPort,
    httpPort: config.httpPort,
    agentName: config.agentName,
    version: pkg.version,
    logger
  });

  backendLink.connect();

  let shuttingDown = false;
  const shutdown = () => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info('Arrêt de l\'agent...');
    discovery.stop();
    httpServer.close();
    backendLink.shutdown();
    setTimeout(() => process.exit(0), 200);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error('Erreur fatale au démarrage de l\'agent:', error);
  process.exit(1);
});
