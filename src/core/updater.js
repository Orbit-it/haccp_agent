const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const axios = require('axios');
const tar = require('tar');
const { execFile } = require('child_process');

// Auto-update de l'agent depuis les GitHub Releases du dépôt.
//
// Principe : chaque release publie une archive source unique
// `haccp-agent-vX.Y.Z.tar.gz` (le même code tourne sur Windows/Linux/macOS,
// seules les dépendances optionnelles natives changent) accompagnée d'un
// `checksums.txt` (sha256). Le launcher télécharge, vérifie l'empreinte,
// extrait dans versions/<version>/, installe les dépendances avec npm, puis
// bascule un pointeur "version courante" avant de relancer le worker.

function compareVersions(a, b) {
  const pa = a.replace(/^v/, '').split('.').map(Number);
  const pb = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff > 0 ? 1 : -1;
  }
  return 0;
}

async function getLatestRelease(repo) {
  const res = await axios.get(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: { 'User-Agent': 'haccp-agent-launcher' },
    timeout: 10000
  });
  return res.data;
}

async function downloadToFile(url, destPath) {
  const writer = fs.createWriteStream(destPath);
  const res = await axios.get(url, {
    responseType: 'stream',
    headers: { 'User-Agent': 'haccp-agent-launcher' },
    timeout: 30000
  });
  await new Promise((resolve, reject) => {
    res.data.pipe(writer);
    writer.on('finish', resolve);
    writer.on('error', reject);
  });
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

function parseChecksums(content) {
  // Format attendu (comme `sha256sum` classique) : "<hash>  <filename>"
  const map = {};
  for (const line of content.split('\n')) {
    const match = line.trim().match(/^([a-f0-9]{64})\s+\*?(.+)$/i);
    if (match) map[match[2]] = match[1].toLowerCase();
  }
  return map;
}

function npmInstall(cwd) {
  return new Promise((resolve, reject) => {
    execFile('npm', ['install', '--omit=dev', '--no-audit', '--no-fund'], { cwd, timeout: 5 * 60 * 1000 }, (error, stdout, stderr) => {
      if (error) return reject(new Error(stderr?.toString() || error.message));
      resolve(stdout?.toString());
    });
  });
}

// Vérifie s'il existe une release plus récente que `currentVersion` et
// l'applique si oui. Retourne le chemin du nouveau dossier de version
// (à utiliser pour le prochain démarrage du worker), ou null si déjà à jour.
async function checkAndApplyUpdate({ repo, versionsDir, currentVersion, logger }) {
  const release = await getLatestRelease(repo);
  const latestVersion = release.tag_name.replace(/^v/, '');

  if (compareVersions(latestVersion, currentVersion) <= 0) {
    logger.debug(`Déjà à jour (version courante ${currentVersion}, dernière release ${latestVersion})`);
    return null;
  }

  logger.info(`🆕 Nouvelle version disponible: ${latestVersion} (actuelle: ${currentVersion})`);

  const tarballAsset = release.assets.find((a) => a.name === `haccp-agent-v${latestVersion}.tar.gz`);
  const checksumsAsset = release.assets.find((a) => a.name === 'checksums.txt');
  if (!tarballAsset) throw new Error(`Aucune archive trouvée dans la release ${latestVersion}`);

  const tmpDir = path.join(versionsDir, '.tmp');
  fs.mkdirSync(tmpDir, { recursive: true });
  const tarballPath = path.join(tmpDir, tarballAsset.name);

  logger.info('Téléchargement de la nouvelle version...');
  await downloadToFile(tarballAsset.browser_download_url, tarballPath);

  if (checksumsAsset) {
    const checksumsRes = await axios.get(checksumsAsset.browser_download_url, { headers: { 'User-Agent': 'haccp-agent-launcher' } });
    const checksums = parseChecksums(checksumsRes.data);
    const expected = checksums[tarballAsset.name];
    const actual = await sha256File(tarballPath);
    if (!expected || expected !== actual) {
      fs.rmSync(tarballPath, { force: true });
      throw new Error(`Empreinte SHA-256 invalide pour ${tarballAsset.name} (mise à jour rejetée par sécurité)`);
    }
    logger.info('✅ Empreinte SHA-256 vérifiée');
  } else {
    logger.warn('⚠️  Pas de checksums.txt dans la release : mise à jour appliquée sans vérification d\'intégrité');
  }

  const versionDir = path.join(versionsDir, latestVersion);
  fs.rmSync(versionDir, { recursive: true, force: true });
  fs.mkdirSync(versionDir, { recursive: true });

  logger.info('Extraction...');
  await tar.x({ file: tarballPath, cwd: versionDir, strip: 1 });
  fs.rmSync(tarballPath, { force: true });

  logger.info('Installation des dépendances (npm install)...');
  await npmInstall(versionDir);

  fs.writeFileSync(path.join(versionsDir, 'current.json'), JSON.stringify({ version: latestVersion, path: versionDir }, null, 2));

  logger.info(`✅ Mise à jour ${latestVersion} prête, redémarrage du worker sur cette version`);
  return versionDir;
}

// Résout le dossier de l'agent actuellement actif : la dernière version
// installée via update si elle existe, sinon la version "bootstrap" livrée
// avec l'installation initiale (celle qui contient ce fichier).
function getActiveAgentDir({ versionsDir, bootstrapDir }) {
  const currentPath = path.join(versionsDir, 'current.json');
  if (fs.existsSync(currentPath)) {
    try {
      const { path: dir } = JSON.parse(fs.readFileSync(currentPath, 'utf8'));
      if (dir && fs.existsSync(path.join(dir, 'src', 'index.js'))) return dir;
    } catch {
      // fichier corrompu, on retombe sur le bootstrap
    }
  }
  return bootstrapDir;
}

module.exports = { compareVersions, checkAndApplyUpdate, getActiveAgentDir };
