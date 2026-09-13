const net = require('net');

// Transport TCP générique : utilisé pour les imprimantes ESC/POS et DYMO
// disponibles sur le réseau local (port 9100 la plupart du temps).
// Envoie un buffer et résout dès qu'une réponse arrive ou après un court
// délai d'inactivité si l'imprimante ne répond jamais (beaucoup ne le font pas).
function sendTcp({ host, port = 9100, timeoutMs = 8000, quietMs = 400 }, buffer) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let settled = false;
    let response = null;

    const finish = (err, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(hardTimeout);
      clearTimeout(quietTimer);
      socket.destroy();
      if (err) reject(err);
      else resolve(result);
    };

    const hardTimeout = setTimeout(() => {
      finish(new Error(`Timeout de connexion à ${host}:${port}`));
    }, timeoutMs);

    let quietTimer = null;
    const scheduleQuiet = () => {
      clearTimeout(quietTimer);
      quietTimer = setTimeout(() => {
        finish(null, { response, bytesSent: buffer.length });
      }, quietMs);
    };

    socket.connect(port, host, () => {
      socket.write(buffer, (err) => {
        if (err) return finish(err);
        scheduleQuiet();
      });
    });

    socket.on('data', (data) => {
      response = response ? Buffer.concat([response, data]) : data;
      scheduleQuiet();
    });

    socket.on('error', (err) => finish(err));
    socket.on('close', () => {
      if (!settled) finish(null, { response, bytesSent: buffer.length });
    });
  });
}

function testTcpConnection({ host, port = 9100, timeoutMs = 4000 }) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const timer = setTimeout(() => {
      socket.destroy();
      resolve({ success: false, message: 'Timeout' });
    }, timeoutMs);

    socket.connect(port, host, () => {
      clearTimeout(timer);
      socket.destroy();
      resolve({ success: true, message: 'Connexion établie' });
    });

    socket.on('error', (err) => {
      clearTimeout(timer);
      resolve({ success: false, message: err.message });
    });
  });
}

module.exports = { sendTcp, testTcpConnection };
