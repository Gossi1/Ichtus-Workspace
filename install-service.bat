@echo off
setlocal EnableDelayedExpansion

cd /d "%~dp0"

:: ------------------------------------------------
::  Silent mode? Zet door setup.ps1 met:
::    set AUTO_INSTALL_NSSM=1
:: ------------------------------------------------
if "%AUTO_INSTALL_NSSM%"=="1" (
    set "INTERACTIVE=0"
) else (
    set "INTERACTIVE=1"
)

:: ------------------------------------------------
::  Defaults -- altijd geldig, JSON is optioneel.
:: ------------------------------------------------
set "NSSM_VER=2.24"
set "NSSM_ARCH_DIR=win64"
set "NSSM_PATH="
set "SVC_NAME=IchtusServer"
set "SVC_DISPLAY=Ichtus Workspace Server"
set "SVC_DESC=Ichtus Workspace console server"
set "LOG_OUT=%CD%\logs\nssm-stdout.log"
set "LOG_ERR=%CD%\logs\nssm-stderr.log"

:: Arch detecteren
if "%PROCESSOR_ARCHITECTURE%"=="x86"   set "NSSM_ARCH_DIR=win32"
if "%PROCESSOR_ARCHITECTURE%"=="AMD64" set "NSSM_ARCH_DIR=win64"
if "%PROCESSOR_ARCHITECTURE%"=="ARM64" set "NSSM_ARCH_DIR=win64"

set "NSSM_TEMP_DIR=%CD%\nssm_temp"

echo.
echo   ==================================================
echo      ICHTUS SERVER - NSSM SERVICE INSTALLER
echo   ==================================================
echo.

:: =============================================
::  1. nssm-service.json aanwezig?
:: =============================================
if not exist "nssm-service.json" (
    echo   [ERROR] nssm-service.json niet gevonden.
    echo   Kopieer nssm-service.example.json naar nssm-service.json
    call :_pause
    exit /b 1
)

:: =============================================
::  2. Node.js aanwezig?
:: =============================================
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo   [ERROR] Node.js niet gevonden. Installeer Node.js LTS.
    call :_pause
    exit /b 1
)

for /f "tokens=*" %%i in ('node --version') do set "NODE_VER=%%i"
echo   [NODE] !NODE_VER! gevonden

for /f "delims=" %%i in ('where node') do (
    set "NODE_EXE=%%i"
    goto :node_found
)
:node_found
echo   [NODE] Locatie: !NODE_EXE!
echo.

:: =============================================
::  3. NSSM zoeken of downloaden
::     Prioriteit: PATH > nssm_temp > download
:: =============================================

:: 3a. NSSM op PATH (snelste, betrouwbaarste)
where nssm >nul 2>&1
if !errorlevel!==0 (
    for /f "delims=" %%i in ('where nssm') do (
        set "NSSM_PATH=%%i"
        goto :nssm_found
    )
)

:: 3b. NSSM in nssm_temp (van een vorige download)
if exist "%NSSM_TEMP_DIR%\nssm-%NSSM_VER%\!NSSM_ARCH_DIR!\nssm.exe" (
    set "NSSM_PATH=%NSSM_TEMP_DIR%\nssm-%NSSM_VER%\!NSSM_ARCH_DIR!\nssm.exe"
    echo   [NSSM] Gevonden in nssm_temp\ (hergebruikt)
    goto :nssm_found
)

:: 3c. NSSM downloaden (laatste redmiddel)
echo   [INFO] nssm.exe niet gevonden op deze PC.
echo.
if "%INTERACTIVE%"=="1" (
    set /p DL_CHOICE="   NSSM automatisch downloaden? (J/N) > "
) else (
    set "DL_CHOICE=J"
    echo   [AUTO] Download NSSM (silent mode)
)
if /i "!DL_CHOICE!"=="J" (
    call :download_nssm
    if !errorlevel! neq 0 (
        call :_pause
        exit /b 1
    )
) else (
    echo.
    echo   [ERROR] Geen NSSM. Installeer handmatig:
    echo           https://nssm.cc/download
    call :_pause
    exit /b 1
)

:nssm_found
if not exist "!NSSM_PATH!" (
    echo   [ERROR] NSSM niet gevonden op "!NSSM_PATH!"
    call :_pause
    exit /b 1
)
echo   [NSSM] !NSSM_PATH!

:: =============================================
::  4. Service config (defaults + JSON override)
:: =============================================
call :read_json_config
echo   [SVC]  !SVC_NAME! (!SVC_DISPLAY!)
echo.

:: =============================================
::  5. Log directory
:: =============================================
if not exist "%CD%\logs" mkdir "%CD%\logs" >nul 2>&1

:: =============================================
::  6. Evt. bestaande service verwijderen
:: =============================================
sc query !SVC_NAME! >nul 2>&1
if !errorlevel!==0 (
    echo   [INFO] Service !SVC_NAME! bestaat al -- verwijderen eerst...
    "!NSSM_PATH!" stop !SVC_NAME! >nul 2>&1
    timeout /t 2 /nobreak >nul
    "!NSSM_PATH!" remove !SVC_NAME! confirm >nul 2>&1
    echo   [OK] Bestaande service verwijderd
)

:: =============================================
::  7. Service installeren
:: =============================================
echo.
echo   Service installeren...

"!NSSM_PATH!" install !SVC_NAME! "!NODE_EXE!" "src\server.js"
if !errorlevel! neq 0 (
    echo   [ERROR] nssm install mislukt.
    call :_pause
    exit /b 1
)

"!NSSM_PATH!" set !SVC_NAME! DisplayName "!SVC_DISPLAY!"
"!NSSM_PATH!" set !SVC_NAME! Description "!SVC_DESC!"
"!NSSM_PATH!" set !SVC_NAME! AppDirectory "%CD%"
"!NSSM_PATH!" set !SVC_NAME! Start SERVICE_AUTO_START
"!NSSM_PATH!" set !SVC_NAME! AppRestartDelay 2000
"!NSSM_PATH!" set !SVC_NAME! AppExit Default Restart
"!NSSM_PATH!" set !SVC_NAME! AppStdout "!LOG_OUT!"
"!NSSM_PATH!" set !SVC_NAME! AppStderr "!LOG_ERR!"
"!NSSM_PATH!" set !SVC_NAME! AppRotateFiles 1
"!NSSM_PATH!" set !SVC_NAME! AppRotateBytes 5242880
"!NSSM_PATH!" set !SVC_NAME! AppRotateSeconds 0

:: =============================================
::  8. Environment variabelen (uit JSON)
:: =============================================
echo.
echo   Environment variabelen instellen...

set "ENV_STR="
for /f "usebackq tokens=*" %%L in (`findstr "X32_IP PORT HOST NODE_ENV" nssm-service.json 2^>nul`) do (
    call :parse_env_line "%%L"
)
if not "!ENV_STR!"=="" (
    "!NSSM_PATH!" set !SVC_NAME! AppEnvironmentExtra !ENV_STR!
    echo   [OK] Env: !ENV_STR!
) else (
    echo   [INFO] Geen environment variabelen gevonden.
)

:: =============================================
::  9. Service starten
:: =============================================
echo.
echo   Service starten...
"!NSSM_PATH!" start !SVC_NAME!
if !errorlevel! neq 0 (
    echo   [WARN] Service startte niet automatisch.
    echo          nssm start !SVC_NAME!
) else (
    echo   [OK] Service gestart
)

:: =============================================
::  10. Verificatie
:: =============================================
echo.
echo   Verifying...
sc query !SVC_NAME! >nul 2>&1
if !errorlevel!==0 (
    echo   [OK] Service !SVC_NAME! IS geregistreerd.
) else (
    echo   [FATAL] Service !SVC_NAME! is NIET geregistreerd.
)

echo.
echo   ==================================================
echo   Installatie voltooid.
echo   Beheer: nssm status/start/stop/restart !SVC_NAME!
echo   Logs:   !LOG_OUT!
echo           !LOG_ERR!
echo   ==================================================

if "%INTERACTIVE%"=="1" pause
endlocal
exit /b 0


:: ============================================================
::  SUBROUTINES (moeten VOOR exit /b staan!)
:: ============================================================

:_pause
if "%INTERACTIVE%"=="1" pause >nul
goto :eof

:: ------------------------------------------------
::  :read_json_config
::  Leest service config via een PowerShell-script
::  output als een KEY=VALUE per regel. Geen colon-problemen,
::  geen pipe-escape bugs.
:: ------------------------------------------------
:read_json_config
if not exist "nssm-service.json" goto :eof

:: Schrijf klein PS-script naar temp
set "_PSFILE=%TEMP%\ichtus-readcfg.ps1"
>  "%_PSFILE%" echo $j = Get-Content -Raw 'nssm-service.json' ^| ConvertFrom-Json
>> "%_PSFILE%" echo $o = @()
>> "%_PSFILE%" echo if ($j.serviceName)        { $o += 'SVC_NAME=' + $j.serviceName }
>> "%_PSFILE%" echo if ($j.serviceDisplayName) { $o += 'SVC_DISPLAY=' + $j.serviceDisplayName }
>> "%_PSFILE%" echo if ($j.serviceDescription) { $o += 'SVC_DESC=' + $j.serviceDescription }
>> "%_PSFILE%" echo if ($j.stdoutLog)          { $o += 'LOG_OUT=' + $j.stdoutLog }
>> "%_PSFILE%" echo if ($j.stderrLog)          { $o += 'LOG_ERR=' + $j.stderrLog }
>> "%_PSFILE%" echo if ($j.nssmPath -and $j.nssmPath -ne '') { $o += 'NSSM_PATH=' + $j.nssmPath }
>> "%_PSFILE%" echo $o

:: Voer uit, vang output op in temp-bestand
set "_PSOUT=%TEMP%\ichtus-cfg-out.txt"
powershell -NoProfile -ExecutionPolicy Bypass -File "%_PSFILE%" > "%_PSOUT%" 2>nul
if not exist "%_PSOUT%" goto :eof

:: Lees output en zet in variabelen
for /f "usebackq delims=" %%L in ("%_PSOUT%") do (
    for /f "tokens=1,2 delims==" %%K in ("%%L") do (
        if "%%K"=="SVC_NAME"    set "SVC_NAME=%%L"
        if "%%K"=="SVC_DISPLAY" set "SVC_DISPLAY=%%L"
        if "%%K"=="SVC_DESC"    set "SVC_DESC=%%L"
        if "%%K"=="LOG_OUT"     set "LOG_OUT=%%L"
        if "%%K"=="LOG_ERR"     set "LOG_ERR=%%L"
        if "%%K"=="NSSM_PATH"   set "NSSM_PATH=%%L"
    )
)

:: Opruimen
del "%_PSFILE%" >nul 2>&1
del "%_PSOUT%" >nul 2>&1
goto :eof

:: ------------------------------------------------
::  :parse_env_line  %1 = raw JSON line
::  Extraheert KEY: VALUE uit een env-regel.
:: ------------------------------------------------
:parse_env_line
set "_L=%~1"
:: Haal quotes weg
set "_L=!_L:"=!"
:: Verwijder spaties en tabs
set "_L=!_L: =!"
set "_L=!_L:	=!"
:: Verwijder trailing comma
if "!_L:~-1!"=="," set "_L=!_L:~0,-1!"
:: Verwijder lege waarden (na dubbele punt)
for /f "tokens=1,2 delims=:" %%P in ("!_L!") do (
    if not "%%Q"=="" (
        if "!ENV_STR!"=="" (
            set "ENV_STR=%%P=%%Q"
        ) else (
            set "ENV_STR=!ENV_STR! %%P=%%Q"
        )
    )
)
goto :eof

:: ------------------------------------------------
::  :download_nssm
:: ------------------------------------------------
:download_nssm
set "NSSM_URL=https://nssm.cc/release/nssm-%NSSM_VER%.zip"
set "NSSM_ZIP=%NSSM_TEMP_DIR%\nssm-%NSSM_VER%.zip"

echo.
echo   NSSM downloaden...
echo   URL: !NSSM_URL!

if not exist "%NSSM_TEMP_DIR%" mkdir "%NSSM_TEMP_DIR%" >nul 2>&1

:: Methode 1: PowerShell
powershell -NoProfile -Command "try { $ProgressPreference='SilentlyContinue'; Invoke-WebRequest -Uri '!NSSM_URL!' -OutFile '!NSSM_ZIP!' -UseBasicParsing -ErrorAction Stop; exit 0 } catch { exit 1 }" >nul 2>&1
if !errorlevel!==0 (
    if exist "!NSSM_ZIP!" (
        echo   [OK] Download geslaagd (PowerShell)
        goto :extract_nssm
    )
)

:: Methode 2: curl
where curl >nul 2>&1
if !errorlevel!==0 (
    curl -sSL --fail -o "!NSSM_ZIP!" "!NSSM_URL!" >nul 2>&1
    if !errorlevel!==0 (
        if exist "!NSSM_ZIP!" (
            echo   [OK] Download geslaagd (curl)
            goto :extract_nssm
        )
    )
)

echo   [ERROR] Download mislukt. Installeer NSSM handmatig:
echo           https://nssm.cc/download
exit /b 1

:extract_nssm
echo   Uitpakken...
powershell -NoProfile -Command "Expand-Archive -Path '!NSSM_ZIP!' -DestinationPath '%NSSM_TEMP_DIR%' -Force" >nul 2>&1
if !errorlevel! neq 0 (
    echo   [ERROR] Extractie mislukt.
    exit /b 1
)

set "NSSM_PATH=%NSSM_TEMP_DIR%\nssm-%NSSM_VER%\!NSSM_ARCH_DIR!\nssm.exe"
if not exist "!NSSM_PATH!" (
    echo   [ERROR] nssm.exe niet gevonden na uitpakken:
    echo           !NSSM_PATH!
    exit /b 1
)

echo   [OK] NSSM !NSSM_VER! ^(!NSSM_ARCH_DIR!^) geinstalleerd
exit /b 0
