@echo off
setlocal enabledelayedexpansion

cd /d "%~dp0"

:: ======================================================
::    ICHTUS WORKSPACE - WINDOWS SERVICE INSTALLATIE
::    (versie 2 — robuust: timeout, retry, geen goto-in-loop)
:: ======================================================

echo.
echo  ======================================================
echo    ICHTUS WORKSPACE - WINDOWS SERVICE INSTALLATIE
echo  ======================================================
echo.

:: ──────────────────────────────────────────────────
::  0. Admin check
:: ──────────────────────────────────────────────────
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo  [FOUT] ⚠️  Dit script moet als Administrator worden uitgevoerd!
    echo.
    echo         Rechterklik op install-service.bat ^> "Als administrator uitvoeren"
    echo.
    pause
    exit /b 1
)
echo  [OK]   Administrator rechten bevestigd
echo.

:: ──────────────────────────────────────────────────
::  1. NSSM — controleren / downloaden met timeout
:: ──────────────────────────────────────────────────

:: Eerst oude downloads opruimen (kan achterblijven van eerdere runs)
if exist nssm.zip del /q nssm.zip >nul 2>&1
if exist nssm_temp rmdir /s /q nssm_temp >nul 2>&1

:: Gebruik 'where' i.p.v. 'if exist %WINDIR%\System32' (omzeilt SysWOW64 redirectie op 64-bit Windows)
where nssm.exe >nul 2>&1
if !errorlevel! equ 0 (
    echo  [NSSM] ✅ Al geïnstalleerd.
) else (
    echo  [NSSM] ⬇️  Niet gevonden — downloaden van nssm.cc...
    echo         (max 30 seconden wachttijd)
    echo.

    :: PowerShell script naar een temp bestand schrijven (voorkomt complexe inline escaping)
    set PS_DL_SCRIPT=%temp%\ichtus_dl_nssm.ps1
    echo [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 > "!PS_DL_SCRIPT!"
    echo (New-Object System.Net.WebClient).DownloadFile('https://nssm.cc/release/nssm-2.24.zip', '%~dp0nssm.zip') >> "!PS_DL_SCRIPT!"

    :: Download starten in achtergrond
    start /b "" powershell -ExecutionPolicy Bypass -File "!PS_DL_SCRIPT!" >nul 2>&1

    :: Wacht max 30 seconden op nssm.zip (poll elke ~1s met ping)
    set WAIT_COUNT=0
    :wait_nssm
    if exist nssm.zip goto :nssm_downloaded
    ping -n 2 127.0.0.1 >nul
    set /a WAIT_COUNT+=1
    if !WAIT_COUNT! lss 30 goto :wait_nssm

    :: Timeout — geen zip gevonden
    echo  [NSSM] ⚠️  Download van nssm.cc duurt te lang of is geblokkeerd.
    echo         ▸ Download zelf:  https://nssm.cc/release/nssm-2.24.zip
    echo         ▸ Plaats nssm.zip in:  %~dp0
    echo         ▸ En draai dit script opnieuw.
    echo.
    if exist "!PS_DL_SCRIPT!" del /q "!PS_DL_SCRIPT!" >nul 2>&1
    pause
    exit /b 1

    :nssm_downloaded
    echo  [NSSM] ✅ Gedownload.
    if exist "!PS_DL_SCRIPT!" del /q "!PS_DL_SCRIPT!" >nul 2>&1

    :: Controleer of het echt een geldig zip-bestand is
    powershell -Command "& { try { $f = Get-Item 'nssm.zip'; if ($f.Length -lt 10000) { exit 1 } } catch { exit 1 }; exit 0 }" <nul
    if !errorlevel! neq 0 (
        echo  [NSSM] ❌ Bestand te klein of corrupt — download handmatig van nssm.cc.
        del /q nssm.zip 2>nul
        pause
        exit /b 1
    )

    echo  [NSSM] 📦 Uitpakken...
    powershell -Command "& { Expand-Archive -Path nssm.zip -DestinationPath nssm_temp -Force; exit 0 }" <nul

    if not exist "nssm_temp\nssm-2.24\win64\nssm.exe" (
        echo  [NSSM] ❌ Uitpakken mislukt — nssm.exe niet gevonden in zip.
        pause
        exit /b 1
    )

    copy /y "nssm_temp\nssm-2.24\win64\nssm.exe" "%WINDIR%\System32\nssm.exe" >nul
    :: Kopieer naar System32. Als Sysnative bestaat (32-bit op 64-bit), kopieer daar ook.
    copy /y "nssm_temp\nssm-2.24\win64\nssm.exe" "%WINDIR%\System32\nssm.exe" >nul 2>&1
    set COPY_OK=!errorlevel!
    if exist "%WINDIR%\Sysnative" (
        copy /y "nssm_temp\nssm-2.24\win64\nssm.exe" "%WINDIR%\Sysnative\nssm.exe" >nul 2>&1
        if !errorlevel! equ 0 set COPY_OK=0
    )
    if !COPY_OK! neq 0 (
        echo  [NSSM] ❌ Kan nssm.exe niet kopiëren naar System32.
        pause
        exit /b 1
    )
    echo  [NSSM] ✅ Gekopieerd naar System32.
)
echo.

:: ──────────────────────────────────────────────────
::  2. Logs directory
:: ──────────────────────────────────────────────────
if not exist logs mkdir logs
echo  [LOGS] ✅ logs/ directory OK
echo.

:: ──────────────────────────────────────────────────
::  3. Python vinden (zonder goto-in-loop!)
::     Strategie: .venv eerst, dan systeem Python.
:: ──────────────────────────────────────────────────
set PYTHON_PATH=
set PYTHON_IS_VENV=0

:: 3a. .venv proberen
if exist ".venv\Scripts\python.exe" (
    echo  [PY]   Virtualenv gevonden — testen...
    ".venv\Scripts\python.exe" --version >nul 2>&1
    if !errorlevel! equ 0 (
        set PYTHON_PATH=%~dp0.venv\Scripts\python.exe
        set PYTHON_IS_VENV=1
        echo  [PY]   ✅ Gebruik virtualenv: .venv\Scripts\python.exe
    ) else (
        echo  [PY]   ⚠️  .venv verwijst naar niet-bestaande Python!
        echo         .venv opnieuw aanmaken...
        rmdir /s /q .venv 2>nul
        python -m venv .venv
        if !errorlevel! equ 0 (
            echo  [PY]   ✅ .venv opnieuw aangemaakt
            call .venv\Scripts\pip install zeroconf >nul 2>&1
            set PYTHON_PATH=%~dp0.venv\Scripts\python.exe
            set PYTHON_IS_VENV=1
        ) else (
            echo  [PY]   ⚠️  Kon .venv niet herstellen — val terug op systeem Python.
        )
    )
)

:: 3b. Als .venv niet werkt, zoek systeem Python
::     Gebruik een vlag-variabele i.p.v. goto uit een for-loop (veiliger!)
if "!PYTHON_PATH!"=="" (
    echo  [PY]   🔍 Zoeken naar systeem Python (3.8+)...
    set FOUND_PYTHON=

    :: Probeer 'python' eerst
    for /f "tokens=*" %%i in ('where python 2^>nul') do (
        if not defined FOUND_PYTHON (
            "%%i" --version 2>&1 | findstr /B "Python 3\." >nul
            if !errorlevel! equ 0 (
                set PYTHON_PATH=%%i
                set FOUND_PYTHON=1
            )
        )
    )

    :: Als 'python' niets gaf, probeer 'python3'
    if not defined FOUND_PYTHON (
        for /f "tokens=*" %%i in ('where python3 2^>nul') do (
            if not defined FOUND_PYTHON (
                "%%i" --version 2>&1 | findstr /B "Python 3\." >nul
                if !errorlevel! equ 0 (
                    set PYTHON_PATH=%%i
                    set FOUND_PYTHON=1
                )
            )
        )
    )

    :: Als nog niets, probeer veelvoorkomende paden
    if not defined FOUND_PYTHON (
        for %%p in (
            "%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
            "%LOCALAPPDATA%\Programs\Python\Python311\python.exe"
            "%LOCALAPPDATA%\Programs\Python\Python310\python.exe"
            "C:\Program Files\Python312\python.exe"
            "C:\Program Files\Python311\python.exe"
            "C:\Python312\python.exe"
            "C:\Python311\python.exe"
        ) do (
            if not defined FOUND_PYTHON (
                if exist %%p (
                    %%~p --version 2>&1 | findstr /B "Python 3\." >nul
                    if !errorlevel! equ 0 (
                        set PYTHON_PATH=%%p
                        set FOUND_PYTHON=1
                    )
                )
            )
        )
    )
)

:: 3c. Controle of we Python hebben
if "!PYTHON_PATH!"=="" (
    echo  [PY]   ❌ Python 3.8+ niet gevonden!
    echo.
    echo         Installeer Python van:  https://www.python.org/downloads/
    echo         Zet bij installatie "Add Python to PATH" AAN.
    echo         Of draai eerst: install.bat  (maakt .venv aan)
    echo.
    pause
    exit /b 1
)

:: 3d. Toon versie
for /f "tokens=*" %%v in ('"!PYTHON_PATH!" --version 2^>^&1') do set PYTHON_VER=%%v
echo  [PY]   ✅ Python: !PYTHON_PATH!  (!PYTHON_VER!)
echo.

:: ──────────────────────────────────────────────────
::  4. Poort 8080 vrijmaken
:: ──────────────────────────────────────────────────
echo  [PORT] Controleren of poort 8080 vrij is...
set PORT_FREED=0
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8080" ^| findstr "LISTENING"') do (
    echo  [PORT] ⚠️  Proces PID %%a stoppen op poort 8080...
    taskkill /F /PID %%a >nul 2>&1
    set PORT_FREED=1
)
if !PORT_FREED! equ 1 (
    timeout /t 2 /nobreak >nul
)
echo  [PORT] ✅ Poort 8080 vrij
echo.

:: ──────────────────────────────────────────────────
::  5. Bestaande service verwijderen
:: ──────────────────────────────────────────────────
echo  [SERVICE] Eventuele bestaande service stoppen/verwijderen...
nssm stop IchtusServer >nul 2>&1
nssm remove IchtusServer confirm >nul 2>&1
timeout /t 1 /nobreak >nul
echo  [SERVICE] ✅ Klaar
echo.

:: ──────────────────────────────────────────────────
::  6. Service installeren
:: ──────────────────────────────────────────────────
echo  [SERVICE] IchtusServer installeren...

nssm install IchtusServer "!PYTHON_PATH!" >nul 2>&1
if !errorlevel! neq 0 (
    echo  [SERVICE] ❌ Kon service niet aanmaken!
    echo            Mogelijk bestaat de service al — probeer:
    echo              nssm remove IchtusServer confirm
    echo.
    pause
    exit /b 1
)

:: Aparte parameters (voorkomt quoting problemen)
nssm set IchtusServer Application "!PYTHON_PATH!" >nul
nssm set IchtusServer AppParameters "server.py --port 8080 --host 0.0.0.0 --no-update-check" >nul

:: Configuratie
nssm set IchtusServer AppDirectory "%~dp0" >nul
nssm set IchtusServer AppStdout "%~dp0logs\service-output.log" >nul
nssm set IchtusServer AppStderr "%~dp0logs\service-error.log" >nul
nssm set IchtusServer AppRotateFiles 1 >nul
nssm set IchtusServer AppRotateOnline 1 >nul
nssm set IchtusServer AppRotateBytes 5000000 >nul
nssm set IchtusServer AppNoConsole 1 >nul
nssm set IchtusServer Start SERVICE_AUTO_START >nul
nssm set IchtusServer DisplayName "Ichtus Workspace Server" >nul
nssm set IchtusServer Description "Ichtus Workspace - Kerkdienstbeheer SPA/PWA" >nul
nssm set IchtusServer ObjectName LocalSystem >nul
nssm set IchtusServer AppThrottle 3000 >nul
nssm set IchtusServer AppExit Default Exit >nul

echo  [SERVICE] ✅ Configuratie voltooid
echo.

:: ──────────────────────────────────────────────────
::  7. Service starten (met retry!)
:: ──────────────────────────────────────────────────
echo  [SERVICE] IchtusServer starten...
echo           (max 5 pogingen met 2s tussentijd)
echo.

nssm start IchtusServer >nul 2>&1

:: Retry loop — tot 5x checken of de service draait
set RETRIES=0
:start_retry
set /a RETRIES+=1

timeout /t 2 /nobreak >nul

nssm status IchtusServer | findstr "RUNNING" >nul 2>&1
if !errorlevel! equ 0 (
    echo  [SERVICE] ✅ Gestart en draait!  (poging !RETRIES! van 5)
    goto :service_ok
)

:: Niet running — check of het SERVICE_STOPPED is (gestart maar gecrasht)
nssm status IchtusServer | findstr "STOPPED" >nul 2>&1
if !errorlevel! equ 0 (
    echo  [SERVICE] ⚠️  Service is gestopt (gestart maar gecrasht).
    echo            Check logs:   type logs\service-error.log
    echo            Check nssm:   nssm status IchtusServer
    echo            Eventueel:    nssm edit IchtusServer  (parameters aanpassen)
    goto :service_fail
)

:: Nog bezig met starten
if !RETRIES! lss 5 (
    echo  [SERVICE] ⏳ Nog bezig... (poging !RETRIES! van 5)
    goto :start_retry
)

:service_fail
echo.
echo  [SERVICE] ⚠️  Service startte niet binnen 10 seconden.
echo.
echo         Wat nu?
echo          1. Check de logbestanden:
echo               type logs\service-error.log
echo               type logs\service-output.log
echo.
echo          2. Controleer de poort:
echo               netstat -ano | findstr :8080
echo.
echo          3. Probeer handmatig te starten:
echo               nssm start IchtusServer
echo               nssm status IchtusServer
echo.
echo          4. Of bewerk de configuratie:
echo               nssm edit IchtusServer
echo.
goto :cleanup

:service_ok
echo.

:: ──────────────────────────────────────────────────
::  8. Opruimen
:: ──────────────────────────────────────────────────
:cleanup
echo  [CLEANUP] Opruimen tijdelijke bestanden...
if exist nssm.zip (
    del /q nssm.zip >nul 2>&1
    echo  [CLEANUP]   🗑️  nssm.zip verwijderd
)
if exist nssm_temp (
    rmdir /s /q nssm_temp >nul 2>&1
    echo  [CLEANUP]   🗑️  nssm_temp map verwijderd
)
echo  [CLEANUP] ✅ Klaar
echo.

:: ──────────────────────────────────────────────────
::  9. Resultaat
:: ──────────────────────────────────────────────────
echo  ======================================================
echo    GEREED 🎉
echo  ======================================================
echo.
echo    Service:   IchtusServer
echo    Status:    ✅ Automatisch starten met Windows
echo    Python:    !PYTHON_PATH!
echo    Poort:     http://localhost:8080/
echo    PWA:       http://localhost:8080/Ichtus_SPA/
echo.
echo    ── Beheer commando's ──
echo      nssm  start     IchtusServer
echo      nssm  stop      IchtusServer
echo      nssm  restart   IchtusServer
echo      nssm  status    IchtusServer
echo      nssm  edit      IchtusServer     (configuratie wijzigen)
echo.
echo    ── Logs ──
echo      type logs\service-output.log
echo      type logs\service-error.log
echo.
echo  ======================================================
echo.

pause
endlocal
