const http = require('http');

// API HTTP locale, exposée sur le réseau du restaurant : permet au front web
// et à l'appli mobile Capacitor de discuter DIRECTEMENT avec l'agent (sans
// repasser par le backend central), pour une impression rapide même si la
// connexion internet du restaurant est momentanément coupée.
function createHttpServer({ port, logger, registry, version, backendLink, onDirectPrint }) {
  const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }

    const [route] = req.url.split('?');

    if (req.method === 'GET' && route === '/status') {
      return sendJson(res, 200, {
        success: true,
        version,
        connectedToBackend: backendLink.connected,
        printers: registry.list().map((p) => ({ id: p.id, name: p.name, driver_type: p.driver_type }))
      });
    }

    if (req.method === 'POST' && route === '/print') {
      const body = await readJsonBody(req).catch(() => null);
      if (!body || !body.printer_id || !body.job_type || !body.payload) {
        return sendJson(res, 400, { success: false, message: 'printer_id, job_type et payload requis' });
      }

      try {
        const result = await onDirectPrint(body);
        return sendJson(res, 200, { success: true, data: result });
      } catch (error) {
        return sendJson(res, 500, { success: false, message: error.message });
      }
    }

    sendJson(res, 404, { success: false, message: 'Route non trouvée' });
  });

  server.listen(port, () => {
    logger.info(`Serveur HTTP local démarré sur le port ${port} (accessible depuis le réseau local)`);
  });

  return server;
}

function sendJson(res, status, obj) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => { data += chunk; });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

module.exports = { createHttpServer };
