# Installe l'agent local HACCP comme service Windows (via NSSM).
#
# Usage (PowerShell en Administrateur) :
#   .\install\install.ps1 -BackendUrl "https://votre-backend.example.com" `
#                          -AgentKey "<clé fournie par le backend>" `
#                          [-AgentName "Nom de l'agent"] [-InstallDir "C:\Program Files\HaccpAgent"]
#
# Doit être exécuté depuis la racine du dépôt agent (déjà cloné / extrait
# d'une release), avec Node.js >= 18 installé sur la machine.

param(
  [Parameter(Mandatory=$true)] [string]$BackendUrl,
  [Parameter(Mandatory=$true)] [string]$AgentKey,
  [string]$AgentName = $env:COMPUTERNAME,
  [string]$InstallDir = "C:\Program Files\HaccpAgent",
  [string]$ServiceName = "HaccpAgent"
)

$ErrorActionPreference = "Stop"

function Assert-Admin {
  $current = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($current)
  if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Error "Ce script doit être exécuté dans un PowerShell Administrateur."
    exit 1
  }
}

Assert-Admin

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Error "Node.js n'est pas installé. Installez Node.js >= 18 depuis https://nodejs.org avant de continuer."
  exit 1
}

$nodeMajor = (node -e "console.log(process.versions.node.split('.')[0])")
if ([int]$nodeMajor -lt 18) {
  Write-Error "Node.js >= 18 requis (version détectée: $(node -v))"
  exit 1
}

$ScriptDir = Split-Path -Parent $PSScriptRoot
if (-not $ScriptDir) { $ScriptDir = (Get-Item (Split-Path -Parent $PSCommandPath)).Parent.FullName }

Write-Host "==> Copie de l'agent vers $InstallDir..."
New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
robocopy $ScriptDir $InstallDir /E /XD .git node_modules data versions /XF agent-config.json agent.env *.log | Out-Null

Write-Host "==> Installation des dépendances npm..."
Push-Location $InstallDir
npm install --omit=dev --no-audit --no-fund
Pop-Location

$StateDir = Join-Path $InstallDir "state"
New-Item -ItemType Directory -Force -Path $StateDir | Out-Null

# --- NSSM (Non-Sucking Service Manager) : wrapper de service pour un exécutable classique ---
$NssmPath = Join-Path $InstallDir "nssm.exe"
if (-not (Test-Path $NssmPath)) {
  Write-Host "==> Téléchargement de NSSM..."
  $NssmZip = Join-Path $env:TEMP "nssm.zip"
  Invoke-WebRequest -Uri "https://nssm.cc/release/nssm-2.24.zip" -OutFile $NssmZip
  Expand-Archive -Path $NssmZip -DestinationPath $env:TEMP -Force
  $arch = if ([Environment]::Is64BitOperatingSystem) { "win64" } else { "win32" }
  Copy-Item (Join-Path $env:TEMP "nssm-2.24\$arch\nssm.exe") $NssmPath
}

Write-Host "==> Installation du service Windows ($ServiceName)..."
# On n'appelle stop/remove que si le service existe déjà (sinon NSSM affiche une
# boîte de dialogue "Impossible d'ouvrir le service" qui bloque le script tant
# qu'on ne clique pas OK, même si l'erreur est en réalité anodine).
if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) {
  Write-Host "==> Service existant détecté, arrêt/suppression avant réinstallation..."
  & $NssmPath stop $ServiceName | Out-Null
  Start-Sleep -Seconds 1
  & $NssmPath remove $ServiceName confirm | Out-Null
}

$NodeExe = (Get-Command node).Source
& $NssmPath install $ServiceName $NodeExe "`"$InstallDir\src\launcher.js`""
if ($LASTEXITCODE -ne 0) {
  Write-Error "nssm install a échoué (code $LASTEXITCODE). Vérifiez qu'aucune fenêtre 'Services' ou 'gestionnaire de tâches' ne bloque le service, puis relancez."
  exit 1
}
& $NssmPath set $ServiceName AppDirectory $InstallDir
& $NssmPath set $ServiceName DisplayName "HACCP Local Agent"
& $NssmPath set $ServiceName Description "Pont imprimantes reseau/USB/Bluetooth pour l'application HACCP"
& $NssmPath set $ServiceName Start SERVICE_AUTO_START
& $NssmPath set $ServiceName AppEnvironmentExtra `
  "HACCP_BACKEND_URL=$BackendUrl" `
  "HACCP_AGENT_KEY=$AgentKey" `
  "HACCP_AGENT_NAME=$AgentName" `
  "HACCP_AGENT_HOME=$StateDir"
& $NssmPath set $ServiceName AppStdout (Join-Path $StateDir "agent.log")
& $NssmPath set $ServiceName AppStderr (Join-Path $StateDir "agent.log")
& $NssmPath set $ServiceName AppRotateFiles 1

& $NssmPath start $ServiceName

Write-Host ""
Write-Host "✅ Agent HACCP installé et démarré (service Windows: $ServiceName)"
Write-Host "   Statut : Get-Service $ServiceName"
Write-Host "   Logs   : $StateDir\agent.log"
Write-Host ""
Write-Host "Note Bluetooth : appairez l'imprimante depuis les paramètres Bluetooth Windows," 
Write-Host "elle apparaîtra comme un port COM ; utilisez alors le driver 'escpos_usb' ou 'dymo_usb'"
Write-Host "avec ce port COM comme connection_config.path côté backend."
