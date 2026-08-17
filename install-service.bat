@echo off
setlocal EnableDelayedExpansion

cd /d "%~dp0"

:: ------------------------------------------
::  Headless / silent mode?
::  Wordt aangezet door setup.ps1 via:
::      set AUTO_INSTALL_NSSM=1
::  In die modus:
::    - alle interactieve prompts worden automatisch beantwoord
::    - `pause` aan het eind slaat over
:: ------------------------------------------
if "%AUTO_INSTALL_NSSM%"=="1" (
    set "INTERACTIVE=0"
) else (
    set "INTERACTIVE=1"
)

:: Helper subroutine :_pause staat onderaan het bestand,
:: anders zou `goto :eof` bij line-by-line doorloop de hele
:: bat voortijdig beeindigen.

:: ------------------------------------------------
::  Constanten die de hele bat door gebruikt worden.
::  Eerder werden deze pas in sectie 3 gezet, waardoor
::  subroutines zoals :download_nssm ze leeg expandeden.
:: ------------------------------------------------
set "NSSM_VER=2.24"
set "NSSM_TEMP_DIR=%CD%\nssm_temp"

echo.
echo   ==================================================
echo      ICHTUS SERVER - NSSM SERVICE INSTALLER
echo   ==================================================

:: :download_nssm subroutine staat onderaan het bestand
:: (na endlocal) om te voorkomen dat line-by-line parse
:: de `exit /b 0` aan het einde triggert.

echo.

:: ------------------------------------------
::  1. nssm-service.json aanwezig?
:: ------------------------------------------
if not exist "nssm-service.json" (
    echo   [ERROR] nssm-service.json niet gevonden.
    echo.
    echo   Kopieer nssm-service.example.json naar nssm-service.json
    echo   en pas de paden aan jouw installatie aan.
    call :_pause
    exit /b 1
)

:: ------------------------------------------
::  2. Node.js aanwezig?
:: ------------------------------------------
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo   [ERROR] Node.js niet gevonden. Installeer Node.js LTS.
    call :_pause
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

:: ------------------------------------------
::  3. NSSM zoeken of automatisch downloaden
:: ------------------------------------------
set "NSSM_VER=2.24"
set "NSSM_TEMP_DIR=%CD%\nssm_temp"

:: Architectuur detecteren. PROCESSOR_ARCHITECTURE is een
:: ingebouwde cmd-variabele (altijd beschikbaar), dus geen
:: PowerShell-subproces nodig -- dat was eerder een bron van
:: bugs waarbij NSSM_ARCH_DIR leeg bleef.
if "%PROCESSOR_ARCHITECTURE%"=="AMD64" set "NSSM_ARCH_DIR=win64"
if "%PROCESSOR_ARCHITECTURE%"=="ARM64" set "NSSM_ARCH_DIR=win64"
if "%PROCESSOR_ARCHITECTURE%"=="x86"   set "NSSM_ARCH_DIR=win32"
if "%PROCESSOR_ARCHITECTURE%"=="IA64"  set "NSSM_ARCH_DIR=win64"
if not defined NSSM_ARCH_DIR              set "NSSM_ARCH_DIR=win64"

set "NSSM_PATH="

:: 3a. nssm-service.json -^> nssmPath. Een .ps1-file aanroepen
:: ipv de inline powershell -Command met `^|` pipe-escape,
:: want die escape lekt door naar PS en wordt als losse `^`
:: gerapporteerd (zie history).
> "%TEMP%\ichtus-np.ps1" (
    echo $ErrorActionPreference = 'SilentlyContinue'
    echo try {
    echo   $j = Get-Content nssm-service.json -Raw ^| ConvertFrom-Json
    echo   [string]$j.nssmPath
    echo } catch { '' }
)
for /f "delims=" %%i in ('powershell -NoProfile -File "%TEMP%\ichtus-np.ps1" 2^>nul') do set NSSM_PATH=%%i
del "%TEMP%\ichtus-np.ps1" >nul 2>&1

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
)::  3d. Automatische download als alles mislukt
if "!NSSM_PATH!"=="" (
    echo.
    echo   [INFO] nssm.exe niet gevonden op deze PC.
    echo.
    echo   Automatisch downloaden en plaatsen in dit project?
    echo     Bron:    https://nssm.cc/release/nssm-%NSSM_VER%.zip
    echo     Locatie: nssm_temp\nssm-%NSSM_VER%\!NSSM_ARCH_DIR!\nssm.exe
    echo     Grootte: ~300 KB
    echo.
    if "%INTERACTIVE%"=="1" (
        set /p DL_CHOICE="   Downloaden nu? (J/N) > "
    ) else (
        set "DL_CHOICE=J"
        echo   [AUTO] Download NSSM zonder prompt (silent mode)
    )
    if /i not "!DL_CHOICE!"=="J" (
        echo.
        echo   [ERROR] Geen NSSM. Installeer handmatig:
        echo           1. Download nssm-%NSSM_VER%.zip van https://nssm.cc/download
        echo           2. Plaats nssm.exe ergens op je PC
        echo           3. Pas nssm-service.json -^> nssmPath aan.
        call :_pause
        exit /b 1
    )
    call :download_nssm
    if !errorlevel! neq 0 (
        call :_pause
        exit /b 1
    )
)

:nssm_ready
if not exist "!NSSM_PATH!" (
    echo   [ERROR] NSSM niet gevonden op "!NSSM_PATH!"
    call :_pause
    exit /b 1
)

echo   [NSSM] !NSSM_PATH!

:: Service config inlezen (1x in plaats van 5x; gebruikt een
:: temp .ps1-bestand om de batch<->PS pipe-escape bugs te omzeilen).
call :set_service_config

echo   [SVC]  !SVC_NAME! ^(!SVC_DISPLAY!^)
echo.

:: ------------------------------------------
::  4. Log directory aanmaken
:: ------------------------------------------
for %%L in ("!LOG_OUT!" "!LOG_ERR!") do (
    for %%D in ("%%~dpL") do (
        if not exist "%%~fd" mkdir "%%~fd" >nul 2>&1
    )
)

:: ------------------------------------------
::  5. Service bestaat al?
:: ------------------------------------------
sc query !SVC_NAME! >nul 2>&1
if !errorlevel!==0 (
    echo   [WARN] Service !SVC_NAME! bestaat al.
    echo.
    echo   Wil je de service opnieuw installeren?
    echo   (Stopt en verwijdert eerst de bestaande service)
    if "%INTERACTIVE%"=="1" (
        set /p REINSTALL="   J/N > "
    ) else (
        set "REINSTALL=J"
        echo   [AUTO] Herinstallatie zonder prompt (silent mode)
    )
    if /i not "!REINSTALL!"=="J" (
        echo.
        echo   [INFO] Installatie afgebroken.
        call :_pause
        exit /b 0
    )
    echo.
    echo   Bestaande service stoppen en verwijderen...
    call "!NSSM_PATH!" stop !SVC_NAME! >nul 2>&1
    timeout /t 2 /nobreak >nul
    call "!NSSM_PATH!" remove !SVC_NAME! confirm >nul 2>&1
    echo   [OK] Bestaande service verwijderd
)

:: ------------------------------------------
::  6. Service installeren
:: ------------------------------------------
echo.
echo   Service installeren...

call "!NSSM_PATH!" install !SVC_NAME! "!NODE_EXE!" "src\server.js"
if !errorlevel! neq 0 (
    echo   [ERROR] nssm install mislukt.
    call :_pause
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

:: ------------------------------------------
::  7. Environment variabelen
:: ------------------------------------------
echo.
echo   Environment variabelen instellen...

:: Bouw KEY=VALUE,KEY=VALUE string uit het JSON-bestand
call :read_env_vars

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

:: ------------------------------------------
::  8. Service starten
:: ------------------------------------------
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

:: ------------------------------------------------
::  Verifieer dat de service daadwerkelijk
::  geregistreerd is (extra safety net).
:: ------------------------------------------------
echo   Verifying service registration...
sc query !SVC_NAME! >nul 2>&1
if !errorlevel!==0 (
    echo   [OK] Service !SVC_NAME! IS geregistreerd in services.msc.
) else (
    echo   [FATAL] Service !SVC_NAME! is NIET geregistreerd.
    echo           Iets ging mis in installatie. Hierboven staan details.
)

echo.
echo   ==================================================
echo   [DONE] install-service.bat completed at !TIME!
echo   ==================================================
echo   Exit-code: !ERRORLEVEL!
echo.

if "%INTERACTIVE%"=="1" pause
endlocal

:: ------------------------------------------
::  Helper subroutines (staan hier onderaan de bat
::  zodat hun `exit /b`/`goto :eof` de hoofdstroom
::  niet voortijdig beeindigen tijdens line-by-line
::  doorloop).
:: ------------------------------------------

:_pause
if "%INTERACTIVE%"=="1" pause >nul
goto :eof

:: ------------------------------------------
::  :set_service_config  -- leest SVC_NAME, SVC_DISPLAY,
::  SVC_DESC, LOG_OUT, LOG_ERR vanuit nssm-service.json.
::  Schrijft een tijdelijk .ps1-bestand om de batch<->PS
::  pipe-escape (`^|` ziet PS als losse `^`) te omzeilen.
:: ------------------------------------------
:set_service_config
> "%TEMP%\ichtus-rj.ps1" (
    echo $ErrorActionPreference = 'SilentlyContinue'
    echo try {
    echo   $j = Get-Content nssm-service.json -Raw ^| ConvertFrom-Json
    echo   if ($j) {
    echo     ([string]$j.serviceName + ';' + [string]$j.serviceDisplayName + ';' + [string]$j.serviceDescription + ';' + [string]$j.stdoutLog + ';' + [string]$j.stderrLog)
    echo   } else { ';;;;' }
    echo } catch { ';;;;' }
)
for /f "tokens=1-5 delims=;" %%A in ('powershell -NoProfile -File "%TEMP%\ichtus-rj.ps1" 2^>nul') do (
    set "SVC_NAME=%%A"
    set "SVC_DISPLAY=%%B"
    set "SVC_DESC=%%C"
    set "LOG_OUT=%%D"
    set "LOG_ERR=%%E"
)
del "%TEMP%\ichtus-rj.ps1" >nul 2>&1
:: Defaults als JSON-velden ontbreken of de parse faalde
if "%SVC_NAME%"==";;;;"       set "SVC_NAME=IchtusServer"
if "%SVC_DISPLAY%"==""        set "SVC_DISPLAY=Ichtus Workspace Server"
if "%SVC_DESC%"==""           set "SVC_DESC=Ichtus Workspace console server"
if "%LOG_OUT%"==""            set "LOG_OUT=%CD%\logs\nssm-stdout.log"
if "%LOG_ERR%"==""            set "LOG_ERR=%CD%\logs\nssm-stderr.log"
goto :eof

:: ------------------------------------------
::  :read_env_vars -- leest de `env` sectie van
::  nssm-service.json en geeft KEY=VALUE,KEY=VALUE,...
:: ------------------------------------------
:read_env_vars
set "ENV_PAIRS="
> "%TEMP%\ichtus-env.ps1" (
    echo $ErrorActionPreference = 'SilentlyContinue'
    echo try {
    echo   $j = Get-Content nssm-service.json -Raw ^| ConvertFrom-Json
    echo   if ($j.env) {
    echo     $j.env.PSObject.Properties ^| ForEach-Object { '{0}={1}' -f $_.Name, $_.Value } ^| ConvertTo-Json -Compress
    echo   } else { '[]' }
    echo } catch { '[]' }
)
for /f "delims=" %%L in ('powershell -NoProfile -File "%TEMP%\ichtus-env.ps1" 2^>nul') do set "ENV_PAIRS=%%L"
del "%TEMP%\ichtus-env.ps1" >nul 2>&1
goto :eof

:download_nssm
if "%NSSM_VER%"==""      set "NSSM_VER=2.24"
if "%NSSM_TEMP_DIR%"=="" set "NSSM_TEMP_DIR=%CD%\nssm_temp"
if "%NSSM_ARCH_DIR%"=="" set "NSSM_ARCH_DIR=win64"
set "NSSM_URL=https://nssm.cc/release/nssm-%NSSM_VER%.zip"
set "NSSM_ZIP=%NSSM_TEMP_DIR%\nssm-%NSSM_VER%.zip"

echo.
echo   NSSM downloaden...
echo   URL: !NSSM_URL!

if not exist "%NSSM_TEMP_DIR%" mkdir "%NSSM_TEMP_DIR%" >nul 2>&1

:: Probeer methode 1: PowerShell Invoke-WebRequest
powershell -NoProfile -Command ^
    "try { $ProgressPreference = 'SilentlyContinue'; Invoke-WebRequest -Uri '!NSSM_URL!' -OutFile '!NSSM_ZIP!' -UseBasicParsing -ErrorAction Stop; 'OK' } catch { 'FAIL: ' + $_.Exception.Message }" > "%NSSM_TEMP_DIR%\ps-result.txt" 2>&1
set "DL_OK=0"
for /f "delims=" %%R in ('type "%NSSM_TEMP_DIR%\ps-result.txt" 2^>nul') do (
    set "LINE=%%R"
    if /i "!LINE!"=="OK" set "DL_OK=1"
)
if !DL_OK!==1 (
    echo   [OK] PowerShell download geslaagd
    goto :extract_nssm
)
echo   [WARN] PowerShell download mislukt:
type "%NSSM_TEMP_DIR%\ps-result.txt"

:: Probeer methode 2: curl.exe (Windows 10 1803+)
echo   Probeer methode 2: curl.exe...
where curl >nul 2>&1
if !errorlevel! neq 0 (
    echo   [WARN] curl.exe niet beschikbaar
    goto :download_failed
)
curl -sSL --fail -o "!NSSM_ZIP!" "!NSSM_URL!"
if !errorlevel!==0 (
    if exist "!NSSM_ZIP!" (
        echo   [OK] curl download geslaagd
        goto :extract_nssm
    )
)
echo   [WARN] curl download faalde
goto :download_failed

:download_failed
echo   [ERROR] Geen download-methode slaagde. Installeer NSSM handmatig:
echo           https://nssm.cc/download
exit /b 1

:extract_nssm
echo   [OK] ZIP gedownload (~300 KB)
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

echo   [OK] NSSM !NSSM_VER! ^(!NSSM_ARCH_DIR!^) geinstalleerd in nssm_temp\
exit /b 0
