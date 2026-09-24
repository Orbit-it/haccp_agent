// Transport USB/Série : utilisé pour les imprimantes branchées en USB (vues
// comme un port série virtuel par l'OS) ET pour le Bluetooth Classic (SPP),
// puisqu'une fois appairé, un périphérique SPP apparaît lui aussi comme un
// port série (COMx sous Windows, /dev/rfcommX sous Linux, voir bluetooth.js).
//
// Dépendance optionnelle : le paquet natif `serialport` n'est chargé qu'à la
// première utilisation, pour ne jamais empêcher le démarrage de l'agent si
// la compilation native a échoué sur la machine cible (ex: pas de build tools).
let SerialPortLib = null;
function loadSerialPortLib() {
  if (SerialPortLib) return SerialPortLib;
  try {
    // eslint-disable-next-line global-require
    SerialPortLib = require('serialport').SerialPort;
    return SerialPortLib;
  } catch (error) {
    throw new Error(
      'Le module "serialport" n\'est pas installé ou n\'a pas pu être compilé sur cette machine. ' +
      'Réinstallez l\'agent avec les outils de compilation natifs (build-essential/python sous Linux, ' +
      'Visual Studio Build Tools sous Windows) pour activer le support USB/Série et Bluetooth. ' +
      `Détail: ${error.message}`
    );
  }
}

// `warmupMs` : délai après l'ouverture du port avant d'écrire. De nombreuses
// imprimantes thermiques Bluetooth (SPP) bon marché ignorent les premiers
// octets reçus juste après l'établissement de la connexion — un court délai
// évite de perdre le début du ticket.
function sendSerial({ path, baudRate = 9600, timeoutMs = 8000, quietMs = 400, warmupMs = 250 }, buffer) {
  const SerialPort = loadSerialPortLib();

  return new Promise((resolve, reject) => {
    const port = new SerialPort({ path, baudRate, autoOpen: false });
    let settled = false;
    let response = null;

    const finish = (err, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(hardTimeout);
      clearTimeout(quietTimer);
      port.close(() => {});
      if (err) reject(err);
      else resolve(result);
    };

    const hardTimeout = setTimeout(() => {
      finish(new Error(`Timeout sur le port série ${path}`));
    }, timeoutMs);

    let quietTimer = null;
    const scheduleQuiet = () => {
      clearTimeout(quietTimer);
      quietTimer = setTimeout(() => finish(null, { response, bytesSent: buffer.length }), quietMs);
    };

    port.open((err) => {
      if (err) return finish(err);
      // Laisse le temps à la liaison Bluetooth/série de se stabiliser avant
      // d'envoyer le premier octet.
      setTimeout(() => {
        if (settled) return;
        port.write(buffer, (writeErr) => {
          if (writeErr) return finish(writeErr);
          // `drain` attend que le buffer d'écriture soit réellement transmis
          // (pas seulement accepté par l'OS) avant de fermer le port : sans
          // ça, un ticket un peu long peut être tronqué sur un lien BT lent.
          port.drain((drainErr) => {
            if (drainErr) return finish(drainErr);
            scheduleQuiet();
          });
        });
      }, warmupMs);
    });

    port.on('data', (data) => {
      response = response ? Buffer.concat([response, data]) : data;
      scheduleQuiet();
    });

    port.on('error', (err) => finish(err));
  });
}

async function listSerialPorts() {
  const SerialPort = loadSerialPortLib();
  return SerialPort.list();
}

module.exports = { sendSerial, listSerialPorts };
