#!/bin/bash
# Installe l'agent local HACCP comme service systemd sur Linux.
#
# Usage :
#   sudo ./install/install.sh --backend-url https://votre-backend.example.com \
#                              --agent-key <clé fournie par le backend lors de l'enrôlement> \
#                              [--name "Nom de l'agent"] [--install-dir /opt/haccp-agent]
#
# Doit être exécuté depuis la racine du dépôt agent (déjà cloné / extrait
# d'une release), avec Node.js >= 18 installé sur la machine.

set -euo pipefail

INSTALL_DIR="/opt/haccp-agent"
SERVICE_USER="haccp-agent"
AGENT_NAME="$(hostname)"
BACKEND_URL=""
AGENT_KEY=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --backend-url) BACKEND_URL="$2"; shift 2 ;;
    --agent-key) AGENT_KEY="$2"; shift 2 ;;
    --name) AGENT_NAME="$2"; shift 2 ;;
    --install-dir) INSTALL_DIR="$2"; shift 2 ;;
    *) echo "Option inconnue: $1"; exit 1 ;;
  esac
done

if [[ "$EUID" -ne 0 ]]; then
  echo "Ce script doit être exécuté en root (sudo ./install/install.sh ...)." >&2
  exit 1
fi

if [[ -z "$BACKEND_URL" || -z "$AGENT_KEY" ]]; then
  echo "Usage: sudo ./install/install.sh --backend-url <url> --agent-key <clé> [--name <nom>] [--install-dir <chemin>]" >&2
  echo "" >&2
  echo "La clé d'agent s'obtient depuis le backend : POST /api/agents (rôle administrateur)." >&2
  exit 1
fi

if ! command -v node >/dev/null 2>&1; then
  echo "Node.js n'est pas installé. Installez Node.js >= 18 avant de continuer" >&2
  echo "(voir https://github.com/nodesource/distributions pour les paquets officiels)." >&2
  exit 1
fi

NODE_MAJOR=$(node -e "console.log(process.versions.node.split('.')[0])")
if [[ "$NODE_MAJOR" -lt 18 ]]; then
  echo "Node.js >= 18 requis (version détectée: $(node -v))" >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

echo "==> Création de l'utilisateur système dédié ($SERVICE_USER)..."
if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  useradd --system --home-dir "$INSTALL_DIR" --shell /usr/sbin/nologin "$SERVICE_USER"
fi
# Accès aux ports série (USB) et Bluetooth appairé
for grp in dialout bluetooth; do
  if getent group "$grp" >/dev/null 2>&1; then
    usermod -aG "$grp" "$SERVICE_USER"
  fi
done

echo "==> Copie de l'agent vers $INSTALL_DIR..."
mkdir -p "$INSTALL_DIR"
rsync -a --delete \
  --exclude='.git' --exclude='node_modules' --exclude='agent-config.json' \
  --exclude='data' --exclude='versions' --exclude='agent.env' \
  "$SCRIPT_DIR"/ "$INSTALL_DIR"/

echo "==> Installation des dépendances npm..."
(cd "$INSTALL_DIR" && npm install --omit=dev --no-audit --no-fund)

echo "==> Écriture de la configuration ($INSTALL_DIR/agent.env)..."
cat > "$INSTALL_DIR/agent.env" <<EOF
HACCP_BACKEND_URL=$BACKEND_URL
HACCP_AGENT_KEY=$AGENT_KEY
HACCP_AGENT_NAME=$AGENT_NAME
HACCP_AGENT_HOME=$INSTALL_DIR/state
EOF
chmod 600 "$INSTALL_DIR/agent.env"

mkdir -p "$INSTALL_DIR/state"
chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"

echo "==> Installation du service systemd..."
cp "$INSTALL_DIR/install/haccp-agent.service" /etc/systemd/system/haccp-agent.service
systemctl daemon-reload
systemctl enable --now haccp-agent

echo ""
echo "✅ Agent HACCP installé et démarré (service: haccp-agent)"
echo "   Statut  : systemctl status haccp-agent"
echo "   Logs    : journalctl -u haccp-agent -f"
echo "   Config  : $INSTALL_DIR/agent.env"
