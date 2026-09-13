// Transport Bluetooth Classic (SPP) pour les imprimantes à ticket type Vretti.
//
// Plutôt que d'embarquer un binding natif Bluetooth (fragile, souvent non
// maintenu), on s'appuie sur les outils système :
//   - Linux  : `rfcomm bind` (paquet bluez-utils) expose le périphérique
//              appairé comme un port série classique /dev/rfcommX, qu'on
//              pilote ensuite avec le même code que le transport USB/série.
//   - Windows/macOS : une fois l'imprimante appairée dans les paramètres
//              Bluetooth de l'OS, elle apparaît directement comme un port
//              série virtuel (COMx / /dev/tty.*) : on utilise alors
//              directement le driver "*_usb" avec ce chemin, sans passer
//              par ce module.
const { execFile } = require('child_process');
const { sendSerial } = require('./usbSerial');

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, (error, stdout, stderr) => {
      if (error) return reject(new Error(stderr?.toString().trim() || error.message));
      resolve(stdout?.toString().trim());
    });
  });
}

// Choisit un identifiant rfcomm stable (0-9) à partir de l'adresse MAC,
// pour éviter les collisions entre plusieurs imprimantes Bluetooth.
function rfcommIdForMac(mac) {
  const lastByte = parseInt(mac.split(':').pop() || '0', 16);
  return lastByte % 10;
}

async function bindRfcomm(mac, channel = 1) {
  const id = rfcommIdForMac(mac);
  const devicePath = `/dev/rfcomm${id}`;
  await run('rfcomm', ['bind', String(id), mac, String(channel)]);
  return devicePath;
}

async function releaseRfcomm(mac) {
  const id = rfcommIdForMac(mac);
  try {
    await run('rfcomm', ['release', String(id)]);
  } catch {
    // pas grave si déjà relâché
  }
}

async function sendBluetooth({ mac, channel = 1, baudRate = 9600, timeoutMs = 8000 }, buffer) {
  if (process.platform !== 'linux') {
    throw new Error(
      'Transport Bluetooth direct non nécessaire sur cet OS : appairez l\'imprimante depuis les ' +
      'paramètres Bluetooth du système, puis utilisez le driver "*_usb" avec le port série ' +
      '(COMx / /dev/tty.*) attribué à cette imprimante.'
    );
  }

  const devicePath = await bindRfcomm(mac, channel);
  try {
    return await sendSerial({ path: devicePath, baudRate, timeoutMs }, buffer);
  } finally {
    await releaseRfcomm(mac);
  }
}

module.exports = { sendBluetooth, bindRfcomm, releaseRfcomm };
