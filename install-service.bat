@echo off
setlocal EnableDelayedExpansion

cd /d "%~dp0"

echo.
echo   ==================================================
echo      ICHTUS SERVER - NSSM SERVICE INSTALLER
echo   ==================================================

:: ──────────────────────────────────────────
::  Helper: download en extract NSSM
::  Wordt aangeroepen vanuit sectie 3 als NSSM niet
::  gevonden is. Staat bovenaan zodat endlocal hem niet
::  kan onderbreken.
:: ──────────────────────────────────────────
:download_nssm
set "NSSM_URL=https://nssm.cc/release/nssm-%NSSM_VER%.zip"
set "NSSM_ZIP=%NSSM_TEMP_DIR%\nssm-%NSSM_VER%.zip"

echo.
echo   NSSM downloaden...
echo   URL: !NSSM_URL!

if not exist "%NSSM_TEMP_DIR%" mkdir "%NSSM_TEMP_DIR%" >nul 2>&1

:: Download via PowerShell Invoke-WebRequest (Windows 7+)
powershell -NoProfile -Command ^
    "try { Invoke-WebRequest -Uri '!NSSM_URL!' -OutFile '!NSSM_ZIP!' -UseBasicParsing -ErrorAction Stop } catch { Write-Host ('   [POWERSHELL] Download mislukt: ' + $_.Exception.Message); exit 1 }"
if !errorlevel! neq 0 (
    echo   [ERROR] Download mislukt. Controleer internetverbinding of firewall.
    exit /b 1
)
echo   [OK] ZIP gedownload (~300 KB)

:: Extract via PowerShell Expand-Archive (PowerShell 5.0+ / Windows 10+)
echo   Uitpakken...
powershell -NoProfile -Command ^
    "try { Expand-Archive -Path '!NSSM_ZIP!' -DestinationPath '%NSSM_TEMP_DIR%' -Force -ErrorAction Stop } catch { Write-Host ('   [POWERSHELL] Extractie mislukt: ' + $_.Exception.Message); exit 1 }"
if !errorlevel! neq 0 (
    echo   [ERROR] Extractie mislukt. PowerShell 5.0+ ^>= Windows 10 vereist.
    exit /b 1
)

set "NSSM_PATH=%NSSM_TEMP_DIR%\nssm-%NSSM_VER%\!NSSM_ARCH_DIR!\nssm.exe"
if not exist "!NSSM_PATH!" (
    echo   [ERROR] nssm.exe niet gevonden op:
    echo           !NSSM_PATH!
    exit /b 1
)

:: Verwijder zip om ruimte te besparen (folder met binaries blijft)
del "!NSSM_ZIP!" >nul 2>&1

echo   [OK] NSSM !NSSM_VER! ^(!NSSM_ARCH_DIR!^) geinstalleerd in nssm_temp\
exit /b 0

echo.

:: ──────────────────────────────────────────
::  1. nssm-service.json aanwezig?
:: ──────────────────────────────────────────
if not exist "nssm-service.json" (
    echo   [ERROR] nssm-service.json niet gevonden.
    echo.
    echo   Kopieer nssm-service.example.json naar nssm-service.json
    echo   en pas de paden aan jouw installatie aan.
    pause
    exit /b 1
)

:: ──────────────────────────────────────────
::  2. Node.js aanwezig?
:: ──────────────────────────────────────────
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo   [ERROR] Node.js niet gevonden. Installeer Node.js LTS.
    pause
    exit /b 1
)

for /f "tokens=* delims= " %%i in ('node --version') do set NODE_VER=%%i
echo   [NODE] !NODE_VER! gevonden

for /f "delims=" %%i in ('where node') do (
    set "NODE_EXE=%%i"
    goto :node_found
)
:node_found
echo   [NODE] Locatie: !NODE_EXE!
echo.

:: ──────────────────────────────────────────
::  3. NSSM zoeken of automatisch downloaden
:: ──────────────────────────────────────────
set "NSSM_VER=2.24"
set "NSSM_TEMP_DIR=%CD%\nssm_temp"

:: Architectuur detecteren (win64 voor AMD64/ARM64, anders win32)
for /f "delims=" %%A in ('powershell -NoProfile -Command "$a=$env:PROCESSOR_ARCHITECTURE; if($a -eq 'AMD64' -or $a -eq 'ARM64'){'win64'}else{'win32'}"') do set NSSM_ARCH_DIR=%%A

set "NSSM_PATH="

:: 3a. nssm-service.json -^> nssmPath
for /f "delims=" %%i in ('powershell -NoProfile -Command "(Get-Content -Raw nssm-service.json ^|^ ConvertFrom-Json).nssmPath"') do set NSSM_PATH=%%i

:: 3b. nssm.exe op PATH
if "!NSSM_PATH!"=="" (
    where nssm >nul 2>&1
    if !errorlevel!==0 (
        for /f "delims=" %%i in ('where nssm') do (
            set "NSSM_PATH=%%i"
            goto :nssm_ready
        )
    )
)

:: 3c. Reeds gedownloade kopie in nssm_temp
if "!NSSM_PATH!"=="" (
    if exist "%NSSM_TEMP_DIR%\nssm-%NSSM_VER%\!NSSM_ARCH_DIR!\nssm.exe" (
        set "NSSM_PATH=%NSSM_TEMP_DIR%\nssm-%NSSM_VER%\!NSSM_ARCH_DIR!\nssm.exe"
        echo   [NSSM] Gevonden in nssm_temp\ (hergebruikt)
    )
)

:: 3d. Automatische download als alles mislukt
if "!NSSM_PATH!"=="" (
    echo.
    echo   [INFO] nssm.exe niet gevonden op deze PC.
    echo.
    echo   Automatisch downloaden en plaatsen in dit project?
    echo     Bron:    https://nssm.cc/release/nssm-%NSSM_VER%.zip
    echo     Locatie: nssm_temp\nssm-%NSSM_VER%\!NSSM_ARCH_DIR!\nssm.exe
    echo     Grootte: ~300 KB
    echo.
    set /p DL_CHOICE="   Downloaden nu? (J/N) > "
    if /i not "!DL_CHOICE!"=="J" (
        echo.
        echo   [ERROR] Geen NSSM. Installeer handmatig:
        echo           1. Download nssm-%NSSM_VER%.zip van https://nssm.cc/download
        echo           2. Plaats nssm.exe ergens op je PC
        echo           3. Pas nssm-service.json -^> nssmPath aan.
        pause
        exit /b 1
    )
    call :download_nssm
    if !errorlevel! neq 0 (
        pause
        exit /b 1
    )
)

:nssm_ready
if not exist "!NSSM_PATH!" (
    echo   [ERROR] NSSM niet gevonden op "!NSSM_PATH!"
    pause
    exit /b 1
)

echo   [NSSM] !NSSM_PATH!

:: Service config inlezen
for /f "delims=" %%i in ('powershell -NoProfile -Command "(Get-Content -Raw nssm-service.json ^|^ ConvertFrom-Json).serviceName"') do set SVC_NAME=%%i
for /f "delims=" %%i in ('powershell -NoProfile -Command "(Get-Content -Raw nssm-service.json ^|^ ConvertFrom-Json).serviceDisplayName"') do set SVC_DISPLAY=%%i
for /f "delims=" %%i in ('powershell -NoProfile -Command "(Get-Content -Raw nssm-service.json ^|^ ConvertFrom-Json).serviceDescription"') do set SVC_DESC=%%i
for /f "delims=" %%i in ('powershell -NoProfile -Command "(Get-Content -Raw nssm-service.json ^|^ ConvertFrom-Json).stdoutLog"') do set LOG_OUT=%%i
for /f "delims=" %%i in ('powershell -NoProfile -Command "(Get-Content -Raw nssm-service.json ^|^ ConvertFrom-Json).stderrLog"') do set LOG_ERR=%%i

echo   [SVC]  !SVC_NAME! ^(!SVC_DISPLAY!^)
echo.

:: ──────────────────────────────────────────
::  4. Log directory aanmaken
:: ──────────────────────────────────────────
for %%L in ("!LOG_OUT!" "!LOG_ERR!") do (
    for %%D in ("%%~dpL") do (
        if not exist "%%~fd" mkdir "%%~fd" >nul 2>&1
    )
)

:: ──────────────────────────────────────────
::  5. Service bestaat al?
:: ──────────────────────────────────────────
sc query !SVC_NAME! >nul 2>&1
if !errorlevel!==0 (
    echo   [WARN] Service !SVC_NAME! bestaat al.
    echo.
    echo   Wil je de service opnieuw installeren?
    echo   (Stopt en verwijdert eerst de bestaande service)
    set /p REINSTALL="   J/N > "
    if /i not "!REINSTALL!"=="J" (
        echo.
        echo   [INFO] Installatie afgebroken.
        pause
        exit /b 0
    )
    echo.
    echo   Bestaande service stoppen en verwijderen...
    call "!NSSM_PATH!" stop !SVC_NAME! >nul 2>&1
    timeout /t 2 /nobreak >nul
    call "!NSSM_PATH!" remove !SVC_NAME! confirm >nul 2>&1
    echo   [OK] Bestaande service verwijderd
)

:: ──────────────────────────────────────────
::  6. Service installeren
:: ──────────────────────────────────────────
echo.
echo   Service installeren...

call "!NSSM_PATH!" install !SVC_NAME! "!NODE_EXE!" "src\server.js"
if !errorlevel! neq 0 (
    echo   [ERROR] nssm install mislukt.
    pause
    exit /b 1
)

call "!NSSM_PATH!" set !SVC_NAME! DisplayName "!SVC_DISPLAY!"
call "!NSSM_PATH!" set !SVC_NAME! Description "!SVC_DESC!"
call "!NSSM_PATH!" set !SVC_NAME! AppDirectory "%CD%"
call "!NSSM_PATH!" set !SVC_NAME! Start SERVICE_AUTO_START
call "!NSSM_PATH!" set !SVC_NAME! AppRestartDelay 2000
call "!NSSM_PATH!" set !SVC_NAME! AppExit Default Restart
call "!NSSM_PATH!" set !SVC_NAME! AppStdout "!LOG_OUT!"
call "!NSSM_PATH!" set !SVC_NAME! AppStderr "!LOG_ERR!"
call "!NSSM_PATH!" set !SVC_NAME! AppStdoutCreationDisposition Append
call "!NSSM_PATH!" set !SVC_NAME! AppStderrCreationDisposition Append
call "!NSSM_PATH!" set !SVC_NAME! AppRotateFiles 1
call "!NSSM_PATH!" set !SVC_NAME! AppRotateBytes 5242880
call "!NSSM_PATH!" set !SVC_NAME! AppRotateSeconds 0

:: ──────────────────────────────────────────
::  7. Environment variabelen
:: ──────────────────────────────────────────
echo.
echo   Environment variabelen instellen...

:: Bouw KEY=VALUE,KEY=VALUE string uit het JSON-bestand
for /f "delims=" %%L in ('powershell -NoProfile -Command "$env = (Get-Content -Raw nssm-service.json ^| ConvertFrom-Json).env; if ($env) { $env.PSObject.Properties ^| ForEach-Object { '{0}={1}' -f $_.Name, $_.Value } ^| ConvertTo-Json -Compress }"') do set "ENV_PAIRS=%%L"

set "ENV_STR=!ENV_PAIRS!"
set "ENV_STR=!ENV_STR:[=!"
set "ENV_STR=!ENV_STR:]=!"
set "ENV_STR=!ENV_STR:"=!"

if not "!ENV_STR!"=="" (
    call "!NSSM_PATH!" set !SVC_NAME! AppEnvironmentExtra !ENV_STR!
    echo   [OK] Env: !ENV_STR!
) else (
    echo   [INFO] Geen environment variabelen gevonden in nssm-service.json.
)

:: ──────────────────────────────────────────
::  8. Service starten
:: ──────────────────────────────────────────
echo.
echo   Service starten...
call "!NSSM_PATH!" start !SVC_NAME!
if !errorlevel! neq 0 (
    echo   [WARN] Service startte niet automatisch. Probeer handmatig:
    echo          nssm start !SVC_NAME!
) else (
    echo   [OK] Service gestart
)

echo.
echo   ==================================================
echo   Installatie voltooid.
echo.
echo   Beheer via NSSM:
echo     nssm status    !SVC_NAME!
echo     nssm start     !SVC_NAME!
echo     nssm stop      !SVC_NAME!
echo     nssm restart   !SVC_NAME!
echo.
echo   Of in services.msc: zoek op "!SVC_DISPLAY!"
echo.
echo   Logs:
echo     !LOG_OUT!
echo     !LOG_ERR!
echo.
echo   Portable NSSM locatie (verplaats het project NIET
echo   zonder deze folder mee te verhuizen):
echo     !NSSM_PATH!
echo   ==================================================
echo.
pause
endlocal
