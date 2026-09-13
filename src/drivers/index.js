// Registre des pilotes d'imprimantes : associe un `driver_type` (défini côté
// backend, voir printers.driver_type) à une combinaison transport+protocole.
//
// Ajouter le support d'une nouvelle imprimante (une autre marque ESC/POS
// compatible, un nouveau modèle DYMO, etc.) ne nécessite QUE de modifier ce
// fichier (ou d'enregistrer un nouveau driver via registerDriver) et de
// redéployer l'agent — aucune migration ni modification du backend requise,
// tant que le type de job ('ticket' ou 'label') reste le même.

const network = require('./transports/network');
const usbSerial = require('./transports/usbSerial');
const bluetooth = require('./transports/bluetooth');
const escpos = require('./protocols/escpos');
const dymoLabel = require('./protocols/dymoLabel');

const registry = new Map();

function registerDriver(type, factory) {
  registry.set(type, factory);
}

function createDriver(type, connectionConfig = {}) {
  const factory = registry.get(type);
  if (!factory) {
    throw new Error(`Type de pilote inconnu: "${type}". Types disponibles: ${[...registry.keys()].join(', ')}`);
  }
  return factory(connectionConfig);
}

function buildPayloadBuffer(jobType, protocolModule, payload) {
  if (jobType === 'ticket') return protocolModule.escpos.buildTicket(payload);
  if (jobType === 'label') return protocolModule.dymoLabel.buildLabel(payload);
  throw new Error(`job_type non supporté: "${jobType}"`);
}

// --- ESC/POS (tickets) ---------------------------------------------------

registerDriver('escpos_network', ({ host, port = 9100 }) => ({
  async print(jobType, payload) {
    const buffer = buildPayloadBuffer(jobType, { escpos, dymoLabel }, payload);
    return network.sendTcp({ host, port }, buffer);
  },
  async testConnection() {
    return network.testTcpConnection({ host, port });
  }
}));

registerDriver('escpos_bluetooth', ({ mac, channel = 1, baudRate = 9600 }) => ({
  async print(jobType, payload) {
    const buffer = buildPayloadBuffer(jobType, { escpos, dymoLabel }, payload);
    return bluetooth.sendBluetooth({ mac, channel, baudRate }, buffer);
  },
  async testConnection() {
    try {
      await bluetooth.bindRfcomm(mac, channel);
      await bluetooth.releaseRfcomm(mac);
      return { success: true, message: 'Appairage Bluetooth OK' };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }
}));

registerDriver('escpos_usb', ({ path, baudRate = 9600 }) => ({
  async print(jobType, payload) {
    const buffer = buildPayloadBuffer(jobType, { escpos, dymoLabel }, payload);
    return usbSerial.sendSerial({ path, baudRate }, buffer);
  },
  async testConnection() {
    try {
      const ports = await usbSerial.listSerialPorts();
      const found = ports.some((p) => p.path === path);
      return { success: found, message: found ? 'Port détecté' : 'Port non trouvé parmi les périphériques série' };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }
}));

// --- DYMO (étiquettes) ----------------------------------------------------

registerDriver('dymo_network', ({ host, port = 9100 }) => ({
  async print(jobType, payload) {
    const buffer = buildPayloadBuffer(jobType, { escpos, dymoLabel }, payload);
    return network.sendTcp({ host, port }, buffer);
  },
  async testConnection() {
    return network.testTcpConnection({ host, port });
  }
}));

registerDriver('dymo_usb', ({ path, baudRate = 9600 }) => ({
  async print(jobType, payload) {
    const buffer = buildPayloadBuffer(jobType, { escpos, dymoLabel }, payload);
    return usbSerial.sendSerial({ path, baudRate }, buffer);
  },
  async testConnection() {
    try {
      const ports = await usbSerial.listSerialPorts();
      const found = ports.some((p) => p.path === path);
      return { success: found, message: found ? 'Port détecté' : 'Port non trouvé parmi les périphériques série' };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }
}));

module.exports = { createDriver, registerDriver, knownTypes: () => [...registry.keys()] };
