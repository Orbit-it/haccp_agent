# Désinstalle le service Windows de l'agent HACCP.
# Usage (PowerShell Administrateur) : .\install\uninstall.ps1 [-Purge]

param(
  [string]$InstallDir = "C:\Program Files\HaccpAgent",
  [string]$ServiceName = "HaccpAgent",
  [switch]$Purge
)

$ErrorActionPreference = "Stop"
$NssmPath = Join-Path $InstallDir "nssm.exe"

Write-Host "==> Arrêt et suppression du service $ServiceName..."
if (Test-Path $NssmPath) {
  & $NssmPath stop $ServiceName 2>$null | Out-Null
  & $NssmPath remove $ServiceName confirm 2>$null | Out-Null
} else {
  Stop-Service $ServiceName -ErrorAction SilentlyContinue
  sc.exe delete $ServiceName | Out-Null
}

if ($Purge) {
  Write-Host "==> Suppression de $InstallDir..."
  Remove-Item -Recurse -Force $InstallDir -ErrorAction SilentlyContinue
  Write-Host "✅ Agent HACCP entièrement supprimé"
} else {
  Write-Host "✅ Service désinstallé (fichiers conservés dans $InstallDir, relancez avec -Purge pour tout supprimer)"
}
