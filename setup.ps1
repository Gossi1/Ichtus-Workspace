<#
  Ichtus Workspace — one-shot installer
  -------------------------------------
  Veilig om meerdere keren te draaien (idempotent).

  Doet het volgende automatisch:
    1. Controleert winget, Git en Node.js — installeert ze via 'winget' indien nodig
    2. Clone't de repository naar InstallPath (default: C:\Ichtus_apps)
    3. npm install (overslaan als node_modules al klopt)
    4. Kopieert nssm-service.example.json naar nssm-service.json
    5. Draait install-service.bat — registreert IchtusServer als Windows-service
       (downloadt NSSM automatisch als het niet gevonden wordt)

  Gebruik:
    powershell -ExecutionPolicy Bypass -File setup.ps1
    powershell -ExecutionPolicy Bypass -File setup.ps1 -InstallPath D:\MijnApps\Ichtus
    irm https://raw.githubusercontent.com/Gossi1/Ichtus-Workspace/master/setup.ps1 | iex

  Vereisten: Windows 10/11 + admin-rechten (voor winget + service-registratie).
#>

[CmdletBinding()]
param(
    [string]$InstallPath = "C:\Ichtus_apps",
    [string]$RepoUrl = "https://github.com/Gossi1/Ichtus-Workspace.git",
    [string]$Branch = "master",
    [switch]$SkipWinget,    # Sla Git/Node-install over (bv. handmatig geinstalleerd)
    [switch]$SkipClone,     # Ga uit van een bestaande map (handig bij re-runs)
    [switch]$SkipService    # Installeer dependencies maar registreer geen service
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'  # Sneller; we echo'en zelf status
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::UTF8

function Write-Section($title) {
    Write-Host ""
    Write-Host "=== $title ===" -ForegroundColor Cyan
}
function Write-Ok($msg)     { Write-Host "  [OK] $msg" -ForegroundColor Green }
function Write-Warn($msg)   { Write-Host "  [WARN] $msg" -ForegroundColor Yellow }
function Write-Err($msg)    { Write-Host "  [ERROR] $msg" -ForegroundColor Red }
function Write-Info($msg)   { Write-Host "  [INFO] $msg" -ForegroundColor Gray }

# ──────────────────────────────────────────────────────────────────
#  Pre-flight: draaien we als admin?
# ──────────────────────────────────────────────────────────────────
$isAdmin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Err "Dit script vereist admin-rechten."
    Write-Info "Open PowerShell via 'Als administrator uitvoeren' en probeer opnieuw."
    exit 1
}

# ──────────────────────────────────────────────────────────────────
#  Banner
# ──────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  ==================================================" -ForegroundColor White
Write-Host "      ICHTUS WORKSPACE - ONE-SHOT INSTALLER" -ForegroundColor White
Write-Host "  ==================================================" -ForegroundColor White
Write-Host "  Doelmap:    $InstallPath"
Write-Host "  Repository: $RepoUrl"
Write-Host "  =================================================="

# ──────────────────────────────────────────────────────────────────
#  Stap 1 — winget / Git / Node.js
# ──────────────────────────────────────────────────────────────────
Write-Section "Stap 1 — Git en Node.js controleren"

$hasWinget = [bool](Get-Command winget -ErrorAction SilentlyContinue)
if (-not $hasWinget) {
    Write-Warn "winget niet gevonden op deze PC."
    Write-Info "Installeer 'App Installer' vanuit de Microsoft Store, of installeer Git en Node.js handmatig."
    Write-Info "(Git: https://git-scm.com/download/win — Node.js LTS: https://nodejs.org/)"
    if (-not $SkipWinget) {
        Write-Err "Stop — herstart dit script met -SkipWinget als je Git en Node al handmatig hebt geinstalleerd."
        exit 1
    }
}

function Install-IfMissing {
    param([string]$Tool, [string]$WingetId)
    $cmd = Get-Command $Tool -ErrorAction SilentlyContinue
    if ($cmd) {
        $ver = & $Tool --version 2>$null | Select-Object -First 1
        Write-Ok "$Tool gevonden — $ver"
        return
    }
    if ($SkipWinget) {
        Write-Warn "$Tool ontbreekt en -SkipWinget is gezet — ga verder en hoop dat het pad later pakt."
        return
    }
    if (-not $hasWinget) {
        Write-Err "$Tool ontbreekt maar winget ook — installeer $Tool handmatig."
        exit 1
    }
    Write-Info "$Tool installeren via winget (kan ~1 min duren)..."
    winget install --id $WingetId -e --source winget --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) {
        Write-Err "Installatie van $Tool mislukt (exit $LASTEXITCODE)."
        exit 1
    }
    # PATH herladen zodat de zojuist geinstalleerde tool direct werkt
    $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path","User")
    $cmd = Get-Command $Tool -ErrorAction SilentlyContinue
    if (-not $cmd) {
        Write-Err "$Tool is geinstalleerd maar niet vindbaar in het PATH van deze shell."
        Write-Info "Open een nieuwe admin-PowerShell en draai dit script opnieuw."
        exit 1
    }
    Write-Ok "$Tool geinstalleerd — $((& $Tool --version 2>$null | Select-Object -First 1))"
}

Install-IfMissing -Tool git  -WingetId "Git.Git"
Install-IfMissing -Tool node -WingetId "OpenJS.NodeJS.LTS"

# Extra node-modules die we nodig hebben voor de X32 / mic-iem modules
# (zijn optioneel; we laten ze voor de setup zelf niet breken)
$nodeVer = (& node --version 2>$null).Trim()
if ($nodeVer -notmatch 'v(\d+)\.') {
    Write-Err "Node.js niet detecteerbaar na installatie."
    exit 1
}
$nodeMajor = [int]$Matches[1]
if ($nodeMajor -lt 18) {
    Write-Err "Node.js $nodeVer is te oud — vereist 18 of nieuwer."
    exit 1
}
Write-Ok "Node.js $nodeVer voldoet (>= 18)"

# ──────────────────────────────────────────────────────────────────
#  Stap 2 — Repository ophalen
# ──────────────────────────────────────────────────────────────────
Write-Section "Stap 2 — Code ophalen"

if ($SkipClone) {
    Write-Info "-SkipClone gezet — ga uit van een bestaande map."
    if (-not (Test-Path $InstallPath)) {
        Write-Err "$InstallPath bestaat niet."
        exit 1
    }
} elseif (Test-Path "$InstallPath\.git") {
    Write-Ok "Git repo gevonden in $InstallPath — overslaan klonen, wel even `git pull` draaien"
    Push-Location $InstallPath
    try {
        & git pull --ff-only 2>$null
        if ($LASTEXITCODE -ne 0) {
            Write-Warn "`git pull` faalde — niet kritisch als je deze setup al had draaien."
        } else {
            Write-Ok "Code bijgewerkt"
        }
    } finally { Pop-Location }
} else {
    if (Test-Path $InstallPath) {
        Write-Err "$InstallPath bestaat maar is geen Git repo. Kies een andere -InstallPath of verwijder de map."
        exit 1
    }
    Write-Info "Klonen naar $InstallPath ..."
    # git clone maakt de doelmap (en parents) zelf aan. Geen New-Item nodig
    # — dat struikelt over paden als 'C:\'.
    & git clone --branch $Branch $RepoUrl $InstallPath
    if ($LASTEXITCODE -ne 0) {
        Write-Err "Klonen mislukt (exit $LASTEXITCODE)."
        exit 1
    }
    Write-Ok "Repo gekloond"
}

Push-Location $InstallPath
try {
    # ──────────────────────────────────────────────────────────────
    #  Stap 3 — npm install
    # ──────────────────────────────────────────────────────────────
    Write-Section "Stap 3 — npm install"

    if (Test-Path "node_modules") {
        $pkgHashCurrent  = (Get-FileHash package.json -Algorithm SHA256).Hash
        $pkgHashOld      = $null
        if (Test-Path ".setup-pkg-hash") {
            $pkgHashOld = (Get-Content ".setup-pkg-hash" -Raw).Trim()
        }
        if ($pkgHashCurrent -eq $pkgHashOld) {
            Write-Ok "node_modules up-to-date (hash match) — overslaan npm install"
        } else {
            Write-Info "package.json is gewijzigd — `npm install` opnieuw draaien..."
            & npm install
            if ($LASTEXITCODE -ne 0) { Write-Err "npm install mislukt"; exit 1 }
            $pkgHashCurrent | Out-File ".setup-pkg-hash" -Encoding ASCII
            Write-Ok "Dependencies bijgewerkt"
        }
    } else {
        Write-Info "`npm install` (~1-2 min, internet nodig)..."
        & npm install
        if ($LASTEXITCODE -ne 0) { Write-Err "npm install mislukt"; exit 1 }
        (Get-FileHash package.json -Algorithm SHA256).Hash | Out-File ".setup-pkg-hash" -Encoding ASCII
        Write-Ok "Dependencies geinstalleerd"
    }

    # ──────────────────────────────────────────────────────────────
    #  Stap 4 — NSSM service config + service registratie
    # ──────────────────────────────────────────────────────────────
    Write-Section "Stap 4 — NSSM service"

    if (-not (Test-Path "nssm-service.json")) {
        if (Test-Path "nssm-service.example.json") {
            Copy-Item "nssm-service.example.json" "nssm-service.json"
            Write-Ok "nssm-service.json aangemaakt (defaults zijn OK voor de meeste setups)"
        } else {
            Write-Err "nssm-service.example.json ontbreekt — repository klopt niet."
            exit 1
        }
    } else {
        Write-Ok "nssm-service.json bestaat al — overslaan"
    }

    if (-not $SkipService) {
        if (-not (Test-Path "install-service.bat")) {
            Write-Err "install-service.bat ontbreekt — repository klopt niet."
            exit 1
        }
        Write-Info "install-service.bat draaien (downloadt evt. NSSM en registreert de service)..."
        & .\install-service.bat
        if ($LASTEXITCODE -ne 0) {
            Write-Err "install-service.bat faalde — zie output hierboven."
            exit 1
        }
    } else {
        Write-Info "-SkipService gezet — service wordt niet geregistreerd. Draai later: install-service.bat"
    }
} finally { Pop-Location }

# ──────────────────────────────────────────────────────────────────
#  Einde
# ──────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "  ==================================================" -ForegroundColor Green
Write-Host "    INSTALLATIE VOLTOOID" -ForegroundColor Green
Write-Host "  ==================================================" -ForegroundColor Green
Write-Host "  Locatie:  $InstallPath"
Write-Host "  Service:  IchtusServer  (Windows-services.msc)"
Write-Host "  Browser:  http://localhost:8080/Ichtus_SPA/"
Write-Host ""
Write-Host "  Onderhoud:"
Write-Host "    Updates ophalen + herstart:  nssm restart IchtusServer"
Write-Host "    Status:                       nssm status  IchtusServer"
Write-Host "    Logs:                         %TEMP%\IchtusServer-stdout.log"
Write-Host "    Verwijderen:                  uninstall-service.bat"
Write-Host "  ==================================================" -ForegroundColor Green
Write-Host ""
