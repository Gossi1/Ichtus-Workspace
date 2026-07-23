@echo off
setlocal enabledelayedexpansion

cd /d "%~dp0"

:: ======================================================
::    ICHTUS WORKSPACE - WINDOWS SERVICE INSTALLATIE
::    (verbeterde versie — NSSM auto-download + Python detectie)
:: ======================================================

echo.
echo  ======================================================
echo    ICHTUS WORKSPACE - WINDOWS SERVICE INSTALLATIE
echo  ======================================================
echo.

:: ---- 0. Admin check ----
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo  [FOUT] Dit script moet als Administrator worden uitgevoerd!
    echo         Rechterklik op install-service.bat ^> "Als administrator uitvoeren"
    pause
    exit /b 1
)
echo  [OK]   Administrator rechten bevestigd

:: ---- 1. NSSM installeren (downloaden indien nodig) ----
if exist "%WINDIR%\System32\nssm.exe" (
    echo  [NSSM] Is al geinstalleerd in System32.
) else (
    echo  [NSSM] Niet gevonden — downloaden van nssm.cc...
    
    :: Download NSSM
    echo        Downloaden...
    powershell -Command "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; (New-Object System.Net.WebClient).DownloadFile('https://nssm.cc/release/nssm-2.24.zip', 'nssm.zip')" <nul
    
    if not exist nssm.zip (
        echo  [FOUT] Kan NSSM niet downloaden. Download handmatig van:
        echo         https://nssm.cc/release/nssm-2.24.zip
        echo         Plaats nssm.zip in deze map en probeer opnieuw.
        pause
        exit /b 1
    )
    echo        Uitpakken...
    powershell -Command "Expand-Archive -Path nssm.zip -DestinationPath nssm_temp -Force" <nul
    
    if not exist "nssm_temp\nssm-2.24\win64\nssm.exe" (
        echo  [FOUT] Uitpakken mislukt — nssm.exe niet gevonden in zip.
        pause
        exit /b 1
    )
    
    copy /y "nssm_temp\nssm-2.24\win64\nssm.exe" "%WINDIR%\System32\nssm.exe" >nul
    if !errorlevel! neq 0 (
        echo  [FOUT] Kan nssm.exe niet kopieren naar System32.
        pause
        exit /b 1
    )
    echo  [NSSM] Gekopieerd naar System32.
)

:: ---- 2. logs directory aanmaken ----
if not exist logs mkdir logs
echo  [LOGS] logs/ directory OK

:: ---- 3. Python vinden (eerst .venv proberen, dan systeem Python) ----
set PYTHON_PATH=
set PYTHON_IS_VENV=0

:: 3a. Probeer .venv
if exist ".venv\Scripts\python.exe" (
    echo  [PY]   Virtualenv gevonden — testen...
    ".venv\Scripts\python.exe" --version >nul 2>&1
    if !errorlevel! equ 0 (
        set PYTHON_PATH=%~dp0.venv\Scripts\python.exe
        set PYTHON_IS_VENV=1
        echo  [PY]   Gebruik virtualenv: .venv\Scripts\python.exe
    ) else (
        echo  [PY]   .venv verwijst naar een niet-bestaande Python!
        echo         .venv opnieuw aanmaken met huidige systeem Python...
        rmdir /s /q .venv
        python -m venv .venv
        if !errorlevel! equ 0 (
            echo  [PY]   .venv opnieuw aangemaakt
            call .venv\Scripts\pip install zeroconf >nul 2>&1
            set PYTHON_PATH=%~dp0.venv\Scripts\python.exe
            set PYTHON_IS_VENV=1
        ) else (
            echo  [PY]   Kon .venv niet herstellen — val terug op systeem Python.
        )
    )
)

:: 3b. Als .venv niet werkt, zoek systeem Python
if "!PYTHON_PATH!"=="" (
    echo  [PY]   Zoeken naar systeem Python (3.8+)...
    set PYTHON_TEMP=
    for /f "tokens=*" %%i in ('where python 2^>nul') do (                "%%i" --version 2>&1 | findstr "3\." >nul
                if !errorlevel! equ 0 (
                    set PYTHON_PATH=%%i
                    goto :found_python
                )
    )
)

:found_python
if "!PYTHON_PATH!"=="" (
    echo  [FOUT] Python 3.8+ niet gevonden!
    echo         Installeer Python van https://www.python.org/downloads/
    echo         Zet bij installatie "Add Python to PATH" AAN.
    pause
    exit /b 1
)

for /f "tokens=*" %%v in ('"!PYTHON_PATH!" --version 2^>^&1') do set PYTHON_VER=%%v
echo  [PY]   Python: !PYTHON_PATH!  (!PYTHON_VER!)

:: ---- 4. Poort 8080 vrijmaken ----
echo  [PORT] Controleren of poort 8080 vrij is...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8080" ^| findstr "LISTENING"') do (
    echo  [PORT] Proces PID %%a stoppen op poort 8080...
    taskkill /F /PID %%a 2>nul
)
timeout /t 2 /nobreak >nul
echo  [PORT] Klaar

:: ---- 5. Bestaande service verwijderen ----
echo  [SERVICE] Eventuele bestaande IchtusServer service stoppen/verwijderen...
nssm stop IchtusServer 2>nul
nssm remove IchtusServer confirm 2>nul
timeout /t 1 /nobreak >nul

:: ---- 6. Service installeren (met Application + AppParameters apart!) ----
echo  [SERVICE] IchtusServer installeren...

nssm install IchtusServer "!PYTHON_PATH!" >nul

if !errorlevel! neq 0 (
    echo  [FOUT] Kon service niet aanmaken!
    pause
    exit /b 1
)

:: Application en parameters apart zetten (om quoting issues te voorkomen)
nssm set IchtusServer Application "!PYTHON_PATH!"
nssm set IchtusServer AppParameters "%~dp0server.py --port 8080 --host 0.0.0.0 --no-update-check"

:: Configuratie
nssm set IchtusServer AppDirectory "%~dp0"
nssm set IchtusServer AppStdout "%~dp0logs\service-output.log"
nssm set IchtusServer AppStderr "%~dp0logs\service-error.log"
nssm set IchtusServer AppRotateFiles 1
nssm set IchtusServer AppRotateOnline 1
nssm set IchtusServer AppRotateBytes 5000000
nssm set IchtusServer AppNoConsole 1
nssm set IchtusServer Start SERVICE_AUTO_START
nssm set IchtusServer DisplayName "Ichtus Workspace Server"
nssm set IchtusServer Description "Ichtus Workspace - Kerkdienstbeheer SPA"
nssm set IchtusServer ObjectName LocalSystem
nssm set IchtusServer AppThrottle 3000
nssm set IchtusServer AppExit Default Exit

echo  [SERVICE] Configuratie voltooid.

:: ---- 7. Service starten ----
echo  [SERVICE] IchtusServer starten...
nssm start IchtusServer

:: Wacht even en check de status
timeout /t 3 /nobreak >nul
nssm status IchtusServer | findstr "RUNNING" >nul
if !errorlevel! equ 0 (
    echo  [SERVICE] ✅ Gestart en draait!
) else (
    echo  [SERVICE] ⚠️  Start commando uitgevoerd, maar service reageert nog niet.
    echo         Controleer met: nssm status IchtusServer
    echo         Check logs:     type logs\service-error.log
)

:: ---- 8. Opruimen ----
echo  [CLEANUP] Opruimen tijdelijke bestanden...
if exist nssm.zip del /q nssm.zip
if exist nssm_temp rmdir /s /q nssm_temp
echo  [CLEANUP] Klaar

:: ---- 9. Resultaat ----
echo.
echo  ======================================================
echo    GEREED!
echo  ======================================================
echo.
echo    Service:   IchtusServer
echo    Status:    ✅ Automatisch starten met Windows
echo    Python:    !PYTHON_PATH!
echo    Poort:     http://localhost:8080/
echo    PWA:       http://localhost:8080/Ichtus_SPA/
echo.
echo    Beheer commando's:
echo      nssm start IchtusServer
echo      nssm stop IchtusServer
echo      nssm restart IchtusServer
echo      nssm status IchtusServer
echo      nssm edit IchtusServer     (configuratie wijzigen)
echo.
echo    Logs:
echo      type logs\service-output.log
echo      type logs\service-error.log
echo.
echo  ======================================================
echo.

pause
endlocal
