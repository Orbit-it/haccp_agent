const fs = require('fs');
const path = require('path');
const os = require('os');

// Emplacement du fichier de config : par défaut à côté de l'exécutable
// (pratique pour une install "portable" sur un mini-PC dédié), sauf si
// HACCP_AGENT_HOME est défini (utilisé par install.sh/install.ps1) ou si
// on préfère explicitement le répertoire de l'utilisateur.
function getConfigDir() {
  if (process.env.HACCP_AGENT_HOME) return process.env.HACCP_AGENT_HOME;
  return path.join(os.homedir(), '.haccp-agent');
}

function getConfigPath() {
  return process.env.HACCP_AGENT_CONFIG || path.join(getConfigDir(), 'agent-config.json');
}

const DEFAULTS = {
  backendUrl: 'http://localhost:3050',
  agentKey: null,
  agentName: os.hostname(),
  httpPort: 8743,
  discoveryPort: 41235,
  logLevel: 'info',
  dataDir: path.join(getConfigDir(), 'data'),
  updateRepo: 'Orbit-it/Haccp_agent',
  updateCheckIntervalMs: 30 * 60 * 1000,
  versionsDir: path.join(getConfigDir(), 'versions')
};

function loadConfig() {
  const configPath = getConfigPath();
  let fileConfig = {};

  if (fs.existsSync(configPath)) {
    try {
      fileConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    } catch (error) {
      throw new Error(`Fichier de configuration invalide (${configPath}): ${error.message}`);
    }
  }

  // Les variables d'environnement priment toujours sur le fichier de config,
  // pratique pour l'installation en service (systemd EnvironmentFile / Windows service env).
  const config = {
    ...DEFAULTS,
    ...fileConfig,
    backendUrl: process.env.HACCP_BACKEND_URL || fileConfig.backendUrl || DEFAULTS.backendUrl,
    agentKey: process.env.HACCP_AGENT_KEY || fileConfig.agentKey || DEFAULTS.agentKey,
    agentName: process.env.HACCP_AGENT_NAME || fileConfig.agentName || DEFAULTS.agentName,
    httpPort: parseInt(process.env.HACCP_AGENT_HTTP_PORT || fileConfig.httpPort || DEFAULTS.httpPort, 10),
    discoveryPort: parseInt(process.env.HACCP_AGENT_DISCOVERY_PORT || fileConfig.discoveryPort || DEFAULTS.discoveryPort, 10),
    logLevel: process.env.LOG_LEVEL || fileConfig.logLevel || DEFAULTS.logLevel,
    dataDir: process.env.HACCP_AGENT_DATA_DIR || fileConfig.dataDir || DEFAULTS.dataDir,
    updateRepo: process.env.HACCP_AGENT_UPDATE_REPO || fileConfig.updateRepo || DEFAULTS.updateRepo,
    updateCheckIntervalMs: parseInt(process.env.HACCP_AGENT_UPDATE_INTERVAL_MS || fileConfig.updateCheckIntervalMs || DEFAULTS.updateCheckIntervalMs, 10),
    versionsDir: process.env.HACCP_AGENT_VERSIONS_DIR || fileConfig.versionsDir || DEFAULTS.versionsDir
  };

  config.configPath = configPath;
  return config;
}

function saveConfig(partialConfig) {
  const configPath = getConfigPath();
  const dir = path.dirname(configPath);
  fs.mkdirSync(dir, { recursive: true });

  let current = {};
  if (fs.existsSync(configPath)) {
    current = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  }

  const merged = { ...current, ...partialConfig };
  fs.writeFileSync(configPath, JSON.stringify(merged, null, 2));
  return merged;
}

function validateConfig(config) {
  const errors = [];
  if (!config.backendUrl) errors.push('backendUrl manquant');
  if (!config.agentKey) errors.push('agentKey manquant (clé générée lors de l\'enrôlement de l\'agent depuis le backend)');
  return errors;
}

module.exports = { loadConfig, saveConfig, getConfigDir, getConfigPath, validateConfig, DEFAULTS };
