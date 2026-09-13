#!/bin/bash
# Désinstalle le service systemd de l'agent HACCP (Linux).
# Usage: sudo ./install/uninstall.sh [--purge]
#   --purge : supprime aussi /opt/haccp-agent et l'utilisateur système dédié

set -euo pipefail

INSTALL_DIR="/opt/haccp-agent"
SERVICE_USER="haccp-agent"
PURGE=false

[[ "${1:-}" == "--purge" ]] && PURGE=true

if [[ "$EUID" -ne 0 ]]; then
  echo "Ce script doit être exécuté en root (sudo ./install/uninstall.sh)." >&2
  exit 1
fi

echo "==> Arrêt et désactivation du service..."
systemctl stop haccp-agent 2>/dev/null || true
systemctl disable haccp-agent 2>/dev/null || true
rm -f /etc/systemd/system/haccp-agent.service
systemctl daemon-reload

if $PURGE; then
  echo "==> Suppression de $INSTALL_DIR et de l'utilisateur $SERVICE_USER..."
  rm -rf "$INSTALL_DIR"
  id "$SERVICE_USER" >/dev/null 2>&1 && userdel "$SERVICE_USER" || true
  echo "✅ Agent HACCP entièrement supprimé"
else
  echo "✅ Service désinstallé (fichiers conservés dans $INSTALL_DIR, relancez avec --purge pour tout supprimer)"
fi
