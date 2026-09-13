const WebSocket = require('ws');
const EventEmitter = require('events');

const HEARTBEAT_INTERVAL_MS = 25000;
const RECONNECT_DELAYS_MS = [1000, 2000, 5000, 10000, 30000];

// Connexion WebSocket persistante vers le backend central. Gère la
// reconnexion automatique avec backoff, l'authentification par agent_key,
// le heartbeat, et expose une petite API évènementielle pour le reste de
// l'agent (jobs à imprimer, synchro imprimantes).
class BackendLink extends EventEmitter {
  constructor({ backendUrl, agentKey, version, logger }) {
    super();
    this.backendUrl = backendUrl;
    this.agentKey = agentKey;
    this.version = version;
    this.logger = logger;
    this.ws = null;
    this.heartbeatTimer = null;
    this.reconnectAttempt = 0;
    this.shuttingDown = false;
    this.connected = false;
  }

  get wsUrl() {
    const url = new URL('/agent-ws', this.backendUrl);
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    return url.toString();
  }

  connect() {
    this.shuttingDown = false;
    this._open();
  }

  _open() {
    this.logger.info(`Connexion au backend: ${this.wsUrl}`);
    this.ws = new WebSocket(this.wsUrl, {
      headers: { Authorization: `Bearer ${this.agentKey}` }
    });

    this.ws.on('open', () => {
      this.connected = true;
      this.reconnectAttempt = 0;
      this.logger.info('✅ Connecté au backend');
      this._send({ type: 'hello', version: this.version });
      this._startHeartbeat();
      this.emit('connected');
    });

    this.ws.on('message', (raw) => this._handleMessage(raw));

    this.ws.on('close', (code) => {
      this.connected = false;
      this._stopHeartbeat();
      this.logger.warn(`Connexion backend fermée (code ${code})`);
      this.emit('disconnected');
      this._scheduleReconnect();
    });

    this.ws.on('error', (error) => {
      this.logger.error('Erreur connexion backend:', error.message);
    });
  }

  _handleMessage(raw) {
    let message;
    try {
      message = JSON.parse(raw.toString());
    } catch {
      return;
    }
    this.emit('message', message);
    if (message.type) this.emit(message.type, message);
  }

  _scheduleReconnect() {
    if (this.shuttingDown) return;
    const delay = RECONNECT_DELAYS_MS[Math.min(this.reconnectAttempt, RECONNECT_DELAYS_MS.length - 1)];
    this.reconnectAttempt += 1;
    this.logger.info(`Nouvelle tentative de connexion dans ${delay / 1000}s...`);
    setTimeout(() => { if (!this.shuttingDown) this._open(); }, delay);
  }

  _startHeartbeat() {
    this._stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      this._send({ type: 'heartbeat', version: this.version });
    }, HEARTBEAT_INTERVAL_MS);
  }

  _stopHeartbeat() {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  _send(obj) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  sendJobResult(jobId, success, error = null) {
    this._send({ type: 'job_result', jobId, success, error });
  }

  sendPrinterStatus(printerId, status, details = null) {
    this._send({ type: 'printer_status', printerId, status, details });
  }

  shutdown() {
    this.shuttingDown = true;
    this._stopHeartbeat();
    if (this.ws) this.ws.close();
  }
}

module.exports = { BackendLink };
