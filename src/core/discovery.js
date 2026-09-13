const dgram = require('dgram');

const BEACON_INTERVAL_MS = 5000;

// Découverte locale : l'agent annonce périodiquement sa présence en
// broadcast UDP sur le réseau du restaurant, et répond directement à toute
// requête de découverte explicite. Permet au front web / à l'appli mobile
// de trouver automatiquement l'agent sans configuration IP manuelle.
function startDiscovery({ port, httpPort, agentName, version, logger }) {
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
  let beaconTimer = null;

  const beaconPayload = () => Buffer.from(JSON.stringify({
    type: 'haccp-agent',
    name: agentName,
    httpPort,
    version
  }));

  socket.on('error', (error) => {
    logger.warn('Erreur découverte UDP:', error.message);
  });

  socket.on('message', (msg, rinfo) => {
    try {
      const request = JSON.parse(msg.toString());
      if (request.type === 'haccp-discover') {
        socket.send(beaconPayload(), rinfo.port, rinfo.address);
      }
    } catch {
      // paquet non-JSON, ignoré
    }
  });

  socket.bind(port, () => {
    socket.setBroadcast(true);
    logger.info(`Découverte réseau active sur le port UDP ${port}`);
    beaconTimer = setInterval(() => {
      socket.send(beaconPayload(), port, '255.255.255.255');
    }, BEACON_INTERVAL_MS);
  });

  let stopped = false;
  return {
    stop() {
      if (stopped) return;
      stopped = true;
      if (beaconTimer) clearInterval(beaconTimer);
      try {
        socket.close();
      } catch {
        // déjà fermé, rien à faire
      }
    }
  };
}

module.exports = { startDiscovery };
