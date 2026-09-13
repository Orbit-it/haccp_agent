// Simule une imprimante réseau (ESC/POS ou DYMO) pour tester l'agent en
// local sans matériel : écoute sur un port TCP et affiche ce qu'elle reçoit.
// Usage: node scripts/mock-printer.js [port]
const net = require('net');

const port = parseInt(process.argv[2] || '9100', 10);

const server = net.createServer((socket) => {
  console.log(`🖨️  Imprimante simulée: connexion de ${socket.remoteAddress}:${socket.remotePort}`);
  socket.on('data', (data) => {
    console.log(`\n--- ${data.length} octets reçus ---`);
    console.log('Texte brut  :', data.toString('utf8').replace(/[\x00-\x1F]/g, '.'));
    console.log('Hex (début) :', data.subarray(0, 64).toString('hex'));
  });
  socket.on('end', () => console.log('🖨️  Connexion terminée'));
});

server.listen(port, () => {
  console.log(`🖨️  Imprimante simulée en écoute sur le port ${port}`);
});
