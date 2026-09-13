# HACCP Agent

Agent local à installer sur une machine connectée au réseau d'un
établissement (mini-PC, Raspberry Pi, PC dédié...). Il fait le pont entre
le backend central HACCP et les imprimantes de l'établissement :

- **Imprimantes à ticket** (ESC/POS, dont Vretti) en réseau, USB ou Bluetooth (SPP)
- **Imprimantes d'étiquettes DYMO** en réseau ou USB
- Extensible à d'autres marques/modèles **sans toucher au backend** : il
  suffit d'ajouter un nouveau pilote dans `src/drivers/` et de redéployer
  l'agent (voir [Architecture](#architecture-des-pilotes))

L'agent tourne en permanence comme **service système** (systemd sur Linux,
service Windows via NSSM), se reconnecte automatiquement au backend, met en
file les impressions en cas de coupure, et **se met à jour seul** depuis les
GitHub Releases de ce dépôt.

## Sommaire

- [Architecture](#architecture)
- [Installation en production](#installation-en-production)
- [Configuration](#configuration)
- [Test en local sans matériel](#test-en-local-sans-matériel)
- [Architecture des pilotes](#architecture-des-pilotes)
- [Mise à jour automatique](#mise-à-jour-automatique)
- [Publier une nouvelle version](#publier-une-nouvelle-version)
- [Dépannage](#dépannage)

## Architecture

```
src/
  index.js            Worker : logique métier de l'agent (démarré par le launcher)
  launcher.js          Processus stable installé comme service, supervise le
                        worker et applique les mises à jour automatiques
  core/
    config.js          Chargement config (fichier + variables d'environnement)
    logger.js           Logger minimal avec niveaux
    registry.js         Registre des imprimantes connues (synchronisé depuis le backend)
    jobQueue.js          File d'impression persistée sur disque, avec retry
    backendLink.js       Connexion WebSocket au backend (reconnexion, heartbeat)
    httpServer.js         API HTTP locale (impression directe LAN, statut)
    discovery.js          Beacon UDP pour la découverte réseau locale
    updater.js             Vérification/téléchargement/vérification des mises à jour
  drivers/
    index.js             Registre driver_type -> transport + protocole
    transports/           network.js (TCP), usbSerial.js (série/USB), bluetooth.js (SPP)
    protocols/             escpos.js (tickets), dymoLabel.js (étiquettes DYMO)
install/
  haccp-agent.service    Unité systemd (Linux)
  install.sh / uninstall.sh
  install.ps1 / uninstall.ps1   (Windows, via NSSM)
.github/workflows/release.yml  Publie une release (archive + checksums) sur un tag vX.Y.Z
```

L'agent se connecte au backend en WebSocket (`/agent-ws`, authentifié par une
clé d'agent), reçoit les jobs d'impression à mesure qu'ils sont créés, les
imprime via le pilote adapté, et renvoie le résultat. Il expose aussi une
petite API HTTP locale (`/status`, `/print`) pour que le front web ou
l'application mobile puissent imprimer **directement sur le réseau local**,
sans dépendre de la latence/disponibilité d'internet.

## Installation en production

### Prérequis

- Un agent doit d'abord être **enrôlé côté backend** par un administrateur :
  `POST /api/agents` (voir README du backend) → renvoie une **clé d'agent**
  à usage unique, à utiliser ci-dessous.
- Node.js ≥ 18 installé sur la machine cible.

### Linux (systemd)

```bash
git clone https://github.com/Orbit-it/haccp_agent.git
cd haccp_agent
sudo ./install/install.sh \
  --backend-url https://votre-backend.example.com \
  --agent-key <clé obtenue lors de l'enrôlement> \
  --name "Cuisine - Établissement Centre"
```

Le script crée un utilisateur système dédié, installe l'agent dans
`/opt/haccp-agent`, et l'enregistre comme service (`haccp-agent`) démarré
automatiquement au boot.

```bash
systemctl status haccp-agent      # état du service
journalctl -u haccp-agent -f      # logs en direct
sudo ./install/uninstall.sh       # désinstaller (--purge pour tout supprimer)
```

### Windows (service via NSSM)

Dans un PowerShell **Administrateur** :

```powershell
git clone https://github.com/Orbit-it/haccp_agent.git
cd haccp_agent
.\install\install.ps1 -BackendUrl "https://votre-backend.example.com" `
                       -AgentKey "<clé obtenue lors de l'enrôlement>" `
                       -AgentName "Cuisine - Établissement Centre"
```

Le script installe l'agent dans `C:\Program Files\HaccpAgent`, télécharge
NSSM si besoin, et crée le service Windows `HaccpAgent` (démarrage
automatique).

```powershell
Get-Service HaccpAgent
Get-Content "C:\Program Files\HaccpAgent\state\agent.log" -Wait
.\install\uninstall.ps1 -Purge
```

## Configuration

La configuration se fait par variables d'environnement (prioritaires) ou par
un fichier JSON (`agent-config.json`, chemin donné par `HACCP_AGENT_CONFIG`
ou par défaut `<HACCP_AGENT_HOME>/agent-config.json`) :

| Variable | Défaut | Description |
|---|---|---|
| `HACCP_BACKEND_URL` | `http://localhost:3050` | URL du backend central |
| `HACCP_AGENT_KEY` | *(requis)* | Clé d'agent obtenue à l'enrôlement |
| `HACCP_AGENT_NAME` | nom de la machine | Nom affiché côté backend |
| `HACCP_AGENT_HTTP_PORT` | `8743` | Port de l'API HTTP locale (LAN) |
| `HACCP_AGENT_DISCOVERY_PORT` | `41235` | Port UDP du beacon de découverte |
| `HACCP_AGENT_HOME` | `~/.haccp-agent` | Racine des données (config/queue/versions) |
| `HACCP_AGENT_UPDATE_REPO` | `Orbit-it/haccp_agent` | Dépôt GitHub surveillé pour les mises à jour |
| `HACCP_AGENT_UPDATE_INTERVAL_MS` | `1800000` (30 min) | Fréquence de vérification des mises à jour |
| `LOG_LEVEL` | `info` | `error` / `warn` / `info` / `debug` |

## Test en local sans matériel

Une imprimante réseau simulée est fournie pour tester sans matériel physique :

```bash
npm install
node scripts/mock-printer.js 9100     # simule une imprimante réseau sur le port 9100
```

Dans un autre terminal, démarrez le worker en pointant vers votre backend de
dev, avec une imprimante `driver_type: escpos_network` configurée sur
`{ "host": "127.0.0.1", "port": 9100 }` (créée via `POST /api/printers`) :

```bash
HACCP_BACKEND_URL=http://localhost:3050 \
HACCP_AGENT_KEY=<clé de test> \
node src/index.js
```

Créez ensuite un job (`POST /api/print-jobs`) depuis le backend : l'agent le
reçoit en temps réel, génère les commandes ESC/POS, et le terminal de
`mock-printer.js` affiche les octets reçus (utile pour vérifier le rendu).

## Architecture des pilotes

Un pilote = un **transport** (comment on parle au matériel) + un
**protocole** (quoi on lui envoie), assemblés dans `src/drivers/index.js` :

| `driver_type` (backend) | Transport | Protocole |
|---|---|---|
| `escpos_network` | TCP (port 9100 en général) | ESC/POS (ticket) |
| `escpos_bluetooth` | Bluetooth SPP (`rfcomm bind` sur Linux) | ESC/POS (ticket) |
| `escpos_usb` | Port série (USB, ou COM Bluetooth sous Windows) | ESC/POS (ticket) |
| `dymo_network` | TCP (port 9100) | DYMO DLS/XML (étiquette) |
| `dymo_usb` | Port série | DYMO DLS/XML (étiquette) |

**Ajouter une nouvelle imprimante ESC/POS compatible** (une autre marque que
Vretti) ne nécessite **aucune migration ni modification du backend** :
créez simplement le `driver_type` correspondant côté `printers.driver_type`
et, si le transport n'existe pas déjà, ajoutez-le dans
`src/drivers/transports/` puis enregistrez la combinaison dans
`src/drivers/index.js` via `registerDriver(type, factory)`.

## Mise à jour automatique

Le `launcher.js` (celui installé comme service) :

1. Démarre le `worker` (`src/index.js`) sur la version active.
2. Vérifie périodiquement (`HACCP_AGENT_UPDATE_INTERVAL_MS`) la dernière
   [GitHub Release](https://github.com/Orbit-it/haccp_agent/releases) du dépôt.
3. Si une version plus récente existe : télécharge l'archive
   `haccp-agent-vX.Y.Z.tar.gz`, **vérifie son empreinte SHA-256** contre
   `checksums.txt` (rejette la mise à jour si elle ne correspond pas),
   l'installe dans `versions/X.Y.Z/`, exécute `npm install`, puis redémarre
   le worker sur cette nouvelle version.

Aucune intervention manuelle n'est nécessaire sur les postes déployés :
publier une nouvelle release GitHub suffit à mettre à jour tous les agents
en quelques minutes.

## Publier une nouvelle version

1. Mettre à jour `"version"` dans `package.json`.
2. Committer, puis créer un tag correspondant :
   ```bash
   git tag v0.2.0
   git push origin v0.2.0
   ```
3. Le workflow `.github/workflows/release.yml` construit l'archive source,
   génère `checksums.txt`, et publie automatiquement la GitHub Release.

## Dépannage

- **`Erreur connexion backend: 401`** : clé d'agent invalide ou révoquée
  (agent supprimé côté backend) → ré-enrôler l'agent et mettre à jour
  `HACCP_AGENT_KEY`.
- **Bluetooth : `rfcomm: command not found`** (Linux) : installez
  `bluez-utils` (ou équivalent selon la distribution).
- **`serialport` non installé** : dépendance optionnelle nécessitant des
  outils de compilation natifs. Sans elle, seuls les transports réseau
  fonctionnent ; les transports USB/série et Bluetooth échouent avec un
  message explicite (voir `src/drivers/transports/usbSerial.js`).
- **Le job reste "pending" côté backend** : l'agent n'est pas connecté
  (vérifier `journalctl -u haccp-agent -f` / `Get-Service HaccpAgent`). Le
  job sera automatiquement envoyé dès la reconnexion.
